import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  HttpException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { ChatService, ChatMessage } from './chat.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

class ChatDto {
  @IsString()
  message: string;

  @IsOptional()
  @IsArray()
  chatHistory?: ChatMessage[];
}

@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private chatService: ChatService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async chat(@Request() req, @Body() dto: ChatDto) {
    try {
      return await this.chatService.chat(req.user.id, dto.message, dto.chatHistory);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      this.logger.error(
        `Unhandled chat error: ${err?.message ?? String(err)}`,
        err?.stack,
      );
      throw new InternalServerErrorException(
        err?.message ?? 'Chat failed',
      );
    }
  }
}
