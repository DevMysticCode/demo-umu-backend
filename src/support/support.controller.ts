import { Controller, Post, Body } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SupportService, CreateSupportRequestDto } from './support.service';

@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  // Unauthenticated by design (public contact form), but was riding the
  // generic 300/min/IP default - enough to flood the SupportRequest table
  // from one IP. Tightened, not matched to AUTH_THROTTLE's 5/min since a
  // real visitor filling out the form multiple times shouldn't be blocked
  // (security review, 13 Oct 2026).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('request')
  async createRequest(@Body() dto: CreateSupportRequestDto) {
    return this.supportService.createRequest(dto);
  }
}
