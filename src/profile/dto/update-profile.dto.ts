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

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: 'phone must be in E.164 format, e.g. +447911123456',
  })
  phone?: string;

  @IsOptional()
  contactVisible?: boolean;

  @IsOptional()
  pushNotifications?: boolean;

  @IsOptional()
  emailNewsletter?: boolean;

  @IsOptional()
  smsNotifications?: boolean;
}

// NOTE: every field below MUST carry a validator decorator. The
// global ValidationPipe (src/main.ts:95) runs with `whitelist: true`
// which STRIPS undecorated fields from the incoming body — leaving
// the service with an empty object and Prisma throwing "Invalid data
// supplied" a moment later. This was the bug seen when adding a
// collaborator; all six DTOs below hit the same trap because they
// were all originally plain TypeScript interfaces.

export class CreateAddressDto {
  @IsString() label!: string;
  @IsString() line1!: string;
  @IsOptional() @IsString() line2?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() county?: string;
  @IsString() postcode!: string;
  @IsOptional() @IsBoolean() isCurrent?: boolean;
}

export class UpdateAddressDto {
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() line1?: string;
  @IsOptional() @IsString() line2?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() county?: string;
  @IsOptional() @IsString() postcode?: string;
  @IsOptional() @IsBoolean() isCurrent?: boolean;
}

export class CreateCompanyDto {
  @IsString() name!: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() companyNumber?: string;
  @IsOptional() @IsString() director?: string;
}

export class UpdateCompanyDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() companyNumber?: string;
  @IsOptional() @IsString() director?: string;
}

export class CreateSolicitorDto {
  @IsString() name!: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() reference?: string;
}

export class UpdateSolicitorDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() reference?: string;
}

export class AddCollaboratorDto {
  // Fields must carry validator decorators; the global ValidationPipe
  // runs with `whitelist: true`, which STRIPS every property that has
  // no decorator. Before this fix, addCollaborator received an empty
  // {} because none of these were annotated — Prisma then threw
  // "Invalid data supplied" on findUnique({ id: undefined }). See
  // src/main.ts:95 for the pipe config.
  @IsString()
  collaboratorId!: string;

  @IsOptional()
  @IsString()
  @IsIn(['solicitor', 'agent', 'partner', 'family', 'other'])
  role?: string;

  @IsOptional()
  @IsString()
  @IsIn(['all', 'specific'])
  permission?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(4, { each: true })
  propertyIds?: string[];

  @IsOptional()
  @IsString()
  @IsIn(['permanent', 'timed'])
  accessDuration?: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  @IsIn(['shared', 'exclusive'])
  clientAccess?: string;

  @IsOptional()
  @IsBoolean()
  allowComms?: boolean;
}

export class UpsertPreferencesDto {
  @IsOptional()
  purpose?: any;

  @IsOptional()
  @IsString()
  buyingTimeline?: string;

  @IsOptional()
  @IsNumber()
  budgetMin?: number;

  @IsOptional()
  @IsNumber()
  budgetMax?: number;

  @IsOptional()
  @IsArray()
  propertyTypes?: string[];

  @IsOptional()
  @IsArray()
  propertyStyles?: string[];

  @IsOptional()
  @IsArray()
  importantFeatures?: string[];

  @IsOptional()
  @IsString()
  sellingTimeline?: string;

  @IsOptional()
  @IsNumber()
  propertyValue?: number;
}
