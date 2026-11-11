import { IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// NOTE: every field below MUST carry a validator decorator. The global
// ValidationPipe (src/main.ts) runs with `whitelist: true`, which STRIPS
// any undecorated field from the incoming body before it reaches the
// controller/service. These DTOs replace plain inline object types that
// were previously invisible to both the ValidationPipe and the Swagger
// CLI plugin (which can only read decorated classes, never interfaces or
// inline object-literal types) — documentation-only conversion, same
// field names/types/optionality as before.

export class SelfDeclarePropertyDto {
  @ApiPropertyOptional({ description: 'Tenure to set, only applied if the field is currently null (never overwrites EPC/OS-sourced data).' })
  @IsOptional()
  @IsString()
  tenure?: string;

  @ApiPropertyOptional({ description: 'Property type to set, only applied if the field is currently null (never overwrites EPC/OS-sourced data).' })
  @IsOptional()
  @IsString()
  propertyType?: string;
}

export class LandRegistryCheckDto {
  // `messageId` lets the caller pin a specific test stub scenario
  // (eoov-fm-1 etc.) when running against the BG test environment. The
  // whole body is optional — an empty/omitted body is the normal case in
  // production.
  @ApiPropertyOptional({ description: 'Pins a specific HM Land Registry test-stub scenario when running against the BG test environment. Omit in production.' })
  @IsOptional()
  @IsString()
  messageId?: string;
}

export class LogSearchDto {
  // Guest dedup key — authenticated users are detected from the JWT
  // instead, so this is only read when no/invalid Authorization header
  // is present.
  @ApiPropertyOptional({ description: 'Guest dedup key, used only when the caller has no valid Authorization header (authenticated users are deduped from their JWT instead).' })
  @IsOptional()
  @IsString()
  sessionId?: string;
}

export class RegisterInterestDto {
  @ApiProperty({ description: "The caller's level of interest in the property." })
  @IsString()
  interestLevel: string;

  @ApiPropertyOptional({ description: "Caller's name, for the owner to see." })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: "Caller's email address, for the owner to follow up." })
  @IsOptional()
  @IsString()
  userEmail?: string;
}

export class TapOwnerDto {
  @ApiProperty({ description: 'Message to send to the property owner.' })
  @IsString()
  message: string;

  @ApiPropertyOptional({ description: "Whether to share the caller's phone number with the owner." })
  @IsOptional()
  @IsBoolean()
  sharePhone?: boolean;
}

// "Watch this property" toggles — keys match the WatchPropertyDrawer.vue
// toggle keys 1:1, all independently optional (partial updates).
export class UpsertPropertyWatchDto {
  @ApiPropertyOptional({ description: 'Notify when this property is claimed.' })
  @IsOptional()
  @IsBoolean()
  claimed?: boolean;

  @ApiPropertyOptional({ description: "Notify on the owner's passport progress." })
  @IsOptional()
  @IsBoolean()
  progress?: boolean;

  @ApiPropertyOptional({ description: 'Notify when the passport is published.' })
  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @ApiPropertyOptional({ description: 'Notify when new comparable properties are found.' })
  @IsOptional()
  @IsBoolean()
  comparables?: boolean;

  @ApiPropertyOptional({ description: 'Notify when a HomeScore result is available.' })
  @IsOptional()
  @IsBoolean()
  homescore?: boolean;
}

export class SubmitKycDto {
  @ApiProperty({ description: 'Which KYC verification method the caller is submitting.', enum: ['photo-id', 'mortgage', 'open-banking'] })
  @IsIn(['photo-id', 'mortgage', 'open-banking'])
  method: 'photo-id' | 'mortgage' | 'open-banking';
}

// Mirrors PropertyService.saveHomeScore's `data` parameter shape exactly
// (property.service.ts) — the controller previously typed this `any`,
// so Swagger had nothing to introspect. `answers` is a free-form
// question-id → answer-string map (HomeScore question flow), not a
// fixed set of keys, hence IsObject rather than a nested DTO.
export class SaveHomeScoreDto {
  @ApiProperty({ description: 'Overall HomeScore total.' })
  @IsNumber()
  total: number;

  @ApiProperty({ description: 'Overall HomeScore rating band (e.g. A-G).' })
  @IsString()
  rating: string;

  @ApiProperty({ description: 'Free-form map of HomeScore question id to the answer given.', type: 'object', additionalProperties: { type: 'string' } })
  @IsObject()
  answers: Record<string, string>;

  // V1 pillar scores
  @ApiPropertyOptional({ description: 'V1 pillar score: heating.' })
  @IsOptional()
  @IsNumber()
  heating?: number;

  @ApiPropertyOptional({ description: 'V1 pillar score: structure.' })
  @IsOptional()
  @IsNumber()
  structure?: number;

  @ApiPropertyOptional({ description: 'V1 pillar score: efficiency.' })
  @IsOptional()
  @IsNumber()
  efficiency?: number;

  @ApiPropertyOptional({ description: 'V1 pillar score: electrics.' })
  @IsOptional()
  @IsNumber()
  electrics?: number;

  @ApiPropertyOptional({ description: 'V1 pillar score: plumbing.' })
  @IsOptional()
  @IsNumber()
  plumbing?: number;

  // V2 fields
  @ApiPropertyOptional({ description: 'V2 cost tier label.' })
  @IsOptional()
  @IsString()
  tier?: string;

  @ApiPropertyOptional({ description: 'V2: baseline estimated annual energy bill before adjustments.' })
  @IsOptional()
  @IsNumber()
  baseBill?: number;

  @ApiPropertyOptional({ description: 'V2: estimated annual bill after adjustments for the specific property.' })
  @IsOptional()
  @IsNumber()
  adjustedBill?: number;

  @ApiPropertyOptional({ description: "V2: the user's actual reported annual bill, if provided." })
  @IsOptional()
  @IsNumber()
  actualBill?: number;

  @ApiPropertyOptional({ description: 'V2: cost per square metre.' })
  @IsOptional()
  @IsNumber()
  costPerSqm?: number;

  @ApiPropertyOptional({ description: 'V2: median bill among comparable neighbouring properties.' })
  @IsOptional()
  @IsNumber()
  neighbourMedian?: number;

  @ApiPropertyOptional({ description: 'V2: difference between this property\'s bill and the neighbour median.' })
  @IsOptional()
  @IsNumber()
  billDifference?: number;

  @ApiPropertyOptional({ description: 'V2 pillar score: cost efficiency.' })
  @IsOptional()
  @IsNumber()
  costEfficiency?: number;

  @ApiPropertyOptional({ description: 'V2 pillar score: insulation.' })
  @IsOptional()
  @IsNumber()
  insulation?: number;

  @ApiPropertyOptional({ description: 'V2 pillar score: heating (V2 methodology).' })
  @IsOptional()
  @IsNumber()
  heatingV2?: number;

  @ApiPropertyOptional({ description: 'V2 pillar score: heating controls.' })
  @IsOptional()
  @IsNumber()
  controls?: number;

  @ApiPropertyOptional({ description: 'V2 pillar score: ventilation.' })
  @IsOptional()
  @IsNumber()
  ventilation?: number;

  @ApiPropertyOptional({ description: 'V2 pillar score: lighting.' })
  @IsOptional()
  @IsNumber()
  lighting?: number;

  @ApiPropertyOptional({ description: 'V2: bonus score applied for renewable energy sources present.' })
  @IsOptional()
  @IsNumber()
  renewableBonus?: number;
}
