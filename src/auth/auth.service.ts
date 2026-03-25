import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as nodemailer from 'nodemailer';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const appleSignin = require('apple-signin-auth') as {
  verifyIdToken: (
    idToken: string,
    options: { audience: string; ignoreExpiration: boolean },
  ) => Promise<{ sub: string; email?: string }>;
};
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
  private readonly googleClient = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
  );
  private readonly mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    requireTLS: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {
    // Verify SMTP connection on startup — logs a warning but does not crash
    this.mailer.verify().then(() => {
      console.log('[SMTP] Connection verified — emails ready to send');
    }).catch((err) => {
      console.warn('[SMTP] Connection failed — emails will not be sent:', err?.message ?? err);
    });
  }

  private generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private async sendOtpEmail(email: string, otp: string): Promise<void> {
    const expiryMins = this.OTP_EXPIRY_MINUTES;
    await this.mailer.sendMail({
      from: process.env.SMTP_FROM || 'UmovingU <info@umovingu.io>',
      to: email,
      subject: `Your UmovingU verification code: ${otp}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #ffffff;">
          <div style="text-align: center; margin-bottom: 32px;">
            <img src="https://umovingu.io/logo.png" alt="UmovingU" style="height: 40px;" onerror="this.style.display='none'" />
            <h2 style="color: #1f2024; font-size: 22px; margin: 16px 0 4px;">Verify your email</h2>
            <p style="color: #8f9094; font-size: 14px; margin: 0;">Enter this code to continue signing up</p>
          </div>
          <div style="background: #f6f6f7; border-radius: 16px; padding: 28px; text-align: center; margin-bottom: 24px;">
            <p style="color: #8f9094; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; margin: 0 0 12px;">Your verification code</p>
            <div style="font-size: 40px; font-weight: 700; letter-spacing: 10px; color: #00a19a;">${otp}</div>
            <p style="color: #8f9094; font-size: 12px; margin: 12px 0 0;">Expires in ${expiryMins} minutes</p>
          </div>
          <p style="color: #8f9094; font-size: 13px; text-align: center; margin: 0;">If you didn't request this, you can safely ignore this email. Someone may have typed your email address by mistake.</p>
          <hr style="border: none; border-top: 1px solid #e5e5ea; margin: 24px 0;" />
          <p style="color: #b4b5b8; font-size: 11px; text-align: center; margin: 0;">© ${new Date().getFullYear()} UmovingU. All rights reserved.</p>
        </div>
      `,
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

  async googleLogin(credential: string) {
    const ticket = await this.googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      throw new UnauthorizedException('Invalid Google token');
    }

    const { email, given_name, family_name } = payload;

    let user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          password: '',
          firstName: given_name ?? '',
          lastName: family_name ?? '',
          isVerified: true,
        },
      });
    }

    const token = this.jwtService.sign({ sub: user.id, email: user.email });

    return {
      message: 'Google login successful',
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

  async appleLogin(idToken: string, firstName?: string, lastName?: string) {
    let claims: { sub: string; email?: string };
    try {
      claims = await appleSignin.verifyIdToken(idToken, {
        audience: process.env.APPLE_CLIENT_ID ?? '',
        ignoreExpiration: false,
      });
    } catch {
      throw new UnauthorizedException('Invalid Apple token');
    }

    const sub: string = claims.sub;
    const email: string | undefined = claims.email;

    if (!sub) throw new UnauthorizedException('Invalid Apple token: missing sub');

    // Use real email, or a stable address derived from Apple's sub
    const userEmail = email ?? `${sub}@apple.private`;

    let user = await this.prisma.user.findUnique({
      where: { email: userEmail },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: userEmail,
          password: '',
          firstName: firstName ?? '',
          lastName: lastName ?? '',
          isVerified: true,
        },
      });
    } else if ((firstName || lastName) && !user.firstName && !user.lastName) {
      // Apple sends name only on first auth — update if profile is still blank
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          firstName: firstName ?? user.firstName ?? '',
          lastName: lastName ?? user.lastName ?? '',
        },
      });
    }

    const token = this.jwtService.sign({ sub: user.id, email: user.email });

    return {
      message: 'Apple login successful',
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
      await this.mailer.sendMail({
        from: process.env.SMTP_FROM ?? 'UMovingU <info@umovingu.io>',
        to: email,
        subject: `Reset your password — code: ${otp}`,
        html: `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#ffffff;">
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

  /** Dev-only: skips Apple token verification — localhost testing only */
  async appleDevMock(email: string, firstName?: string, lastName?: string) {
    let user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          password: '',
          firstName: firstName ?? 'Apple',
          lastName: lastName ?? 'Test',
          isVerified: true,
        },
      });
    }

    const token = this.jwtService.sign({ sub: user.id, email: user.email });

    return {
      message: 'Apple login successful',
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
}
