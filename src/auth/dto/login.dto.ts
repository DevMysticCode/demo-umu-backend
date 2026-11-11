import { IsEmail, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ description: 'Registered account email address.' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Account password.' })
  @IsString()
  @MaxLength(128)
  password: string;
}
