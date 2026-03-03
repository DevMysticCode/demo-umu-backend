import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export class SaveQuestionnaireDto {
  purpose?: string[];
  buyingTimeline?: string;
  budgetMin?: number;
  budgetMax?: number;
  propertyTypes?: string[];
  propertyStyles?: string[];
  importantFeatures?: string[];
  sellingTimeline?: string;
  propertyValue?: number;
}

@Injectable()
export class OnboardingService {
  constructor(private prisma: PrismaService) {}

  async saveQuestionnaire(userId: string, dto: SaveQuestionnaireDto) {
    const preference = await this.prisma.userPreference.upsert({
      where: { userId },
      update: {
        purpose: dto.purpose ?? undefined,
        buyingTimeline: dto.buyingTimeline ?? undefined,
        budgetMin: dto.budgetMin ?? undefined,
        budgetMax: dto.budgetMax ?? undefined,
        propertyTypes: dto.propertyTypes ?? undefined,
        propertyStyles: dto.propertyStyles ?? undefined,
        importantFeatures: dto.importantFeatures ?? undefined,
        sellingTimeline: dto.sellingTimeline ?? undefined,
        propertyValue: dto.propertyValue ?? undefined,
      },
      create: {
        userId,
        purpose: dto.purpose,
        buyingTimeline: dto.buyingTimeline,
        budgetMin: dto.budgetMin,
        budgetMax: dto.budgetMax,
        propertyTypes: dto.propertyTypes,
        propertyStyles: dto.propertyStyles,
        importantFeatures: dto.importantFeatures,
        sellingTimeline: dto.sellingTimeline,
        propertyValue: dto.propertyValue,
      },
    });

    return { message: 'Preferences saved successfully', preference };
  }

  async getQuestionnaire(userId: string) {
    const preference = await this.prisma.userPreference.findUnique({
      where: { userId },
    });
    return preference;
  }
}
