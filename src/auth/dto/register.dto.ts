import {
  IsEmail,
  IsString,
  MinLength,
  IsOptional,
  IsDateString,
  IsIn,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsOptional()
  @IsString()
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
