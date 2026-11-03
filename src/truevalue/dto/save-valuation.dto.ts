import { IsOptional, IsIn, IsBoolean, IsString } from 'class-validator';
import type { EpcStatus } from '../truevalue-engine';

// Was a plain `interface` (invisible to the @nestjs/swagger CLI plugin,
// which can only introspect class-validator-decorated classes) — kept as
// an exported class with identical field names/types/optionality so the
// documentation-only conversion is behavior-preserving for saveValuation().
export class SaveValuationDto {
  @IsOptional()
  @IsIn(['current', 'stale', 'none'])
  epcStatus?: EpcStatus;

  @IsOptional()
  @IsBoolean()
  isHomeowner?: boolean;

  @IsOptional()
  @IsBoolean()
  isLandlord?: boolean;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsString()
  foundNextHome?: string;
}
