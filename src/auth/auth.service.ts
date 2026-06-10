import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Resend } from 'resend';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
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
  private readonly resend: Resend;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {
    this.resend = new Resend(process.env.RESEND_API_KEY ?? '');
  }

  private generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private readonly FROM =
    process.env.RESEND_FROM ?? 'UMovingU <onboarding@resend.dev>';

  private async sendOtpEmail(email: string, otp: string): Promise<void> {
    const expiryMins = this.OTP_EXPIRY_MINUTES;
    const year = new Date().getFullYear();
    await this.resend.emails.send({
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
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[OTP DEV] Code for ${email}: ${otp}`);
      }
    }

    return { message: 'Verification code sent to your email', email };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const { email, code } = dto;

    // Find valid OTP
    const otpRecord = await this.prisma.otpCode.findFirst({
      where: {
        email,
        code,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!otpRecord) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    // Mark user as verified
    const user = await this.prisma.user.update({
      where: { email },
      data: {
        isVerified: true,
      },
    });

    // Delete used OTP
    await this.prisma.otpCode.delete({
      where: { id: otpRecord.id },
    });

    // ✅ ISSUE JWT HERE
    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
    });

    return {
      message: 'Email verified successfully',
      token,
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
    }

    if (!user) {
      throw new ConflictException('Failed to create or update user');
    }

    // Generate JWT token for automatic login
    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
    });

    return {
      message: 'User registered successfully',
      token,
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

    // Generate JWT
    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
    });

    return {
      message: 'Login successful',
      token,
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
      await this.resend.emails.send({
        from: this.FROM,
        to: email,
        subject: `Reset your password — code: ${otp}`,
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[PASSWORD RESET] Failed to send email:', msg);
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[PASSWORD RESET DEV] Code for ${email}: ${otp}`);
      }
    }

    return { message: this.RESET_RESPONSE };
  }

  async verifyResetOtp(dto: VerifyResetOtpDto) {
    const { email, code } = dto;

    const otpRecord = await this.prisma.otpCode.findFirst({
      where: {
        email,
        code,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      throw new UnauthorizedException('Invalid or expired reset code');
    }

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
        'This account does not use a password — sign in with the social provider you originally used.',
      );
    }

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    const hashed = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });

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
      data: { password: hashedPassword },
    });

    return { message: 'Password updated successfully' };
  }

}
