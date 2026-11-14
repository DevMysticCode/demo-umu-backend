/**
 * Coverage for PassportService.createShareLink.
 *
 * Security/launch review finding #16 (2026-11-14): a collaborator or
 * an unlocked buyer could previously mint a share link for a passport
 * they don't own, and the link's lifetime was hardcoded at 3 hours
 * with no validation. These tests lock in the fix:
 *   - owner-only (regression guard)
 *   - tenant scope rejected on a non-landlord passport
 *   - duration must come from the fixed menu; anything else (or
 *     nothing) falls back to 3 hours rather than an attacker-supplied
 *     arbitrary number
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PassportService } from './passport.service';

function makeService() {
  const prismaStub: any = {
    passport: { findUnique: jest.fn() },
    sharedPassportLink: {
      create: jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'link-1', ...data }),
      ),
    },
    questionAnswer: { findMany: jest.fn().mockResolvedValue([]) },
    userDocument: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const paymentsStub: any = { hasSuccessfulPayment: jest.fn().mockResolvedValue(false) };
  const pushStub: any = { send: jest.fn().mockResolvedValue(undefined) };
  const conversationsStub: any = {
    findOrCreate: jest.fn().mockResolvedValue({ id: 'conv-1' }),
    sendMessage: jest.fn().mockResolvedValue(undefined),
  };
  const notificationsStub: any = { sendNotification: jest.fn().mockResolvedValue(undefined) };
  const filesStub: any = { buildSignedUrl: jest.fn().mockReturnValue('/files/mock') };
  const eventsStub: any = { logEvent: jest.fn().mockResolvedValue(undefined) };
  const svc = new PassportService(
    prismaStub,
    paymentsStub,
    pushStub,
    conversationsStub,
    notificationsStub,
    filesStub,
    eventsStub,
  );
  return { svc, prismaStub };
}

beforeAll(() => {
  process.env.JWT_SECRET = 'jwt-test-secret-at-least-sixteen-chars';
});

describe('createShareLink - ownership', () => {
  it('throws NotFoundException when the passport does not exist', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue(null);

    await expect(svc.createShareLink('p-missing', 'user-1')).rejects.toThrow(NotFoundException);
    expect(prismaStub.sharedPassportLink.create).not.toHaveBeenCalled();
  });

  it('REJECTS a collaborator - regression guard for finding #16', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({
      id: 'p-1',
      ownerId: 'owner-1',
      type: 'SELLER',
    });

    // A collaborator has access to the passport generally, but is not
    // its owner - share-link creation must still refuse them.
    await expect(svc.createShareLink('p-1', 'collaborator-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prismaStub.sharedPassportLink.create).not.toHaveBeenCalled();
  });

  it('REJECTS an unlocked buyer - regression guard for finding #16', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({
      id: 'p-1',
      ownerId: 'owner-1',
      type: 'SELLER',
    });

    await expect(svc.createShareLink('p-1', 'buyer-1')).rejects.toThrow(ForbiddenException);
    expect(prismaStub.sharedPassportLink.create).not.toHaveBeenCalled();
  });

  it('allows the owner through', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({
      id: 'p-1',
      ownerId: 'owner-1',
      type: 'SELLER',
    });

    const res = await svc.createShareLink('p-1', 'owner-1');
    expect(prismaStub.sharedPassportLink.create).toHaveBeenCalled();
    expect(res.token).toEqual(expect.any(String));
    expect(res.url).toContain(res.token);
  });
});

describe('createShareLink - tenant scope', () => {
  it('REJECTS tenant scope on a non-landlord passport', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({
      id: 'p-1',
      ownerId: 'owner-1',
      type: 'SELLER',
    });

    await expect(svc.createShareLink('p-1', 'owner-1', 'tenant')).rejects.toThrow(
      BadRequestException,
    );
    expect(prismaStub.sharedPassportLink.create).not.toHaveBeenCalled();
  });

  it('allows tenant scope on a landlord passport', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({
      id: 'p-1',
      ownerId: 'owner-1',
      type: 'LANDLORD',
    });

    const res = await svc.createShareLink('p-1', 'owner-1', 'tenant');
    expect(res.scope).toBe('tenant');
    expect(res.url).toContain('/shared-tenant/');
  });
});

describe('createShareLink - duration', () => {
  function expiresInHours(expiresAt: Date, hours: number) {
    const diffMs = expiresAt.getTime() - Date.now();
    // Allow a little slack for test execution time.
    return Math.abs(diffMs - hours * 60 * 60 * 1000) < 5000;
  }

  it('defaults to 3 hours when no duration is given', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({
      id: 'p-1',
      ownerId: 'owner-1',
      type: 'SELLER',
    });

    const res = await svc.createShareLink('p-1', 'owner-1');
    expect(expiresInHours(res.expiresAt, 3)).toBe(true);
  });

  it('honours a valid duration from the fixed menu (72h)', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({
      id: 'p-1',
      ownerId: 'owner-1',
      type: 'SELLER',
    });

    const res = await svc.createShareLink('p-1', 'owner-1', 'buyer', undefined, null, 72);
    expect(expiresInHours(res.expiresAt, 72)).toBe(true);
  });

  it('falls back to 3 hours for a duration outside the fixed menu (defence in depth for non-HTTP callers)', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({
      id: 'p-1',
      ownerId: 'owner-1',
      type: 'SELLER',
    });

    // The DTO's @IsIn already rejects this at the HTTP boundary - this
    // covers the service-level fallback for any other caller.
    const res = await svc.createShareLink('p-1', 'owner-1', 'buyer', undefined, null, 999 as any);
    expect(expiresInHours(res.expiresAt, 3)).toBe(true);
  });
});
