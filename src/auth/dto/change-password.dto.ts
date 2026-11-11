import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ description: "The user's current password, for verification." })
  @IsString()
  currentPassword: string;

  @ApiProperty({ description: 'The new password to set.' })
  @IsString()
  newPassword: string;
}
