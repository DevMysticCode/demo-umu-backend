import { Controller, Post, Body } from '@nestjs/common';
import { SupportService, CreateSupportRequestDto } from './support.service';

@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('request')
  async createRequest(@Body() dto: CreateSupportRequestDto) {
    return this.supportService.createRequest(dto);
  }
}
