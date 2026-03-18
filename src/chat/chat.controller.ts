import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { ChatService, ChatMessage } from './chat.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

class ChatDto {
  message: string;
  chatHistory?: ChatMessage[];
}

@Controller('chat')
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async chat(@Request() req, @Body() dto: ChatDto) {
    return this.chatService.chat(req.user.id, dto.message, dto.chatHistory);
  }
}
