import { IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

// NOTE: every field below MUST carry a validator decorator. The global
// ValidationPipe (src/main.ts) runs with `whitelist: true`, which STRIPS
// any undecorated field from the incoming body before it reaches the
// controller/service. These DTOs replace plain inline object types that
// were previously invisible to both the ValidationPipe and the Swagger
// CLI plugin (which can only read decorated classes, never interfaces or
// inline object-literal types) — documentation-only conversion, same
// field names/types/optionality as before.

export class SelfDeclarePropertyDto {
  @IsOptional()
  @IsString()
  tenure?: string;

  @IsOptional()
  @IsString()
  propertyType?: string;
}

export class LandRegistryCheckDto {
  // `messageId` lets the caller pin a specific test stub scenario
  // (eoov-fm-1 etc.) when running against the BG test environment. The
  // whole body is optional — an empty/omitted body is the normal case in
  // production.
  @IsOptional()
  @IsString()
  messageId?: string;
}

export class LogSearchDto {
  // Guest dedup key — authenticated users are detected from the JWT
  // instead, so this is only read when no/invalid Authorization header
  // is present.
  @IsOptional()
  @IsString()
  sessionId?: string;
}

export class RegisterInterestDto {
  @IsString()
  interestLevel: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  userEmail?: string;
}

export class TapOwnerDto {
  @IsString()
  message: string;

  @IsOptional()
  @IsBoolean()
  sharePhone?: boolean;
}

// "Watch this property" toggles — keys match the WatchPropertyDrawer.vue
// toggle keys 1:1, all independently optional (partial updates).
export class UpsertPropertyWatchDto {
  @IsOptional()
  @IsBoolean()
  claimed?: boolean;

  @IsOptional()
  @IsBoolean()
  progress?: boolean;

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @IsOptional()
  @IsBoolean()
  comparables?: boolean;

  @IsOptional()
  @IsBoolean()
  homescore?: boolean;
}

export class SubmitKycDto {
  @IsIn(['photo-id', 'mortgage', 'open-banking'])
  method: 'photo-id' | 'mortgage' | 'open-banking';
}

// Mirrors PropertyService.saveHomeScore's `data` parameter shape exactly
// (property.service.ts) — the controller previously typed this `any`,
// so Swagger had nothing to introspect. `answers` is a free-form
// question-id → answer-string map (HomeScore question flow), not a
// fixed set of keys, hence IsObject rather than a nested DTO.
export class SaveHomeScoreDto {
  @IsNumber()
  total: number;

  @IsString()
  rating: string;

  @IsObject()
  answers: Record<string, string>;

  // V1 pillar scores
  @IsOptional()
  @IsNumber()
  heating?: number;

  @IsOptional()
  @IsNumber()
  structure?: number;

  @IsOptional()
  @IsNumber()
  efficiency?: number;

  @IsOptional()
  @IsNumber()
  electrics?: number;

  @IsOptional()
  @IsNumber()
  plumbing?: number;

  // V2 fields
  @IsOptional()
  @IsString()
  tier?: string;

  @IsOptional()
  @IsNumber()
  baseBill?: number;

  @IsOptional()
  @IsNumber()
  adjustedBill?: number;

  @IsOptional()
  @IsNumber()
  actualBill?: number;

  @IsOptional()
  @IsNumber()
  costPerSqm?: number;

  @IsOptional()
  @IsNumber()
  neighbourMedian?: number;

  @IsOptional()
  @IsNumber()
  billDifference?: number;

  @IsOptional()
  @IsNumber()
  costEfficiency?: number;

  @IsOptional()
  @IsNumber()
  insulation?: number;

  @IsOptional()
  @IsNumber()
  heatingV2?: number;

  @IsOptional()
  @IsNumber()
  controls?: number;

  @IsOptional()
  @IsNumber()
  ventilation?: number;

  @IsOptional()
  @IsNumber()
  lighting?: number;

  @IsOptional()
  @IsNumber()
  renewableBonus?: number;
}
