import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

// All fields decorated so that the global ValidationPipe (whitelist: true)
// keeps them in the request body instead of stripping them.
export class UpdateBuyerProfileDto {
  @IsOptional() @IsString() idDocumentType?: string | null;
  @IsOptional() @IsString() idDocumentUrl?: string | null;
  @IsOptional() @IsString() fundsType?: string | null;
  @IsOptional() @IsInt() @Min(0) fundsAmount?: number | null;
  @IsOptional() @IsString() fundsDocumentUrl?: string | null;
  @IsOptional() @IsString() chainPosition?: string | null;
  @IsOptional() @IsString() solicitorStatus?: string | null;
  @IsOptional() @IsString() timeline?: string | null;
  @IsOptional() @IsString() statement?: string | null;
  @IsOptional() @IsInt() @Min(0) completedSteps?: number;
}

@Injectable()
export class BuyerProfileService {
  constructor(private prisma: PrismaService) {}

  async getMine(userId: string) {
    return this.prisma.buyerProfile.findUnique({ where: { userId } });
  }

  async upsert(userId: string, dto: UpdateBuyerProfileDto) {
    // Whitelist allowed fields and only persist values that were sent.
    // (We can't rely on Object.keys(dto) when the body deserialises into a
    // plain object that NestJS never instantiated as a class.)
    const ALLOWED = [
      'idDocumentType',
      'idDocumentUrl',
      'fundsType',
      'fundsAmount',
      'fundsDocumentUrl',
      'chainPosition',
      'solicitorStatus',
      'timeline',
      'statement',
      'completedSteps',
    ] as const;

    const src = (dto ?? {}) as Record<string, any>;
    const data: Record<string, any> = {};
    for (const k of ALLOWED) {
      if (Object.prototype.hasOwnProperty.call(src, k)) {
        data[k] = src[k];
      }
    }

    return this.prisma.buyerProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  async publish(userId: string) {
    const existing = await this.prisma.buyerProfile.findUnique({ where: { userId } });
    if (!existing) {
      throw new NotFoundException('Buyer profile not found — start by building one first');
    }

    // Required: ID doc type, funds type+amount, chain position
    const missing: string[] = [];
    if (!existing.idDocumentType) missing.push('ID document');
    if (!existing.fundsType) missing.push('Proof of funds type');
    if (!existing.fundsAmount) missing.push('Maximum budget');
    if (!existing.chainPosition) missing.push('Chain position');
    if (missing.length > 0) {
      throw new BadRequestException(
        `Complete required steps first: ${missing.join(', ')}`,
      );
    }

    return this.prisma.buyerProfile.update({
      where: { userId },
      data: { published: true, completedSteps: 5 },
    });
  }

  async remove(userId: string) {
    const existing = await this.prisma.buyerProfile.findUnique({ where: { userId } });
    if (!existing) return { message: 'Nothing to delete' };
    await this.prisma.buyerProfile.delete({ where: { userId } });
    return { message: 'Buyer profile deleted' };
  }
}
