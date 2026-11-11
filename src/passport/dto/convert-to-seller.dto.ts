import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ConvertToSellerDto {
  // No body fields needed — all info comes from the source passport
  // referenced in the URL.
  @ApiPropertyOptional({ description: 'Optional confirmation flag that the caller has acknowledged the convert-to-seller action.' })
  @IsOptional()
  @IsBoolean()
  acknowledged?: boolean;
}
