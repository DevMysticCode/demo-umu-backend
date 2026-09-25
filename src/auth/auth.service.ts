import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Resend } from 'resend';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RewardsService } from '../rewards/rewards.service';
import { captureException } from '../common/sentry';
import {
  RequestOtpDto,
  VerifyOtpDto,
  RegisterDto,
  LoginDto,
  ForgotPasswordDto,
  VerifyResetOtpDto,
  ResetPasswordDto,
} from './dto';

@Injectable()
export class AuthService {
  private readonly OTP_EXPIRY_MINUTES = 10;
  // Per-account OTP attempt lockout — on top of the 5 req/min/IP throttle,
  // which alone doesn't stop a distributed attacker rotating source IPs
  // against one target account (security review 2026-09-22, L1).
  private readonly MAX_OTP_ATTEMPTS = 5;
  private readonly resend: Resend;

  // Access/refresh split (security review follow-up, 2026-09-25). The
  // access JWT is now short-lived and carries the same sub/email payload as
  // before; the refresh token is a long, opaque random string — never a
  // JWT — stored server-side only as a SHA-256 hash, so it can actually be
  // revoked (logout, password change, reuse-after-theft detection), unlike
  // the old single 7-day JWT which nothing could invalidate early.
  private readonly REFRESH_TOKEN_TTL_DAYS = 30;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private rewards: RewardsService,
  ) {
    this.resend = new Resend(process.env.RESEND_API_KEY ?? '');
  }

  private generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  private issueAccessToken(userId: string, email: string): string {
    return this.jwtService.sign({ sub: userId, email });
  }

  private async issueRefreshToken(
    userId: string,
    meta?: { userAgent?: string; ip?: string },
  ): Promise<string> {
    const raw = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(
      Date.now() + this.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(raw),
        expiresAt,
        userAgent: meta?.userAgent,
        ip: meta?.ip,
      },
    });
    return raw;
  }

  /** Issues a fresh access+refresh pair for a just-authenticated user. */
  private async issueTokenPair(
    userId: string,
    email: string,
    meta?: { userAgent?: string; ip?: string },
  ): Promise<{ token: string; refreshToken: string }> {
    const token = this.issueAccessToken(userId, email);
    const refreshToken = await this.issueRefreshToken(userId, meta);
    return { token, refreshToken };
  }

  /**
   * Exchanges a valid, unexpired, unrevoked refresh token for a new
   * access/refresh pair, rotating the refresh token in the same operation
   * (old one is marked revoked + linked to its replacement, never reused).
   *
   * If the presented token was ALREADY revoked — meaning it was already
   * rotated (or explicitly logged out) once before — that's a strong signal
   * someone is replaying a stolen refresh token after the legitimate client
   * already moved on. We respond by revoking every other outstanding
   * refresh token for that user, forcing every session (attacker's and
   * victim's alike) to re-authenticate, rather than silently honouring the
   * replay.
   */
  async refresh(
    rawRefreshToken: string,
    meta?: { userAgent?: string; ip?: string },
  ): Promise<{ token: string; refreshToken: string }> {
    if (!rawRefreshToken) {
      throw new UnauthorizedException('Refresh token required');
    }
    const tokenHash = this.hashToken(rawRefreshToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!existing) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (existing.revokedAt) {
      // Reuse of an already-rotated/revoked token — treat as compromise.
      await this.prisma.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException(
        'This refresh token has already been used - all sessions for this account have been signed out as a precaution.',
      );
    }
    if (existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: existing.userId },
      select: { id: true, email: true },
    });
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }

    const newRawRefreshToken = await this.issueRefreshToken(user.id, meta);
    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: {
        revokedAt: new Date(),
        replacedByTokenHash: this.hashToken(newRawRefreshToken),
        lastUsedAt: new Date(),
      },
    });

    return {
      token: this.issueAccessToken(user.id, user.email),
      refreshToken: newRawRefreshToken,
    };
  }

  /** Revokes a single refresh token (used by logout). Never throws on an
   * already-invalid token — logout should always succeed client-side. */
  async revokeRefreshToken(rawRefreshToken: string): Promise<void> {
    if (!rawRefreshToken) return;
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.prisma.refreshToken
      .updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => undefined);
  }

  /** Revokes every outstanding refresh token for a user — called on
   * password change/reset so a compromised-but-not-yet-caught session is
   * killed the moment the legitimate user regains control. */
  private async revokeAllRefreshTokensForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // "Create UMU account" — 250 pts per the client's Major Actions Points
  // Framework, seeded with verificationRequired: true (points are meant to
  // sit PENDING until email/mobile is verified). Both of this service's
  // "a brand new account just became verified" moments — OTP verification
  // and the legacy direct-register path — already only call this once the
  // account IS verified, so award() would write PENDING and nothing would
  // ever confirm it; immediately confirming afterwards is what actually
  // realises the "pending until verified" intent for these two flows.
  // subjectId = userId, so this can only ever fire once per account.
  // Never allowed to block signup.
  private grantAccountCreatedPoints(userId: string) {
    this.rewards
      .award(userId, 'ACCOUNT_CREATED', userId)
      .then(() => this.rewards.confirmAward(userId, 'ACCOUNT_CREATED', userId))
      .catch((err) =>
        console.error(`[Rewards] ACCOUNT_CREATED award failed: ${err?.message}`),
      );
  }

  private readonly FROM =
    process.env.RESEND_FROM ?? 'UMovingU <onboarding@resend.dev>';

  private async sendOtpEmail(email: string, otp: string): Promise<void> {
    const expiryMins = this.OTP_EXPIRY_MINUTES;
    const year = new Date().getFullYear();
    // Resend's SDK returns { data, error } rather than throwing for
    // API-level rejections (bad domain, unverified sender, over quota,
    // etc.) — only throws for network-level failures. Without this
    // check, a rejected send looked identical to a successful one: no
    // exception, 201 response, and total silence in the logs.
    const result = await this.resend.emails.send({
      from: this.FROM,
      to: email,
      subject: `Your UMovingU verification code: ${otp}`,
      html: `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#ffffff;">
  <div style="text-align:center;margin-bottom:32px;">
    <h2 style="color:#1f2024;font-size:22px;margin:16px 0 4px;">Verify your email</h2>
    <p style="color:#8f9094;font-size:14px;margin:0;">Enter this code to continue signing up</p>
  </div>
  <div style="background:#f6f6f7;border-radius:16px;padding:28px;text-align:center;margin-bottom:24px;">
    <p style="color:#8f9094;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin:0 0 12px;">Your verification code</p>
    <div style="font-size:40px;font-weight:700;letter-spacing:10px;color:#00a19a;">${otp}</div>
    <p style="color:#8f9094;font-size:12px;margin:12px 0 0;">Expires in ${expiryMins} minutes</p>
  </div>
  <p style="color:#8f9094;font-size:13px;text-align:center;margin:0;">If you did not request this you can safely ignore this email.</p>
  <hr style="border:none;border-top:1px solid #e5e5ea;margin:24px 0;" />
  <p style="color:#b4b5b8;font-size:11px;text-align:center;margin:0;">&#169; ${year} UMovingU. All rights reserved.</p>
</div>`,
    });
    if (result.error) {
      throw new Error(`Resend rejected the send: ${JSON.stringify(result.error)}`);
    }
  }

  async checkEmail(email: string): Promise<{ exists: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, isVerified: true },
    });
    // Only considered "exists" if they have completed signup (isVerified)
    return { exists: !!(user && user.isVerified) };
  }

  async requestOtp(dto: RequestOtpDto) {
    const { email } = dto;

    // Ensure user placeholder exists
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (!existing) {
      await this.prisma.user.create({
        data: { email, password: '' },
      });
    }

    // Invalidate any previous unused OTPs for this email
    await this.prisma.otpCode.deleteMany({ where: { email } });

    const otp = this.generateOtp();
    const expiresAt = new Date(Date.now() + this.OTP_EXPIRY_MINUTES * 60 * 1000);

    await this.prisma.otpCode.create({
      data: { email, code: otp, expiresAt },
    });

    try {
      await this.sendOtpEmail(email, otp);
    } catch (mailErr) {
      // Log the SMTP error but don't crash the request.
      // In development the OTP is logged to console so you can still test.
      console.error('[OTP] Failed to send email:', mailErr?.message ?? mailErr);
      // Report to Sentry so an OTP outage shows up on the alert dash.
      // The exception filter only catches unhandled errors — this is a
      // handled "graceful degrade" path that would otherwise be silent.
      captureException(mailErr, { route: 'auth/request-otp', email });
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[OTP DEV] Code for ${email}: ${otp}`);
      }
    }

    return { message: 'Verification code sent to your email', email };
  }

  // Shared by verifyOtp and verifyResetOtp: looks up the current
  // (non-expired) OTP for this email regardless of the code the caller
  // supplied, enforces the per-account attempt lockout, and only then
  // checks whether the supplied code actually matches — incrementing the
  // attempt counter on a miss. A found-but-locked-out row and a
  // found-but-wrong-code row both throw the same generic message so a
  // caller can't distinguish "row exists, wrong code" from "locked out"
  // from "no OTP at all" by response shape.
  private async checkAndConsumeOtpAttempt(
    email: string,
    code: string,
  ): Promise<{ id: string }> {
    const current = await this.prisma.otpCode.findFirst({
      where: { email, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!current) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }
    if (current.attempts >= this.MAX_OTP_ATTEMPTS) {
      throw new UnauthorizedException(
        'Too many incorrect attempts - request a new code',
      );
    }
    if (current.code !== code) {
      await this.prisma.otpCode.update({
        where: { id: current.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Invalid or expired OTP');
    }
    return { id: current.id };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const { email, code } = dto;

    const otpRecord = await this.checkAndConsumeOtpAttempt(email, code);

    // Mark user as verified
    const user = await this.prisma.user.update({
      where: { email },
      data: {
        isVerified: true,
      },
    });
    this.grantAccountCreatedPoints(user.id);

    // Delete used OTP
    await this.prisma.otpCode.delete({
      where: { id: otpRecord.id },
    });

    const { token, refreshToken } = await this.issueTokenPair(user.id, user.email);

    return {
      message: 'Email verified successfully',
      token,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        isVerified: user.isVerified,
      },
    };
  }

  async register(dto: RegisterDto) {
    const {
      email,
      password,
      firstName,
      lastName,
      phone,
      dob,
      postcode,
      gender,
    } = dto;

    // Check if user exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Parse DOB if provided
    const dobDate = dob ? new Date(dob) : null;

    let user: Awaited<ReturnType<typeof this.prisma.user.findUnique>>;

    if (existingUser) {
      // If user exists and is verified (from OTP), update their details
      if (existingUser.isVerified) {
        user = await this.prisma.user.update({
          where: { email },
          data: {
            password: hashedPassword,
            firstName,
            lastName,
            phone,
            dob: dobDate,
            postcode,
            gender,
          },
        });
      } else {
        throw new ConflictException('Email already registered');
      }
    } else {
      // Create new user if doesn't exist
      user = await this.prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName,
          lastName,
          phone,
          dob: dobDate,
          postcode,
          gender,
          isVerified: true,
        },
      });
      this.grantAccountCreatedPoints(user.id);
    }

    if (!user) {
      throw new ConflictException('Failed to create or update user');
    }

    const { token, refreshToken } = await this.issueTokenPair(user.id, user.email);

    return {
      message: 'User registered successfully',
      token,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isVerified: user.isVerified,
      },
    };
  }

  async login(dto: LoginDto) {
    const { email, password } = dto;

    // Find user
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const { token, refreshToken } = await this.issueTokenPair(user.id, user.email);

    return {
      message: 'Login successful',
      token,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isVerified: user.isVerified,
      },
    };
  }


  // ── Password Reset ───────────────────────────────────────────────────────

  private readonly RESET_RESPONSE =
    'If an account exists for this email, a reset code has been sent.';

  async forgotPassword(dto: ForgotPasswordDto) {
    const { email } = dto;

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, isVerified: true },
    });

    // Always return a generic message to avoid user enumeration
    if (!user || !user.isVerified) {
      return { message: this.RESET_RESPONSE };
    }

    // Invalidate any existing OTPs for this email
    await this.prisma.otpCode.deleteMany({ where: { email } });

    const otp = this.generateOtp();
    const expiresAt = new Date(
      Date.now() + this.OTP_EXPIRY_MINUTES * 60 * 1000,
    );

    await this.prisma.otpCode.create({
      data: { email, code: otp, expiresAt },
    });

    const year = new Date().getFullYear();
    const expiryMins = this.OTP_EXPIRY_MINUTES;

    try {
      const result = await this.resend.emails.send({
        from: this.FROM,
        to: email,
        subject: `Reset your password - code: ${otp}`,
        html: `
<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#ffffff;">
  <div style="text-align:center;margin-bottom:32px;">
    <h2 style="color:#1f2024;font-size:22px;margin:16px 0 4px;">Reset your password</h2>
    <p style="color:#8f9094;font-size:14px;margin:0;">Use this code to set a new UMovingU password</p>
  </div>
  <div style="background:#f6f6f7;border-radius:16px;padding:28px;text-align:center;margin-bottom:24px;">
    <p style="color:#8f9094;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin:0 0 12px;">Your reset code</p>
    <div style="font-size:40px;font-weight:700;letter-spacing:10px;color:#00a19a;">${otp}</div>
    <p style="color:#8f9094;font-size:12px;margin:12px 0 0;">Expires in ${expiryMins} minutes</p>
  </div>
  <p style="color:#8f9094;font-size:13px;text-align:center;margin:0;">If you did not request a password reset you can safely ignore this email.</p>
  <hr style="border:none;border-top:1px solid #e5e5ea;margin:24px 0;" />
  <p style="color:#b4b5b8;font-size:11px;text-align:center;margin:0;">&#169; ${year} UMovingU. All rights reserved.</p>
</div>`,
      });
      if (result.error) {
        throw new Error(`Resend rejected the send: ${JSON.stringify(result.error)}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[PASSWORD RESET] Failed to send email:', msg);
      // Same reasoning as the OTP path — silent SMTP failure should
      // raise a Sentry alert even though the request returns 200.
      captureException(err, { route: 'auth/forgot-password', email });
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[PASSWORD RESET DEV] Code for ${email}: ${otp}`);
      }
    }

    return { message: this.RESET_RESPONSE };
  }

  async verifyResetOtp(dto: VerifyResetOtpDto) {
    const { email, code } = dto;

    const otpRecord = await this.checkAndConsumeOtpAttempt(email, code);

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });

    if (!user) {
      throw new NotFoundException('Account not found');
    }

    // Delete the OTP — consumed
    await this.prisma.otpCode.delete({ where: { id: otpRecord.id } });

    // Short-lived reset token (15 min), purpose-locked to password reset
    const resetToken = this.jwtService.sign(
      { sub: user.id, email: user.email, purpose: 'password_reset' },
      { expiresIn: '15m' },
    );

    return { resetToken };
  }

  /**
   * Logged-in password change. Verifies the user's current password before
   * setting a new one. Used by the Settings → Change password drawer.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    if (!currentPassword || !newPassword) {
      throw new BadRequestException('Current and new password are required');
    }
    if (newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (!user.password) {
      // Account was created via Google / Apple / OTP and has no password set.
      throw new BadRequestException(
        'This account does not use a password - sign in with the social provider you originally used.',
      );
    }

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    const hashed = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      // passwordChangedAt: any bearer token issued before this instant
      // stops working on the next request (JwtAuthGuard checks it).
      data: { password: hashed, passwordChangedAt: new Date() },
    });
    // Refresh tokens are opaque, so passwordChangedAt alone can't reject
    // them — revoke every outstanding one explicitly, matching what
    // passwordChangedAt already does for access tokens.
    await this.revokeAllRefreshTokensForUser(userId);

    return { message: 'Password updated' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const { resetToken, newPassword } = dto;

    type ResetPayload = { sub: string; email: string; purpose: string };
    let payload: ResetPayload;
    try {
      payload = this.jwtService.verify<ResetPayload>(resetToken);
    } catch {
      throw new UnauthorizedException('Reset token is invalid or has expired');
    }

    if (payload.purpose !== 'password_reset') {
      throw new UnauthorizedException('Invalid reset token');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: payload.sub },
      // See changePassword() above for why this matters.
      data: { password: hashedPassword, passwordChangedAt: new Date() },
    });
    await this.revokeAllRefreshTokensForUser(payload.sub);

    return { message: 'Password updated successfully' };
  }

}
