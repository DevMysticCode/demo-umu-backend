import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Short-lived reset token returned by /auth/verify-reset-otp.' })
  @IsString()
  resetToken: string;

  @ApiProperty({ description: 'New account password, 8-128 characters.', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}
