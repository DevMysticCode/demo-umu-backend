import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AddEvidenceDto {
  // Optional to preserve existing behaviour: a missing `photos` field
  // defaults to an empty array in the controller (body?.photos ?? []).
  @ApiPropertyOptional({ description: 'Photo URLs evidencing completed payment-stage work. Maximum 50.', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  photos?: string[];
}
