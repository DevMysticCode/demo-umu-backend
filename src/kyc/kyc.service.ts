import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

const PERSONA_API_URL = 'https://api.withpersona.com/api/v1';

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(private prisma: PrismaService) {}

  private get apiKey(): string {
    const k = process.env.PERSONA_API_KEY;
    if (!k) throw new Error('PERSONA_API_KEY is not set');
    return k;
  }

  private get templateId(): string {
    const t = process.env.PERSONA_TEMPLATE_ID;
    if (!t) throw new Error('PERSONA_TEMPLATE_ID is not set');
    return t;
  }

  /**
   * Persona uses the prefix to tell us which API to hit:
   *   itmpl_ → /inquiries          → returns inquiry { id: "inq_…", status }
   *   ctmpl_ → /cases               → returns case    { id: "case_…", status }
   *   vtmpl_ → /verifications       → rare, treat like inquiry
   */
  private get isCaseTemplate(): boolean {
    return this.templateId.startsWith('ctmpl_');
  }

  /**
   * Start a KYC inquiry/case for the given user. If they're already approved
   * we short-circuit and return the existing record — KYC is per-user, one-time.
   */
  async startInquiry(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.kycStatus === 'approved') {
      return {
        status: 'approved',
        alreadyVerified: true,
        inquiryId: user.kycInquiryId,
      };
    }

    // Reuse an existing pending inquiry rather than creating duplicates.
    if (user.kycInquiryId && user.kycStatus === 'pending') {
      const fresh = await this.fetchRemote(user.kycInquiryId);
      if (fresh) {
        await this.persistStatus(userId, user.kycInquiryId, fresh.status);
        if (fresh.status === 'pending' || fresh.status === 'created') {
          return {
            status: 'pending',
            inquiryId: user.kycInquiryId,
            hostedUrl: this.hostedUrl(user.kycInquiryId),
          };
        }
      }
    }

    // Create a new inquiry/case via the Persona API.
    const path = this.isCaseTemplate ? '/cases' : '/inquiries';
    const attrKey = this.isCaseTemplate ? 'case-template-id' : 'inquiry-template-id';

    const body = {
      data: {
        attributes: {
          [attrKey]: this.templateId,
          'reference-id': userId, // we get this back in webhooks
          fields: {
            'name-first': user.firstName ?? undefined,
            'name-last': user.lastName ?? undefined,
            'email-address': user.email,
          },
        },
      },
    };

    let res: any;
    try {
      const r = await fetch(`${PERSONA_API_URL}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Persona-Version': '2023-01-05',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      res = await r.json();
      if (!r.ok) {
        this.logger.error(
          `Persona ${path} failed: ${r.status} ${JSON.stringify(res)}`,
        );
        throw new BadRequestException(
          res?.errors?.[0]?.title ?? `Persona API error (${r.status})`,
        );
      }
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Persona network error: ${err.message}`);
      throw new BadRequestException(
        'Could not start identity verification — please try again.',
      );
    }

    const remoteId = res?.data?.id;
    const remoteStatus = res?.data?.attributes?.status ?? 'pending';
    if (!remoteId) {
      throw new BadRequestException('Persona did not return an inquiry id.');
    }

    await this.persistStatus(userId, remoteId, remoteStatus);

    return {
      status: this.normaliseStatus(remoteStatus),
      inquiryId: remoteId,
      hostedUrl: this.hostedUrl(remoteId),
    };
  }

  /**
   * Polled by the frontend after the user comes back from the hosted flow.
   * Pulls the latest status from Persona, persists it, and returns the
   * normalised result.
   */
  async getStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        kycStatus: true,
        kycInquiryId: true,
        kycCompletedAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.kycInquiryId) {
      return { status: 'not_started', inquiryId: null };
    }

    // If we've already settled (approved/declined), don't keep hitting Persona.
    if (
      user.kycStatus === 'approved' ||
      user.kycStatus === 'declined' ||
      user.kycStatus === 'failed'
    ) {
      return {
        status: user.kycStatus,
        inquiryId: user.kycInquiryId,
        completedAt: user.kycCompletedAt,
      };
    }

    const fresh = await this.fetchRemote(user.kycInquiryId);
    if (!fresh) {
      return { status: user.kycStatus ?? 'pending', inquiryId: user.kycInquiryId };
    }
    await this.persistStatus(userId, user.kycInquiryId, fresh.status);
    return {
      status: this.normaliseStatus(fresh.status),
      inquiryId: user.kycInquiryId,
    };
  }

  /**
   * Webhook handler. Persona signs every webhook with HMAC-SHA256 over the
   * raw request body using the signing secret as the key — verify before
   * trusting any payload.
   *
   * Header format: `t=<timestamp>,v1=<hex-signature>`
   */
  async handleWebhook(rawBody: string, signatureHeader: string | undefined) {
    const secret = process.env.PERSONA_WEBHOOK_SECRET;
    if (!secret) {
      this.logger.warn('Webhook hit but PERSONA_WEBHOOK_SECRET is unset.');
      return { ok: false };
    }
    if (!signatureHeader) {
      throw new BadRequestException('Missing Persona-Signature header');
    }

    // Parse and verify signature. Persona-Signature: t=…,v1=…
    const parts = Object.fromEntries(
      signatureHeader.split(',').map((p) => p.split('=')),
    ) as { t?: string; v1?: string };

    if (!parts.t || !parts.v1) {
      throw new BadRequestException('Malformed Persona-Signature header');
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${parts.t}.${rawBody}`)
      .digest('hex');

    if (
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1))
    ) {
      throw new BadRequestException('Invalid Persona signature');
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException('Invalid JSON');
    }

    const eventName = payload?.data?.attributes?.name as string | undefined;
    const eventPayload = payload?.data?.attributes?.payload?.data;
    const remoteId = eventPayload?.id as string | undefined;
    const remoteStatus = eventPayload?.attributes?.status as string | undefined;
    const referenceId =
      (eventPayload?.attributes?.['reference-id'] as string | undefined) ??
      undefined;

    if (!eventName || !remoteId || !remoteStatus) {
      this.logger.warn(`Webhook payload incomplete: ${eventName}`);
      return { ok: true };
    }

    // Look up user by reference-id (we passed userId at create time) or
    // by stored kycInquiryId as a fallback.
    const user =
      (referenceId &&
        (await this.prisma.user.findUnique({
          where: { id: referenceId },
        }))) ||
      (await this.prisma.user.findFirst({
        where: { kycInquiryId: remoteId },
      }));

    if (!user) {
      this.logger.warn(`Webhook ${eventName} for unknown user (id=${remoteId})`);
      return { ok: true };
    }

    await this.persistStatus(user.id, remoteId, remoteStatus);
    this.logger.log(
      `[KYC] ${eventName} → ${remoteStatus} (user=${user.id}, inquiry=${remoteId})`,
    );
    return { ok: true };
  }

  // ── helpers ───────────────────────────────────────────────

  private async fetchRemote(remoteId: string) {
    const path = this.idIsCase(remoteId) ? '/cases' : '/inquiries';
    try {
      const r = await fetch(`${PERSONA_API_URL}${path}/${remoteId}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Persona-Version': '2023-01-05',
        },
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        this.logger.error(
          `Persona ${path}/${remoteId} → ${r.status} ${txt.slice(0, 300)}`,
        );
        return null;
      }
      const j = await r.json();
      const status = (j?.data?.attributes?.status as string) ?? 'pending';
      this.logger.log(`[KYC] poll ${remoteId} → ${status}`);
      return { status };
    } catch (err: any) {
      this.logger.error(`Persona poll network error: ${err?.message}`);
      return null;
    }
  }

  private idIsCase(id: string): boolean {
    return id.startsWith('case_');
  }

  /**
   * Persona returns a wide range of status strings depending on the template
   * and decision logic. Map them to the four states the frontend cares about.
   */
  private normaliseStatus(remote: string): string {
    const s = remote.toLowerCase();
    if (s === 'approved' || s === 'completed' || s === 'passed') return 'approved';
    if (s === 'declined' || s === 'failed') return 'declined';
    if (s === 'needs_review' || s === 'needs-review' || s === 'open')
      return 'needs_review';
    return 'pending';
  }

  private async persistStatus(
    userId: string,
    inquiryId: string,
    remoteStatus: string,
  ) {
    const status = this.normaliseStatus(remoteStatus);
    const data: any = { kycStatus: status, kycInquiryId: inquiryId };
    if (status === 'approved') {
      data.kycCompletedAt = new Date();
      data.isVerified = true;
    }
    if (status === 'declined' || status === 'failed') {
      data.kycCompletedAt = new Date();
    }
    await this.prisma.user.update({ where: { id: userId }, data });
  }

  /**
   * The hosted-flow URL the user opens to complete verification. Persona's
   * hosted flow accepts the inquiry/case id in a query string and handles
   * the upload, liveness, and AML steps in their UI.
   */
  private hostedUrl(remoteId: string): string {
    // Public Persona hosted flow.
    // Format: https://withpersona.com/verify?inquiry-id=inq_…
    // For cases the param name is `case-id`. The same domain handles both.
    const param = remoteId.startsWith('case_') ? 'case-id' : 'inquiry-id';
    return `https://withpersona.com/verify?${param}=${remoteId}`;
  }
}
