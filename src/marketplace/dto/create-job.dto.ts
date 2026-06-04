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

// The Post Job wizard collects the full payload before submitting.
// Photos are uploaded separately via POST /marketplace/upload-photo;
// the returned URLs are sent here. Min 3 photos matches the prototype's
// "Photo checklist" requirement.
export class CreateJobDto {
  @IsString()
  categorySlug!: string;

  @IsString()
  @Length(4, 120)
  title!: string;

  @IsString()
  @Length(20, 4000)
  description!: string;

  @IsString()
  @Length(2, 120)
  locationLabel!: string;

  @IsOptional()
  @IsString()
  postcode?: string;

  @IsIn(['urgent', 'standard', 'flexible'])
  urgency!: 'urgent' | 'standard' | 'flexible';

  @IsOptional()
  @IsString()
  availability?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  availableDates?: string[];

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  budgetMin!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  budgetMax?: number;

  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(12)
  @IsString({ each: true })
  photos!: string[]; // URLs returned from /marketplace/upload-photo
}
