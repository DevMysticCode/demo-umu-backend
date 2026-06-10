/**
 * Coverage for PassportService.createBuyerAccess — the paywall gate.
 *
 * Until DF4 Finding #1 was closed (commit 33ecd81), this method
 * unconditionally upserted access rows. The current implementation
 * MUST verify a successful payment before granting access. These
 * tests lock that contract in place.
 *
 * PassportService is constructed by hand here with a stubbed
 * PrismaService and PaymentService — full DI bootstrap isn't needed
 * for this surface. Other PassportService methods are out of scope
 * (the constructor also wires up Groq which is irrelevant here).
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PassportService } from './passport.service';

function makeService(opts?: { paid?: boolean }) {
  const prismaStub: any = {
    passport: { findUnique: jest.fn() },
    buyerPassportAccess: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };
  const paymentsStub: any = {
    hasSuccessfulPayment: jest.fn().mockResolvedValue(opts?.paid ?? false),
  };
  // The constructor reads GROQ_API_KEY but the SDK is lazy — instantiating
  // it doesn't make any HTTP call, so test bootstrap stays clean.
  const svc = new PassportService(prismaStub, paymentsStub);
  return { svc, prismaStub, paymentsStub };
}

beforeAll(() => {
  process.env.JWT_SECRET = 'jwt-test-secret-at-least-sixteen-chars';
});

describe('createBuyerAccess — paywall gate', () => {
  it('throws NotFoundException when the passport does not exist', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue(null);
    await expect(svc.createBuyerAccess('p-missing', 'user-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('owner gets pass-through without a payment check', async () => {
    const { svc, prismaStub, paymentsStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({
      id: 'p1',
      ownerId: 'user-1',
    });
    const res = await svc.createBuyerAccess('p1', 'user-1');
    expect(res).toEqual({ passportId: 'p1' });
    expect(paymentsStub.hasSuccessfulPayment).not.toHaveBeenCalled();
    expect(prismaStub.buyerPassportAccess.create).not.toHaveBeenCalled();
  });

  it('users with existing access pass through idempotently', async () => {
    const { svc, prismaStub, paymentsStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({
      id: 'p1',
      ownerId: 'owner-x',
    });
    prismaStub.buyerPassportAccess.findUnique.mockResolvedValue({
      passportId: 'p1',
      userId: 'user-1',
    });
    const res = await svc.createBuyerAccess('p1', 'user-1');
    expect(res).toEqual({ passportId: 'p1' });
    expect(paymentsStub.hasSuccessfulPayment).not.toHaveBeenCalled();
    // No new row — would be a Prisma constraint violation otherwise.
    expect(prismaStub.buyerPassportAccess.create).not.toHaveBeenCalled();
  });

  it('REJECTS unpaid users with 403 — DF4 Finding #1 regression guard', async () => {
    const { svc, prismaStub, paymentsStub } = makeService({ paid: false });
    prismaStub.passport.findUnique.mockResolvedValue({
      id: 'p1',
      ownerId: 'owner-x',
    });
    prismaStub.buyerPassportAccess.findUnique.mockResolvedValue(null);

    await expect(svc.createBuyerAccess('p1', 'user-1')).rejects.toThrow(
      ForbiddenException,
    );

    // CRITICAL: no access row written when payment is missing. If this
    // assertion ever fails, the paywall is bypassable again.
    expect(prismaStub.buyerPassportAccess.create).not.toHaveBeenCalled();
    expect(paymentsStub.hasSuccessfulPayment).toHaveBeenCalledWith('user-1', 'p1');
  });

  it('paid users get access granted', async () => {
    const { svc, prismaStub, paymentsStub } = makeService({ paid: true });
    prismaStub.passport.findUnique.mockResolvedValue({
      id: 'p1',
      ownerId: 'owner-x',
    });
    prismaStub.buyerPassportAccess.findUnique.mockResolvedValue(null);
    prismaStub.buyerPassportAccess.create.mockResolvedValue({});

    const res = await svc.createBuyerAccess('p1', 'user-1');

    expect(res).toEqual({ passportId: 'p1' });
    expect(paymentsStub.hasSuccessfulPayment).toHaveBeenCalledWith('user-1', 'p1');
    expect(prismaStub.buyerPassportAccess.create).toHaveBeenCalledWith({
      data: { passportId: 'p1', userId: 'user-1' },
    });
  });
});
