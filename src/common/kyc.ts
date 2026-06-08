/**
 * KYC verification helpers.
 *
 * Use these instead of reading `user.isVerified` (or `user.kycStatus`)
 * directly anywhere you mean "this user has passed Persona KYC". The
 * audit finding is real: `isVerified` is overloaded (signup OR KYC),
 * so any consumer that reads it expecting "passed KYC" will silently
 * trust an OTP-only user. This module is the one place that owns the
 * rule — any new gating code should call `isKycVerified` from here.
 */

export interface KycSubject {
  kycStatus?: string | null;
}

/**
 * True if and only if the user has completed Persona KYC and the
 * result was "approved". Returns false for pending, declined,
 * needs_review, failed, or unset. Never trust `isVerified` for this.
 */
export function isKycVerified(user: KycSubject | null | undefined): boolean {
  return user?.kycStatus === 'approved';
}

/**
 * Throw a 403 unless the user has passed KYC. Pair with JwtAuthGuard
 * on the route, then call this at the top of the service method:
 *
 *   assertKycVerified(user);
 *
 * (Don't depend on isVerified — see comment on isKycVerified.)
 */
export function assertKycVerified(user: KycSubject | null | undefined): void {
  if (!isKycVerified(user)) {
    // Lazy import to avoid pulling @nestjs/common into pure helpers if
    // unused. Throwing the real HttpException here lets callers swallow
    // it normally and the global filter formats the response.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ForbiddenException } = require('@nestjs/common');
    throw new ForbiddenException(
      'Identity verification (KYC) is required for this action.',
    );
  }
}
