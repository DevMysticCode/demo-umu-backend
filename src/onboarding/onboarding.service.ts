import { Injectable } from '@nestjs/common';
import { IsArray, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

// The global ValidationPipe runs with `whitelist: true`, which strips any
// property that has no class-validator decorator — without these, every
// field here was silently discarded (request body arrived as `{}`), so
// onboarding answers were never actually persisted even though the
// endpoint returned "Preferences saved successfully".
export class SaveQuestionnaireDto {
  @ApiPropertyOptional({ description: "Buyer's stated purpose(s) for using the app (e.g. buying, selling, renting).", type: [String] })
  @IsOptional()
  @IsArray()
  purpose?: string[];

  @ApiPropertyOptional({ description: 'How soon the buyer intends to purchase.' })
  @IsOptional()
  @IsString()
  buyingTimeline?: string;

  @ApiPropertyOptional({ description: "Lower bound of the buyer's budget, in pounds." })
  @IsOptional()
  @IsInt()
  @Min(0)
  budgetMin?: number;

  @ApiPropertyOptional({ description: "Upper bound of the buyer's budget, in pounds." })
  @IsOptional()
  @IsInt()
  @Min(0)
  budgetMax?: number;

  @ApiPropertyOptional({ description: 'Property types the buyer is interested in (e.g. detached, flat).', type: [String] })
  @IsOptional()
  @IsArray()
  propertyTypes?: string[];

  @ApiPropertyOptional({ description: 'Property styles the buyer is interested in.', type: [String] })
  @IsOptional()
  @IsArray()
  propertyStyles?: string[];

  @ApiPropertyOptional({ description: 'Features the buyer considers important (e.g. garden, parking).', type: [String] })
  @IsOptional()
  @IsArray()
  importantFeatures?: string[];

  @ApiPropertyOptional({ description: 'How soon the seller intends to sell.' })
  @IsOptional()
  @IsString()
  sellingTimeline?: string;

  @ApiPropertyOptional({ description: "The seller's estimated property value, in pounds." })
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
