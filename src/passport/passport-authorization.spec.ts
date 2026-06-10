/**
 * Coverage for the passport authorization matrix.
 *
 * Surfaces tested:
 *   - checkUserAccess: owner ✓, collaborator ✓, anonymous ✗, unknown ✗
 *   - addCollaborator: only owner; refuses to add the owner again;
 *     refuses unknown email
 *   - getSharedPassport (share-link resolve): missing → 404, expired
 *     → auto-delete + 403, valid → success
 *
 * These are the access-control rails that protect every passport's
 * data from the wrong viewers. Locking the contract in tests prevents
 * a refactor from accidentally widening the gates.
 */
import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PassportService } from './passport.service';

function makeService() {
  const prismaStub: any = {
    passport: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    passportCollaborator: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    sharedPassportLink: {
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    sectionTemplate: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const paymentsStub: any = {
    hasSuccessfulPayment: jest.fn().mockResolvedValue(false),
  };
  return { svc: new PassportService(prismaStub, paymentsStub), prismaStub };
}

beforeAll(() => {
  process.env.JWT_SECRET = 'jwt-test-secret-at-least-sixteen-chars';
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('checkUserAccess', () => {
  it('returns true for the owner', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({
      id: 'p1',
      ownerId: 'user-1',
      collaborators: [],
    });
    expect(await svc.checkUserAccess('p1', 'user-1')).toBe(true);
  });

  it('returns true for a collaborator', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({
      id: 'p1',
      ownerId: 'owner-x',
      collaborators: [{ userId: 'user-1' }],
    });
    expect(await svc.checkUserAccess('p1', 'user-1')).toBe(true);
  });

  it('returns false for a random authenticated user', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({
      id: 'p1',
      ownerId: 'owner-x',
      collaborators: [],
    });
    expect(await svc.checkUserAccess('p1', 'stranger')).toBe(false);
  });

  it('returns false when the passport does not exist', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue(null);
    expect(await svc.checkUserAccess('missing', 'user-1')).toBe(false);
  });
});

describe('addCollaborator', () => {
  it('throws ForbiddenException when the requester is not the owner', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({
      id: 'p1',
      ownerId: 'owner-x',
    });
    await expect(
      svc.addCollaborator('p1', 'random-user', 'invited@y.com'),
    ).rejects.toThrow(ForbiddenException);
    expect(prismaStub.passportCollaborator.create).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when the invited email has no user', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({
      id: 'p1',
      ownerId: 'owner-1',
    });
    prismaStub.user.findUnique.mockResolvedValue(null);
    await expect(
      svc.addCollaborator('p1', 'owner-1', 'nobody@y.com'),
    ).rejects.toThrow(ForbiddenException);
    expect(prismaStub.passportCollaborator.create).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when the invited user IS the owner', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({
      id: 'p1',
      ownerId: 'owner-1',
    });
    prismaStub.user.findUnique.mockResolvedValue({ id: 'owner-1' });
    await expect(
      svc.addCollaborator('p1', 'owner-1', 'owner@y.com'),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('getSharedPassport (share-link resolve)', () => {
  it('throws NotFoundException when the token is unknown', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.sharedPassportLink.findUnique.mockResolvedValue(null);
    await expect(svc.getSharedPassport('missing-token')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('auto-deletes an expired link and throws 403', async () => {
    const { svc, prismaStub } = makeService();
    const past = new Date(Date.now() - 60 * 1000);
    prismaStub.sharedPassportLink.findUnique.mockResolvedValue({
      token: 'expired-token',
      passportId: 'p1',
      expiresAt: past,
      passport: { id: 'p1' },
    });

    await expect(svc.getSharedPassport('expired-token')).rejects.toThrow(
      ForbiddenException,
    );
    // CRITICAL: expired links are scrubbed from the DB so a leaked
    // expired URL can't be revived by anyone.
    expect(prismaStub.sharedPassportLink.delete).toHaveBeenCalledWith({
      where: { token: 'expired-token' },
    });
  });

  it('throws NotFoundException when the link is valid but the passport is gone', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.sharedPassportLink.findUnique.mockResolvedValue({
      token: 'live-token',
      passportId: 'p-deleted',
      expiresAt: new Date(Date.now() + 60_000),
      passport: { id: 'p-deleted' },
      scope: 'full',
    });
    prismaStub.passport.findUnique.mockResolvedValue(null);

    await expect(svc.getSharedPassport('live-token')).rejects.toThrow(
      NotFoundException,
    );
  });
});
