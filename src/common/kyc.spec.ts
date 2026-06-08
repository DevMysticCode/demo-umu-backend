import { ForbiddenException } from '@nestjs/common';
import { assertKycVerified, isKycVerified } from './kyc';

describe('isKycVerified', () => {
  it('returns true ONLY for kycStatus === "approved"', () => {
    expect(isKycVerified({ kycStatus: 'approved' })).toBe(true);
  });

  it.each([
    ['pending'],
    ['declined'],
    ['needs_review'],
    ['failed'],
    [null],
    [undefined],
  ])('returns false for kycStatus = %j', (status) => {
    expect(isKycVerified({ kycStatus: status as any })).toBe(false);
  });

  it('returns false for null / undefined subject', () => {
    expect(isKycVerified(null)).toBe(false);
    expect(isKycVerified(undefined)).toBe(false);
  });

  // The audit's exact concern: `isVerified` (which can be true on OTP
  // signup) must NOT make isKycVerified true. Protect against future
  // regressions where someone "fixes" the helper by also reading it.
  it('ignores isVerified (the overloaded signup flag)', () => {
    const user = { kycStatus: null, isVerified: true } as any;
    expect(isKycVerified(user)).toBe(false);
  });
});

describe('assertKycVerified', () => {
  it('is a no-op for approved users', () => {
    expect(() => assertKycVerified({ kycStatus: 'approved' })).not.toThrow();
  });

  it('throws ForbiddenException for unverified users', () => {
    expect(() => assertKycVerified({ kycStatus: 'pending' })).toThrow(
      ForbiddenException,
    );
    expect(() => assertKycVerified(null)).toThrow(ForbiddenException);
  });
});
