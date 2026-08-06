/**
 * Coverage for the rewards ledger — the parts that matter for a
 * production-grade points system:
 *   - awarding is atomic (balance increment + ledger row happen together)
 *   - double-award on the same passportQuestionId is a safe no-op, not
 *     a double-credit (the DB unique constraint is the real guarantee;
 *     this test simulates what Postgres does when it's hit)
 *   - zero-point questions are skipped without touching the DB
 *   - redemption rejects an insufficient balance and never goes negative
 */

import { BadRequestException } from '@nestjs/common';
import { RewardsService } from './rewards.service';

function makeService() {
  const txUser = { update: jest.fn() };
  const txLedger = { create: jest.fn() };
  const tx = { user: txUser, pointsLedgerEntry: txLedger };

  const prismaStub: any = {
    user: { findUnique: jest.fn() },
    pointsLedgerEntry: { findMany: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(tx)),
  };

  const service = new RewardsService(prismaStub);
  return { service, prismaStub, txUser, txLedger };
}

describe('RewardsService.awardForQuestion', () => {
  test('increments the balance and writes a ledger row atomically', async () => {
    const { service, txUser, txLedger } = makeService();
    txUser.update.mockResolvedValue({ id: 'u1', rewardPointsBalance: 150 });
    txLedger.create.mockResolvedValue({
      id: 'entry1',
      amount: 50,
      balanceAfter: 150,
    });

    const result = await service.awardForQuestion(
      'u1',
      'pq1',
      50,
      'Answered: "Council tax band"',
      { passportId: 'p1', sectionKey: 'boundaries' },
    );

    expect(txUser.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { rewardPointsBalance: { increment: 50 } },
    });
    expect(txLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        type: 'QUESTION_ANSWERED',
        amount: 50,
        balanceAfter: 150, // read from the update result, not recomputed
        passportQuestionId: 'pq1',
      }),
    });
    expect(result).toEqual({ id: 'entry1', amount: 50, balanceAfter: 150 });
  });

  test('a second award for the same passportQuestionId is a safe no-op, not a double-credit', async () => {
    const { service, txUser, txLedger } = makeService();
    txUser.update.mockResolvedValue({ id: 'u1', rewardPointsBalance: 200 });
    // Simulates Postgres rejecting the unique constraint on passportQuestionId.
    const uniqueViolation: any = new Error('Unique constraint failed');
    uniqueViolation.code = 'P2002';
    txLedger.create.mockRejectedValue(uniqueViolation);

    const result = await service.awardForQuestion('u1', 'pq1', 50, 'Answered again');

    expect(result).toBeNull();
  });

  test('a non-idempotency error still propagates (not silently swallowed)', async () => {
    const { service, txUser, txLedger } = makeService();
    txUser.update.mockResolvedValue({ id: 'u1', rewardPointsBalance: 50 });
    txLedger.create.mockRejectedValue(new Error('connection reset'));

    await expect(
      service.awardForQuestion('u1', 'pq1', 50, 'Answered'),
    ).rejects.toThrow('connection reset');
  });

  test('a zero-point question is skipped without touching the DB', async () => {
    const { service, prismaStub } = makeService();

    const result = await service.awardForQuestion('u1', 'pq1', 0, 'Answered');

    expect(result).toBeNull();
    expect(prismaStub.$transaction).not.toHaveBeenCalled();
  });
});

describe('RewardsService.redeemPoints', () => {
  test('rejects a redemption larger than the current balance', async () => {
    const { service, prismaStub } = makeService();
    prismaStub.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        user: {
          findUnique: jest.fn().mockResolvedValue({ id: 'u1', rewardPointsBalance: 30 }),
          update: jest.fn(),
        },
        pointsLedgerEntry: { create: jest.fn() },
      };
      return cb(tx);
    });

    await expect(
      service.redeemPoints('u1', 50, 'Redeemed for something'),
    ).rejects.toThrow(BadRequestException);
  });

  test('decrements the balance and writes a negative-amount ledger row when sufficient', async () => {
    const { service, prismaStub } = makeService();
    const txUser = {
      findUnique: jest.fn().mockResolvedValue({ id: 'u1', rewardPointsBalance: 100 }),
      update: jest.fn().mockResolvedValue({ id: 'u1', rewardPointsBalance: 60 }),
    };
    const txLedger = { create: jest.fn().mockResolvedValue({ amount: -40, balanceAfter: 60 }) };
    prismaStub.$transaction.mockImplementation((cb: any) =>
      cb({ user: txUser, pointsLedgerEntry: txLedger }),
    );

    const result = await service.redeemPoints('u1', 40, 'Redeemed');

    expect(txUser.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { rewardPointsBalance: { decrement: 40 } },
    });
    expect(txLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'REDEEMED', amount: -40, balanceAfter: 60 }),
    });
    expect(result).toEqual({ amount: -40, balanceAfter: 60 });
  });

  test('rejects a non-positive redemption amount before touching the DB', async () => {
    const { service, prismaStub } = makeService();

    await expect(service.redeemPoints('u1', 0, 'Nothing')).rejects.toThrow(BadRequestException);
    expect(prismaStub.$transaction).not.toHaveBeenCalled();
  });
});
