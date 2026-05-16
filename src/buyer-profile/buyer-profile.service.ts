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
import { PrismaService } from '../prisma/prisma.service';

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

// Tier price book (GBP pence). Basic free, Verified £29, Premium £79.
export const TIER_PRICES_GBP_PENCE: Record<string, number> = {
  VERIFIED: 2900,
  PREMIUM: 7900,
};
const ALLOWED_TIERS = new Set(['BASIC', 'VERIFIED', 'PREMIUM']);

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
  if (p?.tier === 'PREMIUM') score += 5;
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
  constructor(private prisma: PrismaService) {
    const key = process.env.STRIPE_SECRET_KEY;
    this.stripe = key ? new Stripe(key, { apiVersion: '2024-06-20' as any }) : null;
  }

  async getMine(userId: string) {
    return this.prisma.buyerProfile.findUnique({ where: { userId } });
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
    // Funds capture only required for Verified / Premium tiers — Basic just
    // proves identity + chain so we don't block publish on missing budget.
    const requiresFunds =
      (existing as any).tier && (existing as any).tier !== 'BASIC';
    if (requiresFunds && !existing.fundsType) missing.push('Proof of funds type');
    if (requiresFunds && !existing.fundsAmount) missing.push('Maximum budget');
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
  // Creates a one-off PaymentIntent for the tier upgrade. £29 Verified / £79
  // Premium. Front-end confirms the PI client-side, then calls
  // confirmTierPayment() with the resulting paymentIntentId to flip the tier.
  async createTierPaymentIntent(userId: string, targetTier: string) {
    const tier = (targetTier || '').toUpperCase();
    const amount = TIER_PRICES_GBP_PENCE[tier];
    if (!amount) {
      throw new BadRequestException(
        'Tier upgrade only available for VERIFIED or PREMIUM',
      );
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

    return this.prisma.buyerProfileShare.create({
      data: {
        profileId: profile.id,
        token: generateShareToken(),
        recipientName: dto.recipientName ?? null,
        recipientEmail: dto.recipientEmail ?? null,
        scope: scope as any,
        expiresAt,
      },
    });
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
