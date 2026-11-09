import { Controller, Post, Body } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { SupportService, CreateSupportRequestDto } from './support.service';

@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  // Unauthenticated by design (public contact form), but was riding the
  // generic 300/min/IP default - enough to flood the SupportRequest table
  // from one IP. Tightened, not matched to AUTH_THROTTLE's 5/min since a
  // real visitor filling out the form multiple times shouldn't be blocked
  // (security review, 13 Oct 2026).
  @ApiOperation({ summary: 'Submit a support request', description: 'Public contact form - no authentication required. Rate-limited to 10 requests per minute per IP. Generates a human-readable ticket number and stores the request.' })
  @ApiResponse({ status: 201, description: 'The created support request.', schema: { type: 'object', properties: { id: { type: 'string' }, ticketNumber: { type: 'string', example: 'SUP-LXK3F9' }, name: { type: 'string' }, email: { type: 'string' }, subject: { type: 'string' }, message: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } } } })
  @ApiBody({ schema: { type: 'object', required: ['name', 'email', 'subject', 'message'], properties: {
    name: { type: 'string' }, email: { type: 'string', format: 'email' }, subject: { type: 'string' }, message: { type: 'string' },
  } } })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('request')
  async createRequest(@Body() dto: CreateSupportRequestDto) {
    return this.supportService.createRequest(dto);
  }
}
