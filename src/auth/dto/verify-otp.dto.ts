import { IsEmail, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyOtpDto {
  @ApiProperty({ description: 'Email address the one-time passcode was sent to.' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: '6-digit one-time passcode received by email.', minLength: 6, maxLength: 6, example: '123456' })
  @IsString()
  @Length(6, 6)
  code: string;
}
