import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

const PRISMA_UNIQUE_CONSTRAINT_ERROR = 'P2002';

export interface AwardMetadata {
  passportId?: string;
  sectionKey?: string;
  questionTemplateId?: string;
  [key: string]: unknown;
}

@Injectable()
export class RewardsService {
  constructor(private prisma: PrismaService) {}

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
