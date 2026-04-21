import {
  IsEmail,
  IsString,
  MinLength,
  IsOptional,
  IsDateString,
  IsIn,
  Matches,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  firstName: string;

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
  @IsDateString()
  dob?: string;

  @IsOptional()
  @IsString()
  postcode?: string;

  @IsOptional()
  @IsIn(['male', 'female', 'other'])
  gender?: string;
}
