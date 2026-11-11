import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({ description: 'Email address of the account to send a password-reset OTP to.' })
  @IsEmail()
  email: string;
}
