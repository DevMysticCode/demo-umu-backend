import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
  Optional,
  Headers,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CaptureService } from './capture.service';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt.guard';

class CaptureContactDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() contact?: string;
  @IsOptional() @IsBoolean() consentToContact?: boolean;
}

class CaptureEventDto {
  @IsIn(['grant_check', 'match_request', 'early_access'])
  type!: 'grant_check' | 'match_request' | 'early_access';

  @IsString()
  source!: string;

  @IsOptional() @IsUUID() propertyId?: string;
  @IsOptional() @IsString() postcode?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CaptureContactDto)
  contact?: CaptureContactDto;

  @IsObject()
  data!: Record<string, unknown>;
}

/**
 * POST /capture/event
 *
 * Public (JWT optional). Fires from the installer / marketplace
 * flow. Because grant checks happen BEFORE the user gives contact
 * details, this can't be auth-required — but if a JWT is present we
 * link the event to the user for later reconciliation with their
 * profile / match requests.
 *
 * @SkipThrottle here because a user filling the 3-question grant
 * eligibility form fires 1 request per answer — the default bucket
 * would trip if they backtracked and re-answered.
 */
@Controller('capture')
export class CaptureController {
  constructor(private capture: CaptureService) {}

  @SkipThrottle()
  @UseGuards(OptionalJwtAuthGuard)
  @Post('event')
  async record(@Req() req: any, @Body() dto: CaptureEventDto) {
    return this.capture.record(req.user?.id ?? null, dto);
  }
}
