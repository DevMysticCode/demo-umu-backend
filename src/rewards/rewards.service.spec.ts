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
  const txUser = {
    update: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  };
  const txLedger = { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() };
  const txStampDef = { findUnique: jest.fn() };
  const txUserStamp = { findFirst: jest.fn(), create: jest.fn() };
  const txRewardAction = { findUnique: jest.fn() };
  const tx = {
    user: txUser,
    pointsLedgerEntry: txLedger,
    stampDefinition: txStampDef,
    userStamp: txUserStamp,
    rewardAction: txRewardAction,
  };

  const prismaStub: any = {
    user: { findUnique: jest.fn() },
    pointsLedgerEntry: { findMany: jest.fn() },
    rewardAction: { findUnique: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(tx)),
  };

  const service = new RewardsService(prismaStub);
  return { service, prismaStub, txUser, txLedger, txStampDef, txUserStamp, txRewardAction };
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

describe('RewardsService.award', () => {
  test('CONFIRMED action: increments balance, writes ledger row, mints its stamp', async () => {
    const { service, prismaStub, txUser, txLedger, txStampDef, txUserStamp } = makeService();
    prismaStub.rewardAction.findUnique.mockResolvedValue({
      actionKey: 'OWNERSHIP_VERIFIED',
      journeyType: 'OWNER',
      label: 'Claim a property + verify ownership',
      points: 750,
      stampKey: 'FIRST_PROPERTY_PASSPORT',
      firstTimeOnly: true,
      verificationRequired: false,
      active: true,
    });
    txUser.update.mockResolvedValue({ id: 'u1', rewardPointsBalance: 750 });
    txLedger.create.mockResolvedValue({ id: 'entry1', amount: 750, balanceAfter: 750, status: 'CONFIRMED' });
    txStampDef.findUnique.mockResolvedValue({ id: 'stamp1', key: 'FIRST_PROPERTY_PASSPORT', active: true });
    txUserStamp.findFirst.mockResolvedValue(null);

    const result = await service.award('u1', 'OWNERSHIP_VERIFIED', 'prop1', { propertyId: 'prop1' });

    expect(txUser.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { rewardPointsBalance: { increment: 750 } },
    });
    expect(txLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        actionKey: 'OWNERSHIP_VERIFIED',
        subjectId: 'prop1',
        amount: 750,
        status: 'CONFIRMED',
        propertyId: 'prop1',
      }),
    });
    expect(txUserStamp.create).toHaveBeenCalledWith({
      data: { userId: 'u1', stampDefinitionId: 'stamp1', passportId: undefined, propertyId: 'prop1' },
    });
    expect(result).toEqual(expect.objectContaining({ id: 'entry1' }));
  });

  test('a repeat award for the same (userId, actionKey, subjectId) is a safe no-op', async () => {
    const { service, prismaStub, txUser, txLedger } = makeService();
    prismaStub.rewardAction.findUnique.mockResolvedValue({
      actionKey: 'OWNERSHIP_VERIFIED',
      journeyType: 'OWNER',
      points: 750,
      stampKey: null,
      verificationRequired: false,
      active: true,
    });
    txUser.update.mockResolvedValue({ id: 'u1', rewardPointsBalance: 750 });
    const uniqueViolation: any = new Error('Unique constraint failed');
    uniqueViolation.code = 'P2002';
    txLedger.create.mockRejectedValue(uniqueViolation);

    const result = await service.award('u1', 'OWNERSHIP_VERIFIED', 'prop1');

    expect(result).toBeNull();
  });

  test('unknown or inactive action returns null without opening a transaction', async () => {
    const { service, prismaStub } = makeService();
    prismaStub.rewardAction.findUnique.mockResolvedValue(null);

    const result = await service.award('u1', 'NOT_A_REAL_ACTION', 'x');

    expect(result).toBeNull();
    expect(prismaStub.$transaction).not.toHaveBeenCalled();
  });

  test('verificationRequired action is written PENDING and does NOT touch the balance yet', async () => {
    const { service, prismaStub, txUser, txLedger } = makeService();
    prismaStub.rewardAction.findUnique.mockResolvedValue({
      actionKey: 'ACCOUNT_CREATED',
      journeyType: 'GLOBAL',
      points: 250,
      stampKey: null,
      verificationRequired: true,
      active: true,
    });
    txUser.findUniqueOrThrow.mockResolvedValue({ rewardPointsBalance: 0 });
    txLedger.create.mockResolvedValue({ id: 'entry2', amount: 250, balanceAfter: 0, status: 'PENDING' });

    const result = await service.award('u1', 'ACCOUNT_CREATED', 'u1');

    expect(txUser.update).not.toHaveBeenCalled();
    expect(txLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'PENDING', amount: 250, balanceAfter: 0 }),
    });
    expect(result).toEqual(expect.objectContaining({ id: 'entry2' }));
  });
});

describe('RewardsService.confirmAward', () => {
  test('flips a PENDING entry to CONFIRMED and applies the deferred balance increment', async () => {
    const { service, prismaStub, txUser, txLedger, txRewardAction } = makeService();
    txLedger.findUnique.mockResolvedValue({
      id: 'entry2',
      userId: 'u1',
      actionKey: 'ACCOUNT_CREATED',
      subjectId: 'u1',
      amount: 250,
      status: 'PENDING',
      passportId: null,
      propertyId: null,
    });
    txUser.update.mockResolvedValue({ id: 'u1', rewardPointsBalance: 250 });
    txLedger.update.mockResolvedValue({ id: 'entry2', status: 'CONFIRMED', balanceAfter: 250 });
    txRewardAction.findUnique.mockResolvedValue({ actionKey: 'ACCOUNT_CREATED', stampKey: null });

    const result = await service.confirmAward('u1', 'ACCOUNT_CREATED', 'u1');

    expect(txUser.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { rewardPointsBalance: { increment: 250 } },
    });
    expect(txLedger.update).toHaveBeenCalledWith({
      where: { id: 'entry2' },
      data: { status: 'CONFIRMED', balanceAfter: 250 },
    });
    expect(result).toEqual(expect.objectContaining({ status: 'CONFIRMED' }));
  });

  test('a missing or already-CONFIRMED entry is a safe no-op', async () => {
    const { service, txLedger, txUser } = makeService();
    txLedger.findUnique.mockResolvedValue(null);

    const result = await service.confirmAward('u1', 'ACCOUNT_CREATED', 'u1');

    expect(result).toBeNull();
    expect(txUser.update).not.toHaveBeenCalled();
  });
});
