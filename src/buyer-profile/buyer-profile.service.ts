import {
  Injectable,
  BadRequestException,
  NotFoundException,
  GoneException,
} from '@nestjs/common';
import {
  IsInt,
  IsOptional,
  IsString,
  IsArray,
  IsEmail,
  Min,
} from 'class-validator';
import { randomBytes } from 'crypto';
import Stripe from 'stripe';
import { Resend } from 'resend';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { publicUrlFor, storedFilename } from '../common/storage';
import { isKycVerified } from '../common/kyc';

// All fields decorated so that the global ValidationPipe (whitelist: true)
// keeps them in the request body instead of stripping them.
export class UpdateBuyerProfileDto {
  @IsOptional() @IsString() tier?: string | null;
  @IsOptional() @IsString() idDocumentType?: string | null;
  @IsOptional() @IsString() idDocumentUrl?: string | null;
  @IsOptional() @IsString() fundsType?: string | null;
  @IsOptional() @IsInt() @Min(0) fundsAmount?: number | null;
  @IsOptional() @IsString() fundsDocumentUrl?: string | null;
  @IsOptional() @IsString() chainPosition?: string | null;
  @IsOptional() @IsString() solicitorStatus?: string | null;
  @IsOptional() @IsString() timeline?: string | null;
  @IsOptional() @IsString() propertyType?: string | null;
  @IsOptional() @IsString() statement?: string | null;
  @IsOptional() @IsInt() @Min(0) completedSteps?: number;
}

export class SignProfileDto {
  @IsOptional() @IsString() signatureData?: string | null;
  @IsOptional() @IsString() signedName?: string | null;
}

export class CreateShareDto {
  @IsOptional() @IsString() recipientName?: string | null;
  @IsOptional() @IsEmail() recipientEmail?: string | null;
  @IsOptional() @IsArray() scope?: string[];
  @IsOptional() @IsInt() @Min(1) expiresInDays?: number; // agent-configurable
}

// Tier price book (GBP pence). No free tier — "Identity Verified" (identity
// + funds + AML) is the only purchasable tier, £19.99, matching the single
// KYC price point used app-wide (see PaymentService's owner-claim pricing).
// "UNVERIFIED" is the pre-payment default on BuyerProfile.tier; it's not in
// this allow-list so it can never be set directly, only defaulted by Prisma.
export const TIER_PRICES_GBP_PENCE: Record<string, number> = {
  VERIFIED: 1999,
};
const ALLOWED_TIERS = new Set(['VERIFIED']);

// Strength score breakdown — single source of truth, used on every upsert.
// Mirrors the prototype's 5-section weighting plus credentials.
function computeStrengthScore(p: any): number {
  let score = 0;
  if (p?.idDocumentType) score += 15;
  if (p?.idVerified) score += 20; // bonus when Persona has actually verified
  if (p?.fundsType) score += 10;
  if (p?.fundsAmount) score += 5;
  if (p?.fundsVerified) score += 15;
  if (p?.chainPosition) score += 15;
  if (p?.solicitorStatus === 'yes') score += 5;
  else if (p?.solicitorStatus) score += 2;
  if (p?.timeline) score += 3;
  if (p?.propertyType) score += 2;
  if (p?.statement && p.statement.length >= 30) score += 5;
  return Math.min(100, Math.max(0, score));
}

// 6-char alphanumeric short code. Excludes I/O/0/1 for legibility.
function generatePublicRef(): string {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

// 22-char URL-safe token for share links. Cryptographically random.
function generateShareToken(): string {
  return randomBytes(16).toString('base64url');
}

@Injectable()
export class BuyerProfileService {
  private stripe: Stripe | null;
  private resend: Resend;
  private groq: OpenAI;
  private readonly EMAIL_FROM =
    process.env.RESEND_FROM ?? 'UMovingU <onboarding@resend.dev>';

  constructor(private prisma: PrismaService) {
    const key = process.env.STRIPE_SECRET_KEY;
    this.stripe = key ? new Stripe(key, { apiVersion: '2024-06-20' as any }) : null;
    this.resend = new Resend(process.env.RESEND_API_KEY ?? '');
    this.groq = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }

  /** Same env-driven fallback pattern used elsewhere for outbound email links. */
  private frontendBaseUrl(): string {
    return (
      process.env.FRONTEND_URL ??
      (process.env.NODE_ENV === 'production'
        ? 'https://demo-umu-frontend.vercel.app'
        : 'http://localhost:3000')
    );
  }

  async getMine(userId: string) {
    const profile = await this.prisma.buyerProfile.findUnique({
      where: { userId },
    });
    if (!profile) return profile;
    // idVerified on this row is never written anywhere (a Phase-2 Persona
    // hook that was never wired up) — always false in practice. The real
    // signal is User.kycStatus, so override with that instead of trusting
    // the dead column.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { kycStatus: true },
    });
    return { ...profile, idVerified: isKycVerified(user) };
  }

  /**
   * Upload a Proof of Funds or Mortgage in Principle document. Sets the
   * matching review status to "pending" and explicitly clears any prior
   * verified flag — a re-upload (e.g. after a rejection) must go through
   * review again, not silently keep an old approval.
   */
  async uploadReviewDocument(userId: string, kind: string, file: any) {
    if (!file) throw new BadRequestException('No file provided');
    if (kind !== 'funds' && kind !== 'mortgage') {
      throw new BadRequestException('kind must be "funds" or "mortgage"');
    }
    const fileUrl = publicUrlFor('documents', storedFilename(file));
    const profile = await this.prisma.buyerProfile.upsert({
      where: { userId },
      create: {
        userId,
        publicRef: await this.mintUniquePublicRef(),
        strengthScore: 0,
        ...(kind === 'funds'
          ? { fundsDocumentUrl: fileUrl, fundsReviewStatus: 'pending', fundsVerified: false }
          : { mortgageAipUrl: fileUrl, mortgageAipReviewStatus: 'pending', mortgageAipVerified: false }),
      },
      update:
        kind === 'funds'
          ? { fundsDocumentUrl: fileUrl, fundsReviewStatus: 'pending', fundsVerified: false, fundsVerifiedAt: null }
          : { mortgageAipUrl: fileUrl, mortgageAipReviewStatus: 'pending', mortgageAipVerified: false, mortgageAipVerifiedAt: null },
    });
    return { fileUrl, reviewStatus: 'pending', profile };
  }

  /** Admin queue: every profile with an uploaded doc still awaiting review. */
  async listPendingReviews() {
    const profiles = await this.prisma.buyerProfile.findMany({
      where: { OR: [{ fundsReviewStatus: 'pending' }, { mortgageAipReviewStatus: 'pending' }] },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    // Flatten into one row per pending document so the admin UI doesn't
    // need to know about the two-fields-per-profile shape.
    const items: Array<Record<string, any>> = [];
    for (const p of profiles as any[]) {
      const buyerName = [p.user?.firstName, p.user?.lastName].filter(Boolean).join(' ') || p.user?.email;
      if (p.fundsReviewStatus === 'pending') {
        items.push({ profileId: p.id, kind: 'funds', buyerName, email: p.user?.email, documentUrl: p.fundsDocumentUrl, fundsType: p.fundsType, fundsAmount: p.fundsAmount });
      }
      if (p.mortgageAipReviewStatus === 'pending') {
        items.push({ profileId: p.id, kind: 'mortgage', buyerName, email: p.user?.email, documentUrl: p.mortgageAipUrl });
      }
    }
    return items;
  }

  /** Admin decision on one uploaded document — approve flips the verified flag, reject clears the upload so the user re-submits. */
  async reviewDocument(profileId: string, kind: string, decision: string) {
    if (kind !== 'funds' && kind !== 'mortgage') {
      throw new BadRequestException('kind must be "funds" or "mortgage"');
    }
    if (decision !== 'approve' && decision !== 'reject') {
      throw new BadRequestException('decision must be "approve" or "reject"');
    }
    const profile = await this.prisma.buyerProfile.findUnique({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Buyer profile not found');

    const approved = decision === 'approve';
    const data =
      kind === 'funds'
        ? {
            fundsReviewStatus: approved ? 'approved' : 'rejected',
            fundsVerified: approved,
            fundsVerifiedAt: approved ? new Date() : null,
          }
        : {
            mortgageAipReviewStatus: approved ? 'approved' : 'rejected',
            mortgageAipVerified: approved,
            mortgageAipVerifiedAt: approved ? new Date() : null,
          };
    const updated = await this.prisma.buyerProfile.update({ where: { id: profileId }, data });
    return { ...updated, strengthScore: computeStrengthScore(updated) };
  }

  /**
   * "Let AI write a compelling story" on the buyer-profile builder used to
   * POST straight to the general-purpose /chat endpoint with an OpenAI-style
   * { messages: [...] } body — that endpoint's ChatDto requires a single
   * `message` string, so every call failed validation with a 400 before it
   * ever reached the model. It's also the wrong endpoint conceptually: /chat
   * runs a property-assistant persona with tool-calling (get_passport_status
   * etc.), not a plain short-form writing task. This is a dedicated,
   * narrowly-scoped completion instead, built from the user's OWN saved
   * profile signals (server-side truth) rather than trusting whatever the
   * client claims about itself.
   */
  async generateStory(userId: string, existingDraft?: string): Promise<{ text: string }> {
    const profile = await this.prisma.buyerProfile.findUnique({ where: { userId } });
    const signals: string[] = [];
    if (profile?.chainPosition) signals.push(`chain position: ${profile.chainPosition}`);
    if (profile?.timeline) signals.push(`timeline: ${profile.timeline}`);
    if (profile?.fundsType) signals.push(`funds type: ${profile.fundsType}`);
    if (profile?.fundsAmount) signals.push(`max budget: £${profile.fundsAmount.toLocaleString('en-GB')}`);
    if (profile?.solicitorStatus) signals.push(`solicitor: ${profile.solicitorStatus}`);
    if (profile?.propertyType) signals.push(`looking for: ${profile.propertyType}`);

    const draft = (existingDraft ?? '').trim();
    const prompt = `You write short, sincere 80-120 word intros from UK home buyers to sellers. Plain English, no hype, first-person, no clichés. End with one line about being ready to move quickly. Do not invent personal details or numbers beyond what's given.

Known profile signals: ${signals.join('; ') || 'none yet'}.
${draft ? `Rewrite this draft to be warmer and clearer, keeping the facts:\n${draft}` : 'Draft a short intro for a UK home buyer to share with a seller.'}`;

    const completion = await this.groq.chat.completions.create({
      // llama-3.3-70b-versatile was retired from Groq's catalog — see the
      // matching note in chat.service.ts. gpt-oss-120b replaces it here too.
      // It's a reasoning model: it burns tokens on a separate `reasoning`
      // field before writing `content`, so max_tokens has to cover both or
      // the response gets cut off (finish_reason "length") with empty
      // content — confirmed live. reasoning_effort 'low' keeps that
      // overhead small for a task this short.
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
      temperature: 0.6,
      reasoning_effort: 'low',
    } as any);
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) throw new BadRequestException('AI did not return a draft — try again.');
    return { text };
  }

  async upsert(userId: string, dto: UpdateBuyerProfileDto) {
    const ALLOWED = [
      'tier',
      'idDocumentType',
      'idDocumentUrl',
      'fundsType',
      'fundsAmount',
      'fundsDocumentUrl',
      'chainPosition',
      'solicitorStatus',
      'timeline',
      'propertyType',
      'statement',
      'completedSteps',
    ] as const;

    const src = (dto ?? {}) as Record<string, any>;
    const data: Record<string, any> = {};
    for (const k of ALLOWED) {
      if (Object.prototype.hasOwnProperty.call(src, k)) {
        const v = src[k];
        if (k === 'tier' && typeof v === 'string') {
          const upper = v.toUpperCase();
          if (ALLOWED_TIERS.has(upper)) data[k] = upper;
          continue;
        }
        data[k] = v;
      }
    }

    // Re-compute strength against the merged future state.
    const current = await this.prisma.buyerProfile.findUnique({ where: { userId } });
    const merged = { ...(current ?? {}), ...data };
    data.strengthScore = computeStrengthScore(merged);

    // Create path: also mint a publicRef short-code (retry on collision).
    if (!current) {
      data.publicRef = await this.mintUniquePublicRef();
    }

    return this.prisma.buyerProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  async publish(userId: string) {
    const existing = await this.prisma.buyerProfile.findUnique({
      where: { userId },
    });
    if (!existing) {
      throw new NotFoundException(
        'Buyer profile not found — start by building one first',
      );
    }

    const missing: string[] = [];
    if (!existing.idDocumentType) missing.push('ID document');
    // Funds capture is one of the 4 core Buyer Passport steps (Identity,
    // Buying position, Finance, Chain position) — required for every buyer
    // regardless of tier, not just Verified/Premium. Tier is a separate,
    // optional paid credential on top, not a gate on this core step.
    if (!existing.fundsType) missing.push('Proof of funds type');
    if (!existing.fundsAmount) missing.push('Maximum budget');
    if (!existing.chainPosition) missing.push('Chain position');
    if (missing.length > 0) {
      throw new BadRequestException(
        `Complete required steps first: ${missing.join(', ')}`,
      );
    }

    return this.prisma.buyerProfile.update({
      where: { userId },
      data: {
        published: true,
        publishedAt: new Date(),
        completedSteps: 5,
        strengthScore: computeStrengthScore(existing),
      },
    });
  }

  // ── Digital signature ──────────────────────────────────────────────────────
  // Persist the signature (either canvas data URL or typed name) + a server-
  // truth `signedAt`. Either field can be null/empty as long as the other is
  // present. Clearing both wipes the signature.
  async signProfile(userId: string, dto: SignProfileDto) {
    const profile = await this.prisma.buyerProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Buyer profile not found');
    const hasCanvas = !!dto.signatureData?.startsWith('data:image');
    const hasName = !!dto.signedName?.trim();
    if (!hasCanvas && !hasName) {
      throw new BadRequestException(
        'Provide either signatureData (PNG data URL) or signedName',
      );
    }
    return this.prisma.buyerProfile.update({
      where: { userId },
      data: {
        signatureData: hasCanvas ? dto.signatureData : null,
        signedName: hasName ? dto.signedName!.trim() : null,
        signedAt: new Date(),
      },
    });
  }

  async clearSignature(userId: string) {
    const profile = await this.prisma.buyerProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Buyer profile not found');
    return this.prisma.buyerProfile.update({
      where: { userId },
      data: { signatureData: null, signedName: null, signedAt: null },
    });
  }

  async remove(userId: string) {
    const existing = await this.prisma.buyerProfile.findUnique({
      where: { userId },
    });
    if (!existing) return { message: 'Nothing to delete' };
    await this.prisma.buyerProfile.delete({ where: { userId } });
    return { message: 'Buyer profile deleted' };
  }

  // ── Tier upgrade (Stripe checkout) ─────────────────────────────────────────
  // Creates a one-off PaymentIntent for the tier upgrade — £19.99 Verified.
  // Front-end confirms the PI client-side, then calls confirmTierPayment()
  // with the resulting paymentIntentId to flip the tier.
  async createTierPaymentIntent(userId: string, targetTier: string) {
    const tier = (targetTier || '').toUpperCase();
    const amount = TIER_PRICES_GBP_PENCE[tier];
    if (!amount) {
      throw new BadRequestException('Tier upgrade only available for VERIFIED');
    }
    if (!this.stripe) {
      throw new BadRequestException(
        'Stripe not configured — set STRIPE_SECRET_KEY',
      );
    }
    // Ensure profile row exists before charging.
    const profile = await this.prisma.buyerProfile.upsert({
      where: { userId },
      create: {
        userId,
        publicRef: await this.mintUniquePublicRef(),
        strengthScore: 0,
      },
      update: {},
    });
    const intent = await this.stripe.paymentIntents.create({
      amount,
      currency: 'gbp',
      automatic_payment_methods: { enabled: true },
      metadata: {
        kind: 'buyer-profile-tier-upgrade',
        userId,
        profileId: profile.id,
        targetTier: tier,
      },
    });
    return {
      clientSecret: intent.client_secret,
      amount,
      tier,
    };
  }

  async confirmTierPayment(userId: string, paymentIntentId: string) {
    if (!this.stripe) throw new BadRequestException('Stripe not configured');
    if (!paymentIntentId) throw new BadRequestException('Missing paymentIntentId');
    const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status !== 'succeeded') {
      throw new BadRequestException(
        `Payment not completed (status: ${intent.status})`,
      );
    }
    if (intent.metadata?.userId !== userId) {
      throw new BadRequestException('PaymentIntent does not match this user');
    }
    const target = intent.metadata?.targetTier;
    if (!target || !TIER_PRICES_GBP_PENCE[target]) {
      throw new BadRequestException('PaymentIntent missing targetTier');
    }
    const updated = await this.prisma.buyerProfile.update({
      where: { userId },
      data: {
        tier: target,
        tierPaidAt: new Date(),
        tierPaymentId: paymentIntentId,
      },
    });
    return {
      ...updated,
      strengthScore: computeStrengthScore(updated),
    };
  }

  // ── Activity ticker ────────────────────────────────────────────────────────
  // Prototype shows "1,247 buyers verified this week" on the intro screen.
  // Real query: count profiles published in the last 7 days.
  async getActivityStats() {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [last7d, totalPublished] = await Promise.all([
      this.prisma.buyerProfile.count({
        where: { published: true, publishedAt: { gte: since } },
      }),
      this.prisma.buyerProfile.count({ where: { published: true } }),
    ]);
    return { publishedLast7d: last7d, totalPublished };
  }

  // ── Sharing ────────────────────────────────────────────────────────────────
  async listShares(userId: string) {
    const profile = await this.prisma.buyerProfile.findUnique({
      where: { userId },
    });
    if (!profile) return [];
    return this.prisma.buyerProfileShare.findMany({
      where: { profileId: profile.id },
      orderBy: { sentAt: 'desc' },
    });
  }

  async createShare(userId: string, dto: CreateShareDto) {
    const profile = await this.prisma.buyerProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new NotFoundException('Buyer profile not found');
    }
    if (!profile.published) {
      throw new BadRequestException(
        'Publish your profile before sharing',
      );
    }
    const days =
      typeof dto.expiresInDays === 'number' && dto.expiresInDays > 0
        ? Math.min(365, Math.floor(dto.expiresInDays))
        : 30;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    // Default scope = everything available on the profile.
    const scope =
      Array.isArray(dto.scope) && dto.scope.length > 0
        ? dto.scope
        : ['identity', 'deposit', 'sof', 'afford', 'credit', 'story'];

    const share = await this.prisma.buyerProfileShare.create({
      data: {
        profileId: profile.id,
        token: generateShareToken(),
        recipientName: dto.recipientName ?? null,
        recipientEmail: dto.recipientEmail ?? null,
        scope: scope as any,
        expiresAt,
      },
    });

    // Notify the recipient (agent) by email — this used to only create the
    // DB row, so the "Send to agent" flow showed a success confirmation
    // ("James Cooper has been notified") without ever actually notifying
    // anyone. Non-blocking: the share link itself is already valid even if
    // the email fails to send, so a mail outage doesn't block the feature.
    if (dto.recipientEmail) {
      try {
        await this.sendShareNotificationEmail(
          profile,
          share,
          dto.recipientEmail,
          dto.recipientName ?? null,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[buyer-profile share email] failed for ${dto.recipientEmail}: ${(err as Error).message}`);
      }
    }

    return share;
  }

  /**
   * Formal notification email to an agent/solicitor a buyer has shared
   * their verified profile with. Tone is deliberately professional — this
   * is read by an estate agent deciding whether to progress an offer, not
   * a consumer marketing email.
   */
  private async sendShareNotificationEmail(
    profile: { userId: string; idVerified: boolean; fundsVerified: boolean; tier: string; fundsAmount: number | null; chainPosition: string | null; amlStatus: string | null },
    share: { token: string; expiresAt: Date },
    recipientEmail: string,
    recipientName: string | null,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: profile.userId },
      select: { firstName: true, lastName: true, email: true },
    });
    const buyerName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'A UMovingU buyer';
    const link = `${this.frontendBaseUrl()}/shared-buyer/${share.token}`;
    const expiryDate = share.expiresAt.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    const greeting = recipientName ? `Dear ${recipientName.split(' · ')[0]},` : 'Dear Sir/Madam,';

    const statusRows = [
      `<tr><td style="padding:6px 0;color:#4a4b52;">Identity verification</td><td style="padding:6px 0;text-align:right;font-weight:700;color:${profile.idVerified ? '#00a19a' : '#c73e36'};">${profile.idVerified ? 'Verified' : 'Not yet verified'}</td></tr>`,
      `<tr><td style="padding:6px 0;color:#4a4b52;">Proof of funds</td><td style="padding:6px 0;text-align:right;font-weight:700;color:${profile.fundsVerified ? '#00a19a' : '#c73e36'};">${profile.fundsVerified ? 'Verified' : 'Not yet verified'}</td></tr>`,
      profile.amlStatus
        ? `<tr><td style="padding:6px 0;color:#4a4b52;">AML status</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#1f2024;">${profile.amlStatus}</td></tr>`
        : '',
      profile.fundsAmount
        ? `<tr><td style="padding:6px 0;color:#4a4b52;">Stated budget</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#1f2024;">up to £${profile.fundsAmount.toLocaleString('en-GB')}</td></tr>`
        : '',
    ].filter(Boolean).join('');

    const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#ffffff;color:#1f2024;">
  <p style="margin:0 0 16px;">${greeting}</p>
  <p style="margin:0 0 16px;line-height:1.6;">
    ${buyerName} has shared their verified UMovingU Buyer Profile with you
    ahead of a property enquiry. This profile confirms the buyer's identity
    and financial credentials as verified below, so you can assess the
    strength of any offer they make with confidence.
  </p>
  <table style="width:100%;border-collapse:collapse;margin:20px 0;border-top:1px solid #e5e5ea;border-bottom:1px solid #e5e5ea;padding:4px 0;">
    ${statusRows}
  </table>
  <div style="text-align:center;margin:28px 0;">
    <a href="${link}" style="display:inline-block;background:#00a19a;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700;font-size:15px;">View Verified Buyer Profile</a>
  </div>
  <p style="margin:0 0 16px;line-height:1.6;color:#4a5876;font-size:13px;">
    This link is valid until ${expiryDate} and may be revoked by the buyer at
    any time. The full profile, including a downloadable PDF, is available
    at the link above.
  </p>
  <p style="margin:24px 0 0;line-height:1.6;">
    Kind regards,<br />The UMovingU Team
  </p>
  <hr style="border:none;border-top:1px solid #e5e5ea;margin:24px 0;" />
  <p style="color:#b4b5b8;font-size:11px;text-align:center;margin:0;">UMovingU · This is an automated notification sent on behalf of a verified UMovingU user.</p>
</div>`;

    const result = await this.resend.emails.send({
      from: this.EMAIL_FROM,
      to: recipientEmail,
      subject: `Verified Buyer Profile shared with you — ${buyerName}`,
      html,
    });
    if (result.error) {
      throw new Error(`Resend rejected the share-notification send: ${JSON.stringify(result.error)}`);
    }
  }

  async revokeShare(userId: string, shareId: string) {
    const share = await this.prisma.buyerProfileShare.findUnique({
      where: { id: shareId },
      include: { profile: true },
    });
    if (!share || share.profile.userId !== userId) {
      throw new NotFoundException('Share not found');
    }
    if (share.revokedAt) return share;
    return this.prisma.buyerProfileShare.update({
      where: { id: shareId },
      data: { revokedAt: new Date() },
    });
  }

  // Public read for shared-buyer/[token] — no auth, scope-filtered, increments
  // view counter, 410s on revoke/expiry.
  async getPublicShare(token: string) {
    const share = await this.prisma.buyerProfileShare.findUnique({
      where: { token },
      include: { profile: true },
    });
    if (!share) throw new NotFoundException('Share link not found');
    if (share.revokedAt) {
      throw new GoneException('This share has been revoked');
    }
    if (share.expiresAt.getTime() < Date.now()) {
      throw new GoneException('This share has expired');
    }
    // Increment view counter (fire-and-forget shape, but await for correctness)
    await this.prisma.buyerProfileShare.update({
      where: { id: share.id },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    });
    const p: any = share.profile;
    const scopeSet = new Set((share.scope as any) as string[]);
    // Scope filter: only return fields the agent was granted.
    const out: Record<string, any> = {
      publicRef: p.publicRef,
      tier: p.tier,
      strengthScore: p.strengthScore,
      publishedAt: p.publishedAt,
      sharedTo: share.recipientName,
      expiresAt: share.expiresAt,
    };
    if (scopeSet.has('identity')) {
      out.identity = {
        idDocumentType: p.idDocumentType,
        idVerified: p.idVerified,
        idVerifiedAt: p.idVerifiedAt,
      };
    }
    if (scopeSet.has('deposit')) {
      out.deposit = {
        fundsType: p.fundsType,
        fundsAmount: p.fundsAmount,
        fundsAmountVerified: p.fundsAmountVerified,
        fundsVerified: p.fundsVerified,
        fundsVerifiedAt: p.fundsVerifiedAt,
      };
    }
    if (scopeSet.has('sof')) {
      out.sourceOfFunds = p.sourceOfFundsJson;
      out.amlStatus = p.amlStatus;
    }
    if (scopeSet.has('afford')) {
      out.affordabilityScore = p.affordabilityScore;
    }
    if (scopeSet.has('story')) {
      out.statement = p.statement;
    }
    // Always include chain + timeline + solicitor (these are non-financial)
    out.chainPosition = p.chainPosition;
    out.timeline = p.timeline;
    out.solicitorStatus = p.solicitorStatus;
    return out;
  }

  // ── Internal helpers ───────────────────────────────────────────────────────
  private async mintUniquePublicRef(): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const candidate = generatePublicRef();
      const clash = await this.prisma.buyerProfile.findUnique({
        where: { publicRef: candidate },
      });
      if (!clash) return candidate;
    }
    // Cosmically unlikely; widen the alphabet by appending random bytes.
    return generatePublicRef() + randomBytes(2).toString('hex').toUpperCase();
  }
}
