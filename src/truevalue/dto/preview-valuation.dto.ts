import { IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Documents the shape of POST /property/:id/truevalue/preview's body.
// The handler still reads `works` and `epcStatus` via individual
// @Body(...) field extraction (unchanged) — this class is referenced
// only via @ApiBody({ type: ... }) for Swagger, so it adds documentation
// without introducing request validation that didn't exist before.
export class PreviewWorkItemDto {
  @ApiProperty({ description: 'The type of work being previewed (e.g. an extension, a loft conversion).' })
  @IsString()
  workTypeCode: string;

  // preview only ever needs these two states (see PreviewWorkInput in
  // truevalue.service.ts)
  @ApiPropertyOptional({ description: 'Whether this work is self-declared or independently verified - affects how much it can move the preview valuation.', enum: ['self', 'verified'] })
  @IsOptional()
  @IsIn(['self', 'verified'])
  verificationState?: 'self' | 'verified';
}

export class PreviewValuationDto {
  @ApiProperty({ type: [PreviewWorkItemDto], description: 'Works to include in the preview valuation.' })
  works: PreviewWorkItemDto[];

  @ApiPropertyOptional({ description: "Freshness of the property's EPC, which affects the preview valuation.", enum: ['current', 'stale', 'none'] })
  @IsOptional()
  @IsIn(['current', 'stale', 'none'])
  epcStatus?: 'current' | 'stale' | 'none';
}
