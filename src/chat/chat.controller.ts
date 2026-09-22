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
import { Throttle } from '@nestjs/throttler';
import { ChatService, ChatMessage } from './chat.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

class ChatDto {
  @IsString()
  message: string;

  @IsOptional()
  @IsArray()
  chatHistory?: ChatMessage[];
}

// JWT-gated but was relying solely on the 300 req/min/IP global default —
// each call is a paid Groq LLM invocation, so up to 300 calls/min was
// possible from a single token before the guard tripped (security review
// 2026-09-22, M8).
const LLM_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private chatService: ChatService) {}

  @Throttle(LLM_THROTTLE)
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
