import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOfferDto {
  @ApiProperty({ description: 'Offered price for the job, in pounds.', minimum: 1, maximum: 1_000_000 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  price!: number;

  @ApiProperty({ description: 'Message to the job poster explaining the offer.', minLength: 20, maxLength: 4000 })
  @IsString()
  @Length(20, 4000)
  message!: string;

  @ApiPropertyOptional({ description: 'Date the tradesperson would be available to start, ISO date string.' })
  @IsOptional()
  @IsString()
  availableDate?: string;
}
