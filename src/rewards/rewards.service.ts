import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma, JourneyType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

const PRISMA_UNIQUE_CONSTRAINT_ERROR = 'P2002';

export interface AwardMetadata {
  passportId?: string;
  sectionKey?: string;
  questionTemplateId?: string;
  [key: string]: unknown;
}

export interface AwardOptions {
  // Overrides RewardAction's default journeyType — needed for actions like
  // OWNERSHIP_VERIFIED that are shared across journeys (see seed script
  // comment); the caller knows the real journey (e.g. passport.type) at
  // award time even though the config row doesn't.
  journeyType?: JourneyType;
  passportId?: string;
  propertyId?: string;
  description?: string;
  metadata?: AwardMetadata;
}

@Injectable()
export class RewardsService {
  constructor(private prisma: PrismaService) {}

  // Generic, config-driven award path — every new hook (KYC, ownership
  // verified, passport complete, ...) should call this rather than writing
  // its own ledger/balance logic. Looks up points/stamp/verification rules
  // from RewardAction by actionKey so they stay editable without a code
  // change. Idempotent per (userId, actionKey, subjectId) via a DB-level
  // unique constraint — safe under races/retries/duplicate webhook
  // deliveries, same guarantee awardForQuestion already relied on.
  //
  // subjectId scopes "first time" — pass the id of whatever this action is
  // about (a propertyId for OWNERSHIP_VERIFIED, a passportId for
  // CORE_PASSPORT_COMPLETE, the userId itself for a pure account-level
  // action like ACCOUNT_CREATED) so the same milestone can recur across
  // different properties/passports for the same user where that's the
  // intended behaviour (e.g. a landlord claiming multiple properties).
  async award(userId: string, actionKey: string, subjectId: string, opts: AwardOptions = {}) {
    const action = await this.prisma.rewardAction.findUnique({ where: { actionKey } });
    if (!action || !action.active || !action.points || action.points <= 0) return null;

    const status = action.verificationRequired ? 'PENDING' : 'CONFIRMED';
    const journeyType = opts.journeyType ?? action.journeyType;

    try {
      const entry = await this.prisma.$transaction(async (tx: Tx) => {
        let balanceAfter: number;
        if (status === 'CONFIRMED') {
          const updatedUser = await tx.user.update({
            where: { id: userId },
            data: { rewardPointsBalance: { increment: action.points } },
          });
          balanceAfter = updatedUser.rewardPointsBalance;
        } else {
          // Reserves the idempotency slot without touching the visible
          // balance yet — see confirmAward().
          const user = await tx.user.findUniqueOrThrow({
            where: { id: userId },
            select: { rewardPointsBalance: true },
          });
          balanceAfter = user.rewardPointsBalance;
        }

        const created = await tx.pointsLedgerEntry.create({
          data: {
            userId,
            type: actionKey,
            actionKey,
            subjectId,
            amount: action.points,
            balanceAfter,
            description: opts.description ?? action.label,
            journeyType,
            passportId: opts.passportId,
            propertyId: opts.propertyId,
            status: status as any,
            metadata: opts.metadata as any,
          },
        });

        if (action.stampKey && status === 'CONFIRMED') {
          await this.mintStamp(tx, userId, action.stampKey, opts.passportId, opts.propertyId);
        }

        return created;
      });
      return entry;
    } catch (e: any) {
      if (e?.code === PRISMA_UNIQUE_CONSTRAINT_ERROR) return null; // already awarded — no-op
      throw e;
    }
  }

  // Flips a PENDING award to CONFIRMED and applies the balance increment
  // that was deferred at award time. Used for actions seeded with
  // verificationRequired: true (currently only ACCOUNT_CREATED — pending
  // until email/mobile is verified).
  async confirmAward(userId: string, actionKey: string, subjectId: string) {
    return this.prisma.$transaction(async (tx: Tx) => {
      const entry = await tx.pointsLedgerEntry.findUnique({
        where: { userId_actionKey_subjectId: { userId, actionKey, subjectId } },
      });
      if (!entry || entry.status !== 'PENDING') return null;

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: { rewardPointsBalance: { increment: entry.amount } },
      });
      const confirmed = await tx.pointsLedgerEntry.update({
        where: { id: entry.id },
        data: { status: 'CONFIRMED', balanceAfter: updatedUser.rewardPointsBalance },
      });

      const action = await tx.rewardAction.findUnique({ where: { actionKey } });
      if (action?.stampKey) {
        await this.mintStamp(tx, userId, action.stampKey, entry.passportId ?? undefined, entry.propertyId ?? undefined);
      }

      return confirmed;
    });
  }

  private async mintStamp(
    tx: Tx,
    userId: string,
    stampKey: string,
    passportId?: string,
    propertyId?: string,
  ) {
    const stampDef = await tx.stampDefinition.findUnique({ where: { key: stampKey } });
    if (!stampDef || !stampDef.active) return;
    // findFirst + create rather than upsert against the composite unique:
    // passportId is nullable, and Postgres unique indexes treat every NULL
    // as distinct, so an upsert keyed on a null passportId can't reliably
    // find its own prior row. This is the same trade-off documented on
    // UserStamp's @@unique.
    const existing = await tx.userStamp.findFirst({
      where: { userId, stampDefinitionId: stampDef.id, passportId: passportId ?? null },
    });
    if (existing) return;
    await tx.userStamp.create({
      data: { userId, stampDefinitionId: stampDef.id, passportId, propertyId },
    });
  }

  // Awards points for a question the first time it's ever completed.
  // Idempotent two ways: the caller should only invoke this when the
  // question is transitioning INTO 'COMPLETED' (checked in
  // QuestionService), and — the real guarantee, safe even under a
  // race/double-submit — passportQuestionId carries a DB-level unique
  // constraint, so a second insert attempt always fails cleanly rather
  // than double-crediting. Returns null (not thrown) on a no-op, since
  // "already awarded" isn't an error condition for the caller.
  async awardForQuestion(
    userId: string,
    passportQuestionId: string,
    points: number,
    description: string,
    metadata?: AwardMetadata,
  ) {
    if (!points || points <= 0) return null; // several seeded questions are worth 0
    try {
      return await this.prisma.$transaction(async (tx: Tx) => {
        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: { rewardPointsBalance: { increment: points } },
        });
        return tx.pointsLedgerEntry.create({
          data: {
            userId,
            type: 'QUESTION_ANSWERED',
            amount: points,
            balanceAfter: updatedUser.rewardPointsBalance,
            description,
            passportQuestionId,
            metadata: metadata as any,
          },
        });
      });
    } catch (e: any) {
      if (e?.code === PRISMA_UNIQUE_CONSTRAINT_ERROR) return null; // already awarded — no-op
      throw e;
    }
  }

  // Deducts points. Service-layer only for now — deliberately no
  // controller route yet, since nothing can legitimately call this until
  // Marketplace (or something else) actually needs to spend points.
  async redeemPoints(
    userId: string,
    amount: number,
    description: string,
    metadata?: Record<string, unknown>,
  ) {
    if (!amount || amount <= 0) {
      throw new BadRequestException('Redemption amount must be positive');
    }
    return this.prisma.$transaction(async (tx: Tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || user.rewardPointsBalance < amount) {
        throw new BadRequestException('Insufficient points balance');
      }
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: { rewardPointsBalance: { decrement: amount } },
      });
      return tx.pointsLedgerEntry.create({
        data: {
          userId,
          type: 'REDEEMED',
          amount: -amount,
          balanceAfter: updatedUser.rewardPointsBalance,
          description,
          metadata: metadata as any,
        },
      });
    });
  }

  async getBalance(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { rewardPointsBalance: true },
    });
    return { balance: user?.rewardPointsBalance ?? 0 };
  }

  async getStamps(userId: string) {
    return this.prisma.userStamp.findMany({
      where: { userId },
      include: { stampDefinition: true },
      orderBy: { awardedAt: 'desc' },
    });
  }

  async getCatalogue() {
    return this.prisma.rewardCatalogueItem.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getHistory(userId: string, opts: { limit?: number; cursor?: string } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const entries = await this.prisma.pointsLedgerEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
    });
    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;
    return {
      entries: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }
}
