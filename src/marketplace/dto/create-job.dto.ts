import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// The Post Job wizard collects the full payload before submitting.
// Photos are uploaded separately via POST /marketplace/upload-photo;
// the returned URLs are sent here. Min 3 photos matches the prototype's
// "Photo checklist" requirement.
export class CreateJobDto {
  @ApiProperty({ description: 'Slug of the job category (e.g. "plumbing", "electrical").' })
  @IsString()
  categorySlug!: string;

  @ApiProperty({ description: 'Short job title.', minLength: 4, maxLength: 120 })
  @IsString()
  @Length(4, 120)
  title!: string;

  @ApiProperty({ description: 'Full description of the work needed.', minLength: 20, maxLength: 4000 })
  @IsString()
  @Length(20, 4000)
  description!: string;

  @ApiProperty({ description: 'Human-readable location for the job (e.g. a town/area name).', minLength: 2, maxLength: 120 })
  @IsString()
  @Length(2, 120)
  locationLabel!: string;

  @ApiPropertyOptional({ description: 'Postcode of the job location.' })
  @IsOptional()
  @IsString()
  postcode?: string;

  @ApiProperty({ description: 'How urgently the work is needed.', enum: ['urgent', 'standard', 'flexible'] })
  @IsIn(['urgent', 'standard', 'flexible'])
  urgency!: 'urgent' | 'standard' | 'flexible';

  @ApiPropertyOptional({ description: 'Free-text description of when the poster is available.' })
  @IsOptional()
  @IsString()
  availability?: string;

  @ApiPropertyOptional({ description: 'Specific dates the poster is available, ISO date strings.', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  availableDates?: string[];

  @ApiProperty({ description: 'Lower bound of the budget, in pounds.', minimum: 1, maximum: 1_000_000 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  budgetMin!: number;

  @ApiPropertyOptional({ description: 'Upper bound of the budget, in pounds.', minimum: 1, maximum: 1_000_000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  budgetMax?: number;

  @ApiProperty({ description: 'Photo URLs returned from POST /marketplace/upload-photo. Minimum 3, maximum 12.', type: [String] })
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(12)
  @IsString({ each: true })
  photos!: string[]; // URLs returned from /marketplace/upload-photo
}
