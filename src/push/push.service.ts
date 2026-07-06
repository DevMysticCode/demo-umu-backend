import { Injectable, Logger } from '@nestjs/common';
import {
  SNSClient,
  CreatePlatformEndpointCommand,
  PublishCommand,
  SetEndpointAttributesCommand,
  DeleteEndpointCommand,
} from '@aws-sdk/client-sns';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Push notification delivery via AWS SNS Mobile Push.
 *
 * Why SNS instead of firebase-admin: the app already runs on AWS
 * (App Runner + RDS + S3 + Secrets Manager) so pushing through SNS
 * keeps the entire stack under one bill + one IAM policy. iOS goes
 * to APNs directly with no Firebase in the loop; Android goes via
 * FCM but the FCM credential lives in an SNS Platform Application
 * so the backend never touches firebase-admin.
 *
 * Env vars required:
 *   AWS_SNS_APNS_PLATFORM_ARN  — Platform Application ARN for APNS
 *                                (Production) or APNS_SANDBOX
 *   AWS_SNS_FCM_PLATFORM_ARN   — Platform Application ARN for GCM/FCM
 *   AWS_REGION                 — defaults to eu-west-2
 *
 * If either platform ARN is missing, sends for that platform become
 * no-ops (safe on dev boxes without an APNS setup).
 */
export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly sns: SNSClient;
  private readonly apnsArn = process.env.AWS_SNS_APNS_PLATFORM_ARN ?? '';
  private readonly fcmArn = process.env.AWS_SNS_FCM_PLATFORM_ARN ?? '';

  constructor(private readonly prisma: PrismaService) {
    this.sns = new SNSClient({ region: process.env.AWS_REGION ?? 'eu-west-2' });
    if (!this.apnsArn && !this.fcmArn) {
      this.logger.warn(
        'No SNS platform ARNs configured — push notifications will no-op. ' +
          'Set AWS_SNS_APNS_PLATFORM_ARN and/or AWS_SNS_FCM_PLATFORM_ARN.',
      );
    }
  }

  private platformArnFor(platform: string): string | null {
    if (platform === 'ios') return this.apnsArn || null;
    if (platform === 'android') return this.fcmArn || null;
    return null;
  }

  /**
   * Register (or refresh) a device token. Creates the corresponding SNS
   * Platform Endpoint on first registration and stores the endpointArn
   * so subsequent publishes skip the round-trip.
   *
   * If SNS is unreachable OR the platform ARN is missing, we still
   * persist the DB row — the next Push.send() will retry the endpoint
   * create. This keeps the /me/push-token endpoint tolerant of a
   * momentary SNS blip so signups don't fail.
   */
  async registerToken(
    userId: string,
    token: string,
    platform: string,
    deviceId?: string,
  ) {
    if (!token || !platform) return;

    let endpointArn: string | null = null;
    const platformArn = this.platformArnFor(platform);
    if (platformArn) {
      try {
        const res = await this.sns.send(
          new CreatePlatformEndpointCommand({
            PlatformApplicationArn: platformArn,
            Token: token,
            // CustomUserData lets us find the endpoint later without a DB
            // hit (SNS lets you list endpoints by user data).
            CustomUserData: JSON.stringify({ userId }),
          }),
        );
        endpointArn = res.EndpointArn ?? null;
        if (endpointArn) {
          // Re-enable the endpoint if SNS auto-disabled it after a
          // previous invalid-token failure — Amazon's default is to
          // set Enabled=false, which silently drops future publishes.
          await this.sns.send(
            new SetEndpointAttributesCommand({
              EndpointArn: endpointArn,
              Attributes: { Enabled: 'true', Token: token },
            }),
          );
        }
      } catch (err: any) {
        this.logger.warn(
          `SNS CreatePlatformEndpoint failed (${err?.message ?? err}) — token stored, endpoint will be created on next send()`,
        );
      }
    }

    await this.prisma.pushToken.upsert({
      where: { token },
      create: {
        userId,
        token,
        platform,
        deviceId: deviceId ?? null,
        endpointArn,
      },
      update: {
        userId,
        platform,
        deviceId: deviceId ?? null,
        endpointArn: endpointArn ?? undefined,
        lastSeenAt: new Date(),
      },
    });
  }

  async unregisterToken(userId: string, token: string) {
    if (!token) return;
    const row = await this.prisma.pushToken.findUnique({ where: { token } });
    if (!row || row.userId !== userId) return;
    if (row.endpointArn) {
      try {
        await this.sns.send(
          new DeleteEndpointCommand({ EndpointArn: row.endpointArn }),
        );
      } catch (err: any) {
        this.logger.warn(
          `SNS DeleteEndpoint failed for ${row.endpointArn}: ${err?.message ?? err}`,
        );
      }
    }
    await this.prisma.pushToken.deleteMany({ where: { userId, token } });
  }

  /**
   * Publish a notification to every device registered against a user.
   * Endpoints without an ARN yet (registration-time SNS failure)
   * are lazily created here so no push is lost after transient issues.
   */
  async send(userId: string, payload: PushPayload): Promise<void> {
    const tokens = await this.prisma.pushToken.findMany({
      where: { userId },
      select: { id: true, token: true, platform: true, endpointArn: true },
    });
    if (tokens.length === 0) return;

    const stale: string[] = [];

    await Promise.all(
      tokens.map(async (t) => {
        let endpointArn = t.endpointArn;
        if (!endpointArn) {
          const platformArn = this.platformArnFor(t.platform);
          if (!platformArn) return;
          try {
            const res = await this.sns.send(
              new CreatePlatformEndpointCommand({
                PlatformApplicationArn: platformArn,
                Token: t.token,
                CustomUserData: JSON.stringify({ userId }),
              }),
            );
            endpointArn = res.EndpointArn ?? null;
            if (endpointArn) {
              await this.prisma.pushToken.update({
                where: { id: t.id },
                data: { endpointArn },
              });
            }
          } catch (err: any) {
            this.logger.warn(
              `Lazy endpoint create failed for token ${t.token.slice(-8)}: ${err?.message ?? err}`,
            );
            return;
          }
        }
        if (!endpointArn) return;

        try {
          await this.sns.send(
            new PublishCommand({
              TargetArn: endpointArn,
              MessageStructure: 'json',
              Message: buildSnsPayload(t.platform, payload),
            }),
          );
        } catch (err: any) {
          const code = err?.name ?? err?.Code ?? '';
          // EndpointDisabledException = APNs / FCM rejected our token
          // (uninstalled app, permission revoked, etc.). Prune so we
          // don't keep hammering it.
          if (code === 'EndpointDisabledException' || code === 'InvalidParameter') {
            stale.push(t.token);
          } else {
            this.logger.warn(
              `SNS Publish failed for ${endpointArn}: ${err?.message ?? err}`,
            );
          }
        }
      }),
    );

    if (stale.length) {
      await this.prisma.pushToken.deleteMany({ where: { token: { in: stale } } });
      this.logger.log(`Pruned ${stale.length} stale push token(s) for user ${userId}.`);
    }
  }
}

/**
 * SNS accepts one publish call that fans out to APNS / FCM as long as
 * MessageStructure='json' and the top-level keys name each transport.
 * We build a platform-specific inner payload here so both stores get a
 * notification that matches their native shape.
 */
function buildSnsPayload(platform: string, payload: PushPayload): string {
  const dataPairs = payload.data ?? {};
  const wrapper: Record<string, string> = { default: payload.body };
  if (platform === 'ios') {
    // APNS payload — production ARN sends via APNS, sandbox via
    // APNS_SANDBOX. Providing both lets the same SNS call target
    // either build without a code change; SNS ignores the mismatch.
    const apns = JSON.stringify({
      aps: {
        alert: { title: payload.title, body: payload.body },
        sound: 'default',
        badge: 1,
      },
      ...dataPairs,
    });
    wrapper.APNS = apns;
    wrapper.APNS_SANDBOX = apns;
  }
  if (platform === 'android') {
    // FCM payload — GCM key is what SNS expects even for FCM v1.
    wrapper.GCM = JSON.stringify({
      notification: { title: payload.title, body: payload.body },
      data: dataPairs,
    });
  }
  return JSON.stringify(wrapper);
}
