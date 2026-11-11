import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestOtpDto {
  @ApiProperty({ description: 'Email address to send the one-time passcode to.' })
  @IsEmail()
  email: string;
}
