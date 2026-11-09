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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';

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

  @ApiOperation({ summary: 'Send a message to the AI assistant', description: "Sends a message (with optional prior chat history) to the Groq Llama 3.3 70B assistant, which has tool access to the caller's own passport status, missing documents and HomeScore. Throttled to 20/min since each call is a paid LLM invocation." })
  @ApiBody({ schema: { type: 'object', required: ['message'], properties: {
    message: { type: 'string' },
    chatHistory: { type: 'array', nullable: true, description: 'Prior turns in this conversation, oldest first', items: { type: 'object', properties: { role: { type: 'string', enum: ['user', 'assistant'] }, content: { type: 'string' } } } },
  } } })
  @ApiResponse({ status: 201, description: "The assistant's reply.", schema: { type: 'object', properties: { reply: { type: 'string' } } } })
  @Throttle(LLM_THROTTLE)
  @Post()
  @ApiBearerAuth('access-token')
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
