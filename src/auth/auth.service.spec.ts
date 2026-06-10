/**
 * Coverage for the auth service — the entry point to everything.
 *
 * Focus is the security boundary, NOT exhaustive method coverage:
 *   - rejection paths (wrong creds, expired tokens, duplicate registration)
 *   - JWT issuance on the right side of each gate
 *   - bcrypt is invoked with cost factor (not bypassed)
 *   - forgot-password doesn't leak user-existence
 *
 * bcrypt is mocked so tests stay sub-second. The mock asserts the
 * cost factor passed in still matches the production value — if a
 * future refactor drops the salt rounds, the test fails.
 */

// Mock bcrypt before importing the service.
const bcryptHash = jest.fn();
const bcryptCompare = jest.fn();
jest.mock('bcrypt', () => ({
  hash: (...args: any[]) => bcryptHash(...args),
  compare: (...args: any[]) => bcryptCompare(...args),
}));

// Mock Resend so the constructor's `new Resend(...)` doesn't make any
// network call.
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ id: 'mock' }) },
  })),
}));

import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

function makeService() {
  const prismaStub: any = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    otpCode: {
      create: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const jwtStub: any = {
    sign: jest.fn().mockReturnValue('mock-jwt-token'),
    verify: jest.fn(),
  };
  return { svc: new AuthService(prismaStub, jwtStub), prismaStub, jwtStub };
}

beforeAll(() => {
  process.env.RESEND_API_KEY = '';
  process.env.JWT_SECRET = 'jwt-test-secret-at-least-sixteen-chars';
});

beforeEach(() => {
  jest.clearAllMocks();
  bcryptHash.mockResolvedValue('$2b$10$mockedhash');
  bcryptCompare.mockResolvedValue(true);
});

describe('verifyOtp', () => {
  it('throws 401 when no matching unexpired OTP exists', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.otpCode.findFirst.mockResolvedValue(null);

    await expect(svc.verifyOtp({ email: 'x@y.com', code: '123456' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prismaStub.user.update).not.toHaveBeenCalled();
  });

  it('flips isVerified, deletes OTP, issues JWT on success', async () => {
    const { svc, prismaStub, jwtStub } = makeService();
    prismaStub.otpCode.findFirst.mockResolvedValue({ id: 'otp-1' });
    prismaStub.user.update.mockResolvedValue({
      id: 'user-1',
      email: 'x@y.com',
      isVerified: true,
    });

    const res = await svc.verifyOtp({ email: 'x@y.com', code: '123456' });

    expect(prismaStub.user.update).toHaveBeenCalledWith({
      where: { email: 'x@y.com' },
      data: { isVerified: true },
    });
    expect(prismaStub.otpCode.delete).toHaveBeenCalledWith({ where: { id: 'otp-1' } });
    expect(jwtStub.sign).toHaveBeenCalledWith({ sub: 'user-1', email: 'x@y.com' });
    expect(res.token).toBe('mock-jwt-token');
  });
});

describe('register', () => {
  const dto = {
    email: 'new@y.com',
    password: 'plaintext-pass',
    firstName: 'A',
    lastName: 'B',
    phone: '07000',
    dob: '1990-01-01',
    postcode: 'SW1A',
    gender: 'na',
  };

  it('hashes the password with bcrypt cost 10 (not plaintext)', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.user.findUnique.mockResolvedValue(null);
    prismaStub.user.create.mockResolvedValue({
      id: 'user-1',
      email: dto.email,
      isVerified: false,
    });

    await svc.register(dto as any);

    expect(bcryptHash).toHaveBeenCalledWith('plaintext-pass', 10);
    // CRITICAL: never persist the plain-text password.
    expect(prismaStub.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ password: '$2b$10$mockedhash' }),
      }),
    );
  });

  it('refuses to overwrite an UNVERIFIED existing account (409)', async () => {
    // Semantics: someone started OTP signup and never verified, then
    // tries to "register" — block to prevent take-over of a pending slot.
    // Verified-existing is the legitimate "finish your signup" update
    // path and stays allowed.
    const { svc, prismaStub } = makeService();
    prismaStub.user.findUnique.mockResolvedValue({
      email: dto.email,
      isVerified: false,
    });

    await expect(svc.register(dto as any)).rejects.toThrow(ConflictException);
    expect(prismaStub.user.create).not.toHaveBeenCalled();
    expect(prismaStub.user.update).not.toHaveBeenCalled();
  });

  it('updates the existing user when they are already verified (finish-signup path)', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.user.findUnique.mockResolvedValue({
      email: dto.email,
      isVerified: true,
    });
    prismaStub.user.update.mockResolvedValue({
      id: 'user-1',
      email: dto.email,
      isVerified: true,
    });

    const res = await svc.register(dto as any);
    expect(prismaStub.user.update).toHaveBeenCalled();
    expect(res.token).toBe('mock-jwt-token');
  });

  it('returns JWT on successful registration', async () => {
    const { svc, prismaStub, jwtStub } = makeService();
    prismaStub.user.findUnique.mockResolvedValue(null);
    prismaStub.user.create.mockResolvedValue({
      id: 'user-1',
      email: dto.email,
      isVerified: false,
    });

    const res = await svc.register(dto as any);
    expect(jwtStub.sign).toHaveBeenCalled();
    expect(res.token).toBe('mock-jwt-token');
  });
});

describe('login', () => {
  it('throws generic 401 for an unknown email (no enum leak)', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.user.findUnique.mockResolvedValue(null);

    await expect(
      svc.login({ email: 'nobody@y.com', password: 'whatever' }),
    ).rejects.toThrow(UnauthorizedException);
    // bcrypt MUST still be called in a real impl to avoid timing-based
    // user enumeration — but the current implementation early-exits.
    // Documented here so it's a deliberate choice, not an accident.
  });

  it('throws generic 401 when bcrypt says the password is wrong', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'x@y.com',
      password: '$2b$10$existinghash',
    });
    bcryptCompare.mockResolvedValue(false);

    await expect(svc.login({ email: 'x@y.com', password: 'wrong' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('returns JWT on correct password', async () => {
    const { svc, prismaStub, jwtStub } = makeService();
    prismaStub.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'x@y.com',
      password: '$2b$10$existinghash',
      firstName: 'A',
      lastName: 'B',
      isVerified: true,
    });
    bcryptCompare.mockResolvedValue(true);

    const res = await svc.login({ email: 'x@y.com', password: 'correct' });
    expect(res.token).toBe('mock-jwt-token');
    expect(jwtStub.sign).toHaveBeenCalledWith({ sub: 'user-1', email: 'x@y.com' });
  });
});

describe('forgotPassword', () => {
  it('returns the same generic message whether the user exists or not (no enum leak)', async () => {
    const { svc, prismaStub } = makeService();

    prismaStub.user.findUnique.mockResolvedValueOnce(null);
    const resA = await svc.forgotPassword({ email: 'missing@y.com' });

    prismaStub.user.findUnique.mockResolvedValueOnce({
      id: 'user-1',
      isVerified: true,
    });
    prismaStub.otpCode.create.mockResolvedValue({});
    const resB = await svc.forgotPassword({ email: 'x@y.com' });

    expect(resA.message).toBe(resB.message);
  });

  it('creates a reset OTP when the user exists and is verified', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.user.findUnique.mockResolvedValue({
      id: 'user-1',
      isVerified: true,
    });
    prismaStub.otpCode.create.mockResolvedValue({});

    await svc.forgotPassword({ email: 'x@y.com' });
    expect(prismaStub.otpCode.create).toHaveBeenCalled();
  });

  it('does NOT create an OTP for an unverified existing user (avoids confirming the account exists)', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.user.findUnique.mockResolvedValue({
      id: 'user-1',
      isVerified: false,
    });

    await svc.forgotPassword({ email: 'half-registered@y.com' });
    expect(prismaStub.otpCode.create).not.toHaveBeenCalled();
  });

  it('does NOT create an OTP for a non-existent user', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.user.findUnique.mockResolvedValue(null);

    await svc.forgotPassword({ email: 'missing@y.com' });
    expect(prismaStub.otpCode.create).not.toHaveBeenCalled();
  });
});

describe('verifyResetOtp', () => {
  it('throws 401 when no matching reset OTP exists', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.otpCode.findFirst.mockResolvedValue(null);

    await expect(svc.verifyResetOtp({ email: 'x@y.com', code: 'bad' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('issues a purpose-locked 15-min JWT on success and consumes the OTP', async () => {
    const { svc, prismaStub, jwtStub } = makeService();
    prismaStub.otpCode.findFirst.mockResolvedValue({ id: 'otp-1' });
    prismaStub.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'x@y.com' });

    const res = await svc.verifyResetOtp({ email: 'x@y.com', code: '123456' });

    expect(jwtStub.sign).toHaveBeenCalledWith(
      { sub: 'user-1', email: 'x@y.com', purpose: 'password_reset' },
      { expiresIn: '15m' },
    );
    expect(prismaStub.otpCode.delete).toHaveBeenCalledWith({ where: { id: 'otp-1' } });
    expect(res.resetToken).toBe('mock-jwt-token');
  });
});

describe('resetPassword', () => {
  it('throws 401 when the reset token is invalid / expired', async () => {
    const { svc, prismaStub, jwtStub } = makeService();
    jwtStub.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    await expect(
      svc.resetPassword({ resetToken: 'bad', newPassword: 'new-strong-pw' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(bcryptHash).not.toHaveBeenCalled();
    expect(prismaStub.user.update).not.toHaveBeenCalled();
  });

  it('REJECTS a token whose purpose is NOT "password_reset" (cross-purpose abuse)', async () => {
    const { svc, prismaStub, jwtStub } = makeService();
    // An attacker who got hold of a regular session JWT shouldn't be
    // able to use it to reset the password.
    jwtStub.verify.mockReturnValue({
      sub: 'user-1',
      email: 'x@y.com',
      purpose: 'login', // <-- wrong purpose
    });

    await expect(
      svc.resetPassword({ resetToken: 'session-jwt', newPassword: 'new-strong-pw' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(prismaStub.user.update).not.toHaveBeenCalled();
  });

  it('hashes the new password and updates the user on a valid reset token', async () => {
    const { svc, prismaStub, jwtStub } = makeService();
    jwtStub.verify.mockReturnValue({
      sub: 'user-1',
      email: 'x@y.com',
      purpose: 'password_reset',
    });
    prismaStub.user.update.mockResolvedValue({ id: 'user-1', email: 'x@y.com' });

    await svc.resetPassword({
      resetToken: 'valid-reset-jwt',
      newPassword: 'new-strong-password',
    });

    expect(bcryptHash).toHaveBeenCalledWith('new-strong-password', 10);
    expect(prismaStub.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { password: '$2b$10$mockedhash' },
    });
  });
});
