import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging';
import { PrismaService } from '../prisma/prisma.service';

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private enabled = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
      this.logger.warn(
        'FIREBASE_SERVICE_ACCOUNT not set — push notifications disabled (sends become no-ops).',
      );
      return;
    }

    try {
      const credentials = JSON.parse(raw);
      if (getApps().length === 0) {
        initializeApp({ credential: cert(credentials) });
      }
      this.enabled = true;
      this.logger.log(`Firebase Admin initialised (project=${credentials.project_id}).`);
    } catch (err: any) {
      this.logger.error(
        `Failed to initialise Firebase Admin: ${err?.message ?? err} — push notifications disabled.`,
      );
    }
  }

  async registerToken(
    userId: string,
    token: string,
    platform: string,
    deviceId?: string,
  ) {
    if (!token || !platform) return;
    await this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform, deviceId: deviceId ?? null },
      update: { userId, platform, deviceId: deviceId ?? null, lastSeenAt: new Date() },
    });
  }

  async unregisterToken(userId: string, token: string) {
    if (!token) return;
    await this.prisma.pushToken.deleteMany({ where: { userId, token } });
  }

  async send(userId: string, payload: PushPayload): Promise<void> {
    if (!this.enabled) return;

    const tokens = await this.prisma.pushToken.findMany({
      where: { userId },
      select: { token: true },
    });
    if (tokens.length === 0) return;

    const message: MulticastMessage = {
      tokens: tokens.map((t) => t.token),
      notification: { title: payload.title, body: payload.body },
      data: payload.data ?? {},
      apns: {
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    };

    try {
      const res = await getMessaging().sendEachForMulticast(message);
      if (res.failureCount > 0) {
        const stale: string[] = [];
        res.responses.forEach((r, i) => {
          if (r.success) return;
          const code = r.error?.code;
          if (
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/registration-token-not-registered'
          ) {
            stale.push(message.tokens[i]);
          }
        });
        if (stale.length) {
          await this.prisma.pushToken.deleteMany({ where: { token: { in: stale } } });
          this.logger.log(`Pruned ${stale.length} stale push token(s) for user ${userId}.`);
        }
      }
    } catch (err: any) {
      this.logger.error(`send() failed for user ${userId}: ${err?.message ?? err}`);
    }
  }
}
