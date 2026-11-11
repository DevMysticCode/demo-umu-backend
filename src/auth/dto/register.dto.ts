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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// No CR/LF or other control characters - these values flow into several
// outbound email subject lines (collaborator-invite/share notifications),
// so an unrestricted string let a profile name attempt header injection
// into emails sent under the UMovingU brand (security review, 14 Oct
// 2026).
const NO_CONTROL_CHARS = /^[^\x00-\x1F\x7F]*$/;
const NAME_FIELD_MESSAGE = 'must not contain control characters';

export class RegisterDto {
  @ApiProperty({ description: 'Email address to register the account under. Must be unique.' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Account password, 8-128 characters.', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiProperty({ description: "User's first name. No control characters allowed." })
  @IsString()
  @Matches(NO_CONTROL_CHARS, { message: NAME_FIELD_MESSAGE })
  firstName: string;

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

  @ApiPropertyOptional({ description: 'Date of birth, ISO 8601 date string.', example: '1990-05-14' })
  @IsOptional()
  @IsDateString()
  dob?: string;

  @ApiPropertyOptional({ description: "User's UK postcode." })
  @IsOptional()
  @IsString()
  postcode?: string;

  @ApiPropertyOptional({ description: "User's self-identified gender, used for profile personalisation only.", enum: ['male', 'female', 'other'] })
  @IsOptional()
  @IsIn(['male', 'female', 'other'])
  gender?: string;
}
