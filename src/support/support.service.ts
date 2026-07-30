import { Injectable } from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

// The global ValidationPipe runs with `whitelist: true`, which strips any
// property that has no class-validator decorator. Without these, every
// field on this DTO was being stripped before it reached the service —
// the request body arrived as `{}` and Prisma rejected the create() call
// with a generic "Invalid data supplied", silently breaking every
// support/contact submission.
export class CreateSupportRequestDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  subject: string;

  @IsString()
  @MinLength(1)
  message: string;
}

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async createRequest(dto: CreateSupportRequestDto) {
    const ticketNumber = `SUP-${Date.now().toString(36).toUpperCase()}`;
    return this.prisma.supportRequest.create({
      data: {
        ticketNumber,
        name: dto.name,
        email: dto.email,
        subject: dto.subject,
        message: dto.message,
      },
    });
  }
}
