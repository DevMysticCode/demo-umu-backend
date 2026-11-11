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
import { ApiOperation, ApiResponse, ApiBody, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class CaptureContactDto {
  @ApiPropertyOptional({ description: "Contact's name." })
  @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional({ description: 'Contact detail (email or phone).' })
  @IsOptional() @IsString() contact?: string;
  @ApiPropertyOptional({ description: 'Whether the contact consented to being contacted.' })
  @IsOptional() @IsBoolean() consentToContact?: boolean;
}

class CaptureEventDto {
  @ApiProperty({ description: 'Which funnel event this is.', enum: ['grant_check', 'match_request', 'early_access'] })
  @IsIn(['grant_check', 'match_request', 'early_access'])
  type!: 'grant_check' | 'match_request' | 'early_access';

  @ApiProperty({ description: 'Which surface fired this event (e.g. installer widget, marketplace flow).' })
  @IsString()
  source!: string;

  @ApiPropertyOptional({ description: 'Property ID this event relates to, if any.' })
  @IsOptional() @IsUUID() propertyId?: string;
  @ApiPropertyOptional({ description: 'Postcode this event relates to, if any.' })
  @IsOptional() @IsString() postcode?: string;

  @ApiPropertyOptional({ description: "The contact's details, if captured as part of this event." })
  @IsOptional()
  @ValidateNested()
  @Type(() => CaptureContactDto)
  contact?: CaptureContactDto;

  @ApiProperty({ description: 'Free-form event-specific payload (shape depends on type).', type: 'object', additionalProperties: true })
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

  @ApiOperation({ summary: 'Record an analytics capture event', description: "Public — JWT is optional (OptionalJwtAuthGuard). Records a grant-eligibility-check, match-request or early-access event from the installer/marketplace intake flow. If a valid token is present the event is linked to that user, otherwise it's recorded anonymously since grant checks happen before contact details are collected." })
  @ApiBody({ schema: { type: 'object', required: ['type', 'source'], properties: {
    type: { type: 'string', enum: ['grant_check', 'match_request', 'early_access'], description: 'Which funnel event this is.' },
    source: { type: 'string', description: 'Which UI surface fired this event' },
    propertyId: { type: 'string', nullable: true, description: 'Property ID this event relates to, if any.' },
    postcode: { type: 'string', nullable: true, description: 'Postcode this event relates to, if any.' },
    contact: { type: 'object', nullable: true, description: 'Only present once contact details have actually been collected', properties: {
      name: { type: 'string', nullable: true }, contact: { type: 'string', nullable: true, description: 'Email or phone' }, consentToContact: { type: 'boolean', nullable: true },
    } },
  } } })
  @ApiResponse({ status: 201, description: 'The created event (narrow projection - just the new id and timestamp).', schema: { type: 'object', properties: { id: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } } } })
  @SkipThrottle()
  @UseGuards(OptionalJwtAuthGuard)
  @Post('event')
  async record(@Req() req: any, @Body() dto: CaptureEventDto) {
    return this.capture.record(req.user?.id ?? null, dto);
  }
}
