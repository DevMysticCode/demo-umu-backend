import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CheckEmailDto {
  @ApiProperty({ description: 'Email address to check for an existing account.' })
  @IsString()
  email: string;
}
