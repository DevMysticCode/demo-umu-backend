import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
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

export class CreateAddressDto {
  label: string;
  line1: string;
  line2?: string;
  city?: string;
  county?: string;
  postcode: string;
  isCurrent?: boolean;
}

export class UpdateAddressDto {
  label?: string;
  line1?: string;
  line2?: string;
  city?: string;
  county?: string;
  postcode?: string;
  isCurrent?: boolean;
}

export class CreateCompanyDto {
  name: string;
  address?: string;
  companyNumber?: string;
  director?: string;
}

export class UpdateCompanyDto {
  name?: string;
  address?: string;
  companyNumber?: string;
  director?: string;
}

export class CreateSolicitorDto {
  name: string;
  address?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  reference?: string;
}

export class UpdateSolicitorDto {
  name?: string;
  address?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  reference?: string;
}

export class AddCollaboratorDto {
  collaboratorId: string;
  role?: string;
  permission?: string;
  propertyIds?: string[];
  accessDuration?: string;
  expiresAt?: string;
  clientAccess?: string;
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
