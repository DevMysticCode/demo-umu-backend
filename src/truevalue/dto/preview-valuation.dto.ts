import { IsIn, IsOptional, IsString } from 'class-validator';

// Documents the shape of POST /property/:id/truevalue/preview's body.
// The handler still reads `works` and `epcStatus` via individual
// @Body(...) field extraction (unchanged) — this class is referenced
// only via @ApiBody({ type: ... }) for Swagger, so it adds documentation
// without introducing request validation that didn't exist before.
export class PreviewWorkItemDto {
  @IsString()
  workTypeCode: string;

  // preview only ever needs these two states (see PreviewWorkInput in
  // truevalue.service.ts)
  @IsOptional()
  @IsIn(['self', 'verified'])
  verificationState?: 'self' | 'verified';
}

export class PreviewValuationDto {
  works: PreviewWorkItemDto[];

  @IsOptional()
  @IsIn(['current', 'stale', 'none'])
  epcStatus?: 'current' | 'stale' | 'none';
}
