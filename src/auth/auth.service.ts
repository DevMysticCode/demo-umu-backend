import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
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
import { RequestOtpDto, VerifyOtpDto, RegisterDto, LoginDto } from './dto';

@Injectable()
export class AuthService {
  private readonly HARDCODED_OTP = '123456';
  private readonly OTP_EXPIRY_MINUTES = 5;
  private readonly googleClient = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
  );

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async requestOtp(dto: RequestOtpDto) {
    const { email } = dto;

    // Check if user exists
    let user = await this.prisma.user.findUnique({
      where: { email },
    });

    // Create user if doesn't exist
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          password: '', // Placeholder until verified
        },
      });
    }

    // Generate OTP expiry
    const expiresAt = new Date(
      Date.now() + this.OTP_EXPIRY_MINUTES * 60 * 1000,
    );

    // Create OTP record
    await this.prisma.otpCode.create({
      data: {
        email,
        code: this.HARDCODED_OTP,
        expiresAt,
      },
    });

    return {
      message: 'OTP sent successfully',
      email,
      // For development only - remove in production
      otp: this.HARDCODED_OTP,
    };
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
