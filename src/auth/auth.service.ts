import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RequestOtpDto, VerifyOtpDto, RegisterDto, LoginDto } from './dto';

@Injectable()
export class AuthService {
  private readonly HARDCODED_OTP = '123456';
  private readonly OTP_EXPIRY_MINUTES = 5;

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

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Parse DOB if provided
    const dobDate = dob ? new Date(dob) : null;

    // Create user
    const user = await this.prisma.user.create({
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

    return {
      message: 'User registered successfully',
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
}
