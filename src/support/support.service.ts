import { Injectable } from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

// The global ValidationPipe runs with `whitelist: true`, which strips any
// property that has no class-validator decorator. Without these, every
// field on this DTO was being stripped before it reached the service —
// the request body arrived as `{}` and Prisma rejected the create() call
// with a generic "Invalid data supplied", silently breaking every
// support/contact submission.
export class CreateSupportRequestDto {
  @ApiProperty({ description: "Submitter's name." })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ description: "Submitter's email address, for the support team to reply to." })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Subject line of the request.' })
  @IsString()
  @MinLength(1)
  subject: string;

  @ApiProperty({ description: 'The support request message.' })
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
