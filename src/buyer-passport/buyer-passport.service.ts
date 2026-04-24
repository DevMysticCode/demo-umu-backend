import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export class UpdateBuyerPassportDto {
  idDocumentType?: string | null;
  idDocumentUrl?: string | null;
  fundsType?: string | null;
  fundsAmount?: number | null;
  fundsDocumentUrl?: string | null;
  chainPosition?: string | null;
  solicitorStatus?: string | null;
  timeline?: string | null;
  statement?: string | null;
  completedSteps?: number;
}

@Injectable()
export class BuyerPassportService {
  constructor(private prisma: PrismaService) {}

  async getMine(userId: string) {
    return this.prisma.buyerPassport.findUnique({ where: { userId } });
  }

  async upsert(userId: string, dto: UpdateBuyerPassportDto) {
    // Normalise — only persist keys that were explicitly provided
    const data: Record<string, any> = {};
    for (const k of Object.keys(dto) as (keyof UpdateBuyerPassportDto)[]) {
      const v = dto[k];
      if (v !== undefined) data[k] = v;
    }

    return this.prisma.buyerPassport.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  async publish(userId: string) {
    const existing = await this.prisma.buyerPassport.findUnique({ where: { userId } });
    if (!existing) {
      throw new NotFoundException('Buyer passport not found — start by building one first');
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

    return this.prisma.buyerPassport.update({
      where: { userId },
      data: { published: true, completedSteps: 5 },
    });
  }

  async remove(userId: string) {
    const existing = await this.prisma.buyerPassport.findUnique({ where: { userId } });
    if (!existing) return { message: 'Nothing to delete' };
    await this.prisma.buyerPassport.delete({ where: { userId } });
    return { message: 'Buyer passport deleted' };
  }
}
