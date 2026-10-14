import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsDateString,
  IsIn,
  Matches,
} from 'class-validator';

// No CR/LF or other control characters - these values flow into several
// outbound email subject lines (collaborator-invite/share notifications),
// so an unrestricted string let a profile name attempt header injection
// into emails sent under the UMovingU brand (security review, 14 Oct
// 2026).
const NO_CONTROL_CHARS = /^[^\x00-\x1F\x7F]*$/;
const NAME_FIELD_MESSAGE = 'must not contain control characters';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @IsString()
  @Matches(NO_CONTROL_CHARS, { message: NAME_FIELD_MESSAGE })
  firstName: string;

  @IsOptional()
  @IsString()
  @Matches(NO_CONTROL_CHARS, { message: NAME_FIELD_MESSAGE })
  lastName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: 'phone must be in E.164 format, e.g. +447911123456',
  })
  phone?: string;

  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsOptional()
  @IsString()
  postcode?: string;

  @IsOptional()
  @IsIn(['male', 'female', 'other'])
  gender?: string;
}
