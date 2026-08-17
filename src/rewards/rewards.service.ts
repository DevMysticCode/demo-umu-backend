import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma, JourneyType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getLevelProgress } from './levels';
import { STAMP_CATALOGUE } from './stamp-catalogue';

const STREAK_MILESTONES = [
  { days: 3, actionKey: 'STREAK_3_DAY' },
  { days: 7, actionKey: 'STREAK_7_DAY' },
  { days: 14, actionKey: 'STREAK_14_DAY' },
  { days: 30, actionKey: 'STREAK_30_DAY' },
] as const;

function utcMidnight(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

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
  // UMU Stamp Reward System V1 (stamp-evaluator.ts) — what satisfied the
  // stamp and which QuestionAnswer ids supplied the evidence, if this
  // award mints one. Ignored when the action has no stampKey.
  stampTriggerEvent?: string;
  stampSupportingDocumentIds?: string[];
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
          await this.mintStamp(
            tx,
            userId,
            action.stampKey,
            action.points,
            opts.passportId,
            opts.propertyId,
            opts.stampTriggerEvent,
            opts.stampSupportingDocumentIds,
          );
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
        await this.mintStamp(tx, userId, action.stampKey, action.points, entry.passportId ?? undefined, entry.propertyId ?? undefined);
      }

      return confirmed;
    });
  }

  private async mintStamp(
    tx: Tx,
    userId: string,
    stampKey: string,
    points: number,
    passportId?: string,
    propertyId?: string,
    triggerEvent?: string,
    supportingDocumentIds?: string[],
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
      data: {
        userId,
        stampDefinitionId: stampDef.id,
        passportId,
        propertyId,
        // Snapshot at mint time so the PassportAchievement celebration
        // payload (GET /rewards/stamps/uncelebrated) needs no extra join
        // back to PointsLedgerEntry to know how many points to display.
        pointsAwarded: points,
        triggerEvent,
        supportingDocumentIds: supportingDocumentIds as any,
        // No manual review workflow exists yet — a user's own uploaded
        // documents/answers are treated as legitimate as soon as they
        // satisfy a stamp's requirements, so every stamp mints straight
        // to VERIFIED rather than sitting in EARNED indefinitely. Revisit
        // once a real verification workflow exists (see StampDefinition
        // schema comment).
        verificationStatus: 'VERIFIED',
      },
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

  // Combined balance + level + streak, for the section-screen summary
  // card. Kept separate from getBalance() (used in several other places
  // expecting just `{ balance }`) rather than widening that response.
  async getProgress(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { rewardPointsBalance: true, currentStreak: true, longestStreak: true },
    });
    const balance = user?.rewardPointsBalance ?? 0;
    return {
      balance,
      level: getLevelProgress(balance),
      streak: {
        current: user?.currentStreak ?? 0,
        longest: user?.longestStreak ?? 0,
      },
    };
  }

  // Advances the daily-activity streak — call on any real question
  // interaction (see QuestionService.answerQuestion). Idempotent per UTC
  // calendar day: a second call the same day is a no-op. Never throws —
  // callers fire this without letting it affect the response they're
  // already sending back.
  async recordDailyActivity(userId: string) {
    const today = utcMidnight(new Date());
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { lastActiveDate: true, currentStreak: true, longestStreak: true },
    });
    if (!user) return;

    const last = user.lastActiveDate ? utcMidnight(user.lastActiveDate) : null;
    if (last && last.getTime() === today.getTime()) return; // already counted today

    const oneDayMs = 24 * 60 * 60 * 1000;
    const isConsecutive = !!last && today.getTime() - last.getTime() === oneDayMs;
    const newStreak = isConsecutive ? user.currentStreak + 1 : 1;
    const newLongest = Math.max(user.longestStreak, newStreak);

    await this.prisma.user.update({
      where: { id: userId },
      data: { currentStreak: newStreak, longestStreak: newLongest, lastActiveDate: today },
    });

    // One-time bonus per distinct streak run reaching a milestone length —
    // subjectId is the date the milestone was hit, so a later streak that
    // breaks and rebuilds back up to (say) 3 days can earn it again.
    const hit = STREAK_MILESTONES.find((m) => m.days === newStreak);
    if (hit) {
      const subjectId = today.toISOString().slice(0, 10);
      await this.award(userId, hit.actionKey, subjectId).catch(() => {});
    }
  }

  async getStamps(userId: string) {
    return this.prisma.userStamp.findMany({
      where: { userId },
      include: { stampDefinition: true },
      orderBy: { awardedAt: 'desc' },
    });
  }

  // Stamps minted but not yet shown via the PassportAchievement celebration.
  // Every award() call site is fire-and-forget from its HTTP response's
  // perspective (see award()'s callers), so the frontend can't learn about
  // a new stamp from a response body — it has to ask. Ascending order so
  // if several queued up (offline, background KYC approval, ...), the
  // oldest achievement celebrates first.
  async getUncelebratedStamps(userId: string) {
    return this.prisma.userStamp.findMany({
      where: { userId, celebratedAt: null },
      include: { stampDefinition: true },
      orderBy: { awardedAt: 'asc' },
    });
  }

  // Idempotent ack — scoped by userId (ownership) and celebratedAt: null
  // (a second call for the same stamp is a no-op, not an error).
  async markStampCelebrated(userId: string, userStampId: string) {
    const result = await this.prisma.userStamp.updateMany({
      where: { id: userStampId, userId, celebratedAt: null },
      data: { celebratedAt: new Date() },
    });
    return { acknowledged: result.count > 0 };
  }

  // Full active stamp set (earned + locked), for the Passport Stamps
  // collection view — diffed against getStamps() client-side. When
  // passportId is given, each stamp is annotated with `applicable` so the
  // UI can hide ones that don't apply to this property (the client spec's
  // "never show a stamp that doesn't apply" rule) — V1 only has one real
  // applicability signal (does this passport have a leasehold section),
  // see the comment on `requiresLeasehold` in stamp-catalogue.ts for why
  // the other conditional stamps aren't gated yet.
  async getStampsCatalogue(passportId?: string) {
    const stamps = await this.prisma.stampDefinition.findMany({
      where: { active: true },
      orderBy: { tier: 'asc' },
    });

    if (!passportId) return stamps.map((s) => ({ ...s, applicable: true }));

    const leaseholdSection = await this.prisma.passportSection.findFirst({
      where: { passportId, key: 'leasehold' },
      select: { id: true },
    });
    const leaseholdGatedKeys = new Set(
      STAMP_CATALOGUE.filter((s) => s.requiresLeasehold).map((s) => s.key),
    );

    // notApplicableIf gates (Solar, Private Drainage) — one batched query
    // for every (sectionKey, taskKey, order) any catalogue entry gates on,
    // rather than one query per stamp.
    const gatedEntries = STAMP_CATALOGUE.filter((s) => s.notApplicableIf?.length);
    const gateSectionKeys = [
      ...new Set(gatedEntries.flatMap((s) => s.notApplicableIf!.map((g) => g.sectionKey))),
    ];
    const answerLookup = new Map<string, string | null>();
    if (gateSectionKeys.length) {
      const rows = await this.prisma.passportQuestion.findMany({
        where: {
          passportSectionTask: {
            passportSection: { passportId, key: { in: gateSectionKeys } },
          },
        },
        select: {
          questionTemplate: { select: { sectionKey: true, taskKey: true, order: true } },
          answer: { select: { answerText: true } },
        },
      });
      for (const row of rows) {
        const key = `${row.questionTemplate.sectionKey}::${row.questionTemplate.taskKey}::${row.questionTemplate.order}`;
        answerLookup.set(key, row.answer?.answerText ?? null);
      }
    }

    function isGatedNotApplicable(entry: (typeof STAMP_CATALOGUE)[number]): boolean {
      const gates = entry.notApplicableIf;
      if (!gates?.length) return false;
      return gates.every((g) => {
        const value = answerLookup.get(`${g.sectionKey}::${g.taskKey}::${g.order}`);
        return value != null && g.valuesIn.includes(value);
      });
    }

    const gatedByKey = new Map(gatedEntries.map((s) => [s.key, s]));

    return stamps.map((s) => {
      if (leaseholdGatedKeys.has(s.key) && !leaseholdSection) {
        return { ...s, applicable: false };
      }
      const gatedEntry = gatedByKey.get(s.key);
      if (gatedEntry && isGatedNotApplicable(gatedEntry)) {
        return { ...s, applicable: false };
      }
      return { ...s, applicable: true };
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
