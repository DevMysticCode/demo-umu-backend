import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateReviewDto {
  @ApiProperty({ description: 'Overall star rating, 1-5.', minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ description: 'Free-text review comment.', minLength: 1, maxLength: 4000 })
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  body?: string;

  // Optional per-dimension scores (1..5). Nullable so the supplier side
  // can post a rating + tags without filling sliders that don't apply.
  @ApiPropertyOptional({ description: 'Punctuality score, 1-5.', minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  punctuality?: number;

  @ApiPropertyOptional({ description: 'Communication score, 1-5.', minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  communication?: number;

  @ApiPropertyOptional({ description: 'Workmanship score, 1-5.', minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  workmanship?: number;

  @ApiPropertyOptional({ description: 'Reliability score, 1-5.', minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  reliability?: number;

  // Praise tags as picked from the chip row. Capped so we can't get a
  // flood of weird strings; each chip is also kept short.
  @ApiPropertyOptional({ description: 'Praise tags picked from a preset chip list. Maximum 20.', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tags?: string[];
}
