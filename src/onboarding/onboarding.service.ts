import { Injectable } from '@nestjs/common';
import { IsArray, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

// The global ValidationPipe runs with `whitelist: true`, which strips any
// property that has no class-validator decorator — without these, every
// field here was silently discarded (request body arrived as `{}`), so
// onboarding answers were never actually persisted even though the
// endpoint returned "Preferences saved successfully".
export class SaveQuestionnaireDto {
  @IsOptional()
  @IsArray()
  purpose?: string[];

  @IsOptional()
  @IsString()
  buyingTimeline?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  budgetMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  budgetMax?: number;

  @IsOptional()
  @IsArray()
  propertyTypes?: string[];

  @IsOptional()
  @IsArray()
  propertyStyles?: string[];

  @IsOptional()
  @IsArray()
  importantFeatures?: string[];

  @IsOptional()
  @IsString()
  sellingTimeline?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
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
