/**
 * KYC gate on the claim-passport path.
 *
 * Claiming a property creates a verified-owner relationship: HMLR
 * lookups, TA6 generation, and buyer-side trust signals all assume
 * the owner is who they say they are. The gate fires AFTER the
 * existing phone-number precondition + the "you already own one of
 * these on this property" fast-pass, so legitimate finish-signup
 * paths don't get an unexpected 403.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PassportService } from './passport.service';

function makeService(opts?: { user?: any }) {
  const prismaStub: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue(
        opts?.user ?? { id: 'user-1', phone: '07000000', kycStatus: 'approved' },
      ),
    },
    passport: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'p-new' }),
    },
    property: { findUnique: jest.fn().mockResolvedValue(null) },
    sectionTemplate: { findMany: jest.fn().mockResolvedValue([]) },
    passportSection: { create: jest.fn() },
    questionTemplate: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { svc: new PassportService(prismaStub, {} as any), prismaStub };
}

beforeAll(() => {
  process.env.JWT_SECRET = 'jwt-test-secret-at-least-sixteen-chars';
});

describe('createPassport — KYC gate', () => {
  it('REJECTS a user with kycStatus pending (regression guard)', async () => {
    const { svc, prismaStub } = makeService({
      user: { id: 'user-1', phone: '07000000', kycStatus: 'pending' },
    });

    await expect(
      svc.createPassport('user-1', '1 Test St', 'AB1 2CD', undefined, { type: 'SELLER' }),
    ).rejects.toThrow(ForbiddenException);

    // Passport must not have been created when KYC is missing.
    expect(prismaStub.passport.create).not.toHaveBeenCalled();
  });

  it('REJECTS a user with no kycStatus at all', async () => {
    const { svc, prismaStub } = makeService({
      user: { id: 'user-1', phone: '07000000', kycStatus: null },
    });

    await expect(
      svc.createPassport('user-1', '1 Test St', 'AB1 2CD'),
    ).rejects.toThrow(ForbiddenException);
    expect(prismaStub.passport.create).not.toHaveBeenCalled();
  });

  it.each([['declined'], ['failed'], ['needs_review']])(
    'rejects kycStatus = %j',
    async (status) => {
      const { svc, prismaStub } = makeService({
        user: { id: 'user-1', phone: '07000000', kycStatus: status },
      });
      await expect(
        svc.createPassport('user-1', '1 Test St', 'AB1 2CD'),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaStub.passport.create).not.toHaveBeenCalled();
    },
  );

  it('phone-number precondition fires BEFORE KYC (existing behaviour preserved)', async () => {
    const { svc } = makeService({
      user: { id: 'user-1', phone: null, kycStatus: 'approved' },
    });

    // The phone error should win even though KYC is OK — order matters
    // for the existing UX (the phone form is what users see first).
    await expect(
      svc.createPassport('user-1', '1 Test St', 'AB1 2CD'),
    ).rejects.toThrow(BadRequestException);
  });

  it('returning the user\'s OWN existing passport BYPASSES KYC', async () => {
    // The user previously cleared KYC when they first claimed; that
    // status may have lapsed (e.g. status reset for re-verification),
    // but we shouldn't block them from seeing their own existing
    // passport. The fast-pass returns before KYC is checked.
    const { svc, prismaStub } = makeService({
      user: { id: 'user-1', phone: '07000000', kycStatus: 'pending' },
    });
    prismaStub.passport.findFirst.mockResolvedValue({
      id: 'p-existing',
      ownerId: 'user-1',
    });

    const res = await svc.createPassport(
      'user-1',
      '1 Test St',
      'AB1 2CD',
      'prop-1',
      { type: 'SELLER' },
    );

    expect(res).toEqual({ passportId: 'p-existing' });
    // No new passport created — fast-pass return path.
    expect(prismaStub.passport.create).not.toHaveBeenCalled();
  });
});
