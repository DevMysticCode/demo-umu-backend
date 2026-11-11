import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// No CR/LF or other control characters - these values flow into several
// outbound email subject lines (collaborator-invite/share notifications),
// so an unrestricted string let a profile name attempt header injection
// into emails sent under the UMovingU brand (security review, 14 Oct
// 2026).
const NO_CONTROL_CHARS = /^[^\x00-\x1F\x7F]*$/;
const NAME_FIELD_MESSAGE = 'must not contain control characters';

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: "User's first name. No control characters allowed." })
  @IsOptional()
  @IsString()
  @Matches(NO_CONTROL_CHARS, { message: NAME_FIELD_MESSAGE })
  firstName?: string;

  @ApiPropertyOptional({ description: "User's last name. No control characters allowed." })
  @IsOptional()
  @IsString()
  @Matches(NO_CONTROL_CHARS, { message: NAME_FIELD_MESSAGE })
  lastName?: string;

  @ApiPropertyOptional({ description: 'Phone number in E.164 format, e.g. +447911123456.', example: '+447911123456' })
  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: 'phone must be in E.164 format, e.g. +447911123456',
  })
  phone?: string;

  @ApiPropertyOptional({ description: "Whether the user's contact details are visible to others (e.g. collaborators)." })
  @IsOptional()
  contactVisible?: boolean;

  @ApiPropertyOptional({ description: 'Whether push notifications are enabled for this user.' })
  @IsOptional()
  pushNotifications?: boolean;

  @ApiPropertyOptional({ description: 'Whether the user is opted into marketing email newsletters.' })
  @IsOptional()
  emailNewsletter?: boolean;

  @ApiPropertyOptional({ description: 'Whether SMS notifications are enabled for this user.' })
  @IsOptional()
  smsNotifications?: boolean;

  // Single-postcode "home base" used by getForYou() to source For You
  // matches — distinct from UserAddress (multiple labelled addresses,
  // never read by that endpoint). No dedicated editor existed for this
  // field anywhere in the app before the For You empty-state's "Set
  // postcode" button; that button now writes here via PATCH /profile/me.
  @ApiPropertyOptional({ description: "The user's \"home base\" postcode, used to source For You property matches. Separate from the labelled addresses in /profile/address." })
  @IsOptional()
  @IsString()
  postcode?: string;
}

// NOTE: every field below MUST carry a validator decorator. The
// global ValidationPipe (src/main.ts:95) runs with `whitelist: true`
// which STRIPS undecorated fields from the incoming body — leaving
// the service with an empty object and Prisma throwing "Invalid data
// supplied" a moment later. This was the bug seen when adding a
// collaborator; all six DTOs below hit the same trap because they
// were all originally plain TypeScript interfaces.

export class CreateAddressDto {
  @ApiProperty({ description: 'Label for this address (e.g. "Home", "Work").' })
  @IsString() label!: string;
  @ApiProperty({ description: 'First line of the address.' })
  @IsString() line1!: string;
  @ApiPropertyOptional({ description: 'Second line of the address.' })
  @IsOptional() @IsString() line2?: string;
  @ApiPropertyOptional({ description: 'City or town.' })
  @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional({ description: 'County.' })
  @IsOptional() @IsString() county?: string;
  @ApiProperty({ description: 'UK postcode.' })
  @IsString() postcode!: string;
  @ApiPropertyOptional({ description: "Whether this is the user's current address." })
  @IsOptional() @IsBoolean() isCurrent?: boolean;
}

export class UpdateAddressDto {
  @ApiPropertyOptional({ description: 'Label for this address (e.g. "Home", "Work").' })
  @IsOptional() @IsString() label?: string;
  @ApiPropertyOptional({ description: 'First line of the address.' })
  @IsOptional() @IsString() line1?: string;
  @ApiPropertyOptional({ description: 'Second line of the address.' })
  @IsOptional() @IsString() line2?: string;
  @ApiPropertyOptional({ description: 'City or town.' })
  @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional({ description: 'County.' })
  @IsOptional() @IsString() county?: string;
  @ApiPropertyOptional({ description: 'UK postcode.' })
  @IsOptional() @IsString() postcode?: string;
  @ApiPropertyOptional({ description: "Whether this is the user's current address." })
  @IsOptional() @IsBoolean() isCurrent?: boolean;
}

export class CreateCompanyDto {
  @ApiProperty({ description: 'Company name.' })
  @IsString() name!: string;
  @ApiPropertyOptional({ description: 'Registered company address.' })
  @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional({ description: 'UK company registration number.' })
  @IsOptional() @IsString() companyNumber?: string;
  @ApiPropertyOptional({ description: 'Name of a company director.' })
  @IsOptional() @IsString() director?: string;
}

export class UpdateCompanyDto {
  @ApiPropertyOptional({ description: 'Company name.' })
  @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional({ description: 'Registered company address.' })
  @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional({ description: 'UK company registration number.' })
  @IsOptional() @IsString() companyNumber?: string;
  @ApiPropertyOptional({ description: 'Name of a company director.' })
  @IsOptional() @IsString() director?: string;
}

export class CreateSolicitorDto {
  @ApiProperty({ description: "Solicitor firm's name." })
  @IsString() name!: string;
  @ApiPropertyOptional({ description: "Solicitor firm's address." })
  @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional({ description: 'Name of the contact at the firm.' })
  @IsOptional() @IsString() contactName?: string;
  @ApiPropertyOptional({ description: 'Contact email address.' })
  @IsOptional() @IsString() email?: string;
  @ApiPropertyOptional({ description: 'Contact phone number.' })
  @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional({ description: 'Internal/matter reference number.' })
  @IsOptional() @IsString() reference?: string;
}

export class UpdateSolicitorDto {
  @ApiPropertyOptional({ description: "Solicitor firm's name." })
  @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional({ description: "Solicitor firm's address." })
  @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional({ description: 'Name of the contact at the firm.' })
  @IsOptional() @IsString() contactName?: string;
  @ApiPropertyOptional({ description: 'Contact email address.' })
  @IsOptional() @IsString() email?: string;
  @ApiPropertyOptional({ description: 'Contact phone number.' })
  @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional({ description: 'Internal/matter reference number.' })
  @IsOptional() @IsString() reference?: string;
}

export class AddCollaboratorDto {
  // Fields must carry validator decorators; the global ValidationPipe
  // runs with `whitelist: true`, which STRIPS every property that has
  // no decorator. Before this fix, addCollaborator received an empty
  // {} because none of these were annotated — Prisma then threw
  // "Invalid data supplied" on findUnique({ id: undefined }). See
  // src/main.ts:95 for the pipe config.
  @ApiProperty({ description: 'User ID of the collaborator to add.' })
  @IsString()
  collaboratorId!: string;

  @ApiPropertyOptional({ description: 'Relationship of the collaborator to this user.', enum: ['solicitor', 'agent', 'partner', 'family', 'other'] })
  @IsOptional()
  @IsString()
  @IsIn(['solicitor', 'agent', 'partner', 'family', 'other'])
  role?: string;

  @ApiPropertyOptional({ description: 'Whether the collaborator can see all properties or only specific ones (see propertyIds).', enum: ['all', 'specific'] })
  @IsOptional()
  @IsString()
  @IsIn(['all', 'specific'])
  permission?: string;

  @ApiPropertyOptional({ description: 'Property IDs the collaborator is scoped to when permission is "specific".', type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID(4, { each: true })
  propertyIds?: string[];

  @ApiPropertyOptional({ description: "Whether the collaborator's access is permanent or time-limited (see expiresAt).", enum: ['permanent', 'timed'] })
  @IsOptional()
  @IsString()
  @IsIn(['permanent', 'timed'])
  accessDuration?: string;

  @ApiPropertyOptional({ description: 'ISO date/time the collaborator\'s access expires, when accessDuration is "timed".' })
  @IsOptional()
  @IsString()
  expiresAt?: string;

  @ApiPropertyOptional({ description: "Whether this user's access to the collaborator is shared with other collaborators or exclusive to them.", enum: ['shared', 'exclusive'] })
  @IsOptional()
  @IsString()
  @IsIn(['shared', 'exclusive'])
  clientAccess?: string;

  @ApiPropertyOptional({ description: 'Whether the collaborator is allowed to send communications on this user\'s behalf.' })
  @IsOptional()
  @IsBoolean()
  allowComms?: boolean;
}

export class UpsertPreferencesDto {
  @ApiPropertyOptional({ description: "Buyer's stated purpose(s) for using the app." })
  @IsOptional()
  purpose?: any;

  @ApiPropertyOptional({ description: 'How soon the buyer intends to purchase.' })
  @IsOptional()
  @IsString()
  buyingTimeline?: string;

  @ApiPropertyOptional({ description: "Lower bound of the buyer's budget, in pounds." })
  @IsOptional()
  @IsNumber()
  budgetMin?: number;

  @ApiPropertyOptional({ description: "Upper bound of the buyer's budget, in pounds." })
  @IsOptional()
  @IsNumber()
  budgetMax?: number;

  @ApiPropertyOptional({ description: 'Property types the buyer is interested in.', type: [String] })
  @IsOptional()
  @IsArray()
  propertyTypes?: string[];

  @ApiPropertyOptional({ description: 'Property styles the buyer is interested in.', type: [String] })
  @IsOptional()
  @IsArray()
  propertyStyles?: string[];

  @ApiPropertyOptional({ description: 'Features the buyer considers important.', type: [String] })
  @IsOptional()
  @IsArray()
  importantFeatures?: string[];

  @ApiPropertyOptional({ description: 'How soon the seller intends to sell.' })
  @IsOptional()
  @IsString()
  sellingTimeline?: string;

  @ApiPropertyOptional({ description: "The seller's estimated property value, in pounds." })
  @IsOptional()
  @IsNumber()
  propertyValue?: number;
}

export class UpsertInterestDto {
  @ApiProperty({ description: 'IDs of the interest categories the user has selected.', type: [String] })
  @IsArray()
  @IsString({ each: true })
  interestIds: string[];

  @ApiProperty({ description: 'Geographic areas the user is interested in.', type: [String] })
  @IsArray()
  @IsString({ each: true })
  areas: string[];

  @ApiProperty({ description: 'Whether the user is opted into email updates about these interests.' })
  @IsBoolean()
  emailOptIn: boolean;
}
