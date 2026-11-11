import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendMessageDto {
  @ApiProperty({ description: 'The message text to send.', minLength: 1, maxLength: 4000 })
  @IsString()
  @Length(1, 4000)
  body!: string;
}
