import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export class CreateSupportRequestDto {
  name: string;
  email: string;
  subject: string;
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
