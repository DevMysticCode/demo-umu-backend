import {
  Controller,
  Post,
  Get,
  Headers,
  Req,
  UseGuards,
  Request,
  HttpCode,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { KycService } from './kyc.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import type { Request as ExpressRequest } from 'express';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiHeader, ApiTags } from '@nestjs/swagger';

@Controller('kyc')
@ApiTags('KYC')
export class KycController {
  constructor(private kycService: KycService) {}

  /**
   * Start (or resume) a KYC inquiry for the logged-in user. Returns the
   * Persona inquiry id and the hosted-flow URL the frontend should open.
   * If the user is already approved, returns { alreadyVerified: true }.
   */
  @ApiOperation({ summary: 'Start or resume identity verification', description: 'Starts (or resumes) a Persona KYC inquiry for the signed-in user and returns the hosted-flow URL to open. Returns { alreadyVerified: true } if already approved.' })
  @ApiResponse({
    status: 201,
    description: 'If already approved: { status: "approved", alreadyVerified: true, inquiryId }. Otherwise: { status, inquiryId, hostedUrl } for a resumed or newly-created Persona inquiry.',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['approved', 'pending', 'declined', 'needs_review'] },
        alreadyVerified: { type: 'boolean' },
        inquiryId: { type: 'string', nullable: true },
        hostedUrl: { type: 'string', nullable: true, description: 'The hosted Persona flow URL to open, when not already verified' },
      },
    },
  })
  @Post('start')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async start(@Request() req: any) {
    return this.kycService.startInquiry(req.user.id);
  }

  /**
   * Polled by the frontend to check whether KYC has settled. Returns
   * { status: 'approved' | 'declined' | 'pending' | 'needs_review' | 'not_started' }.
   */
  @ApiOperation({ summary: 'Poll KYC verification status', description: "Polled by the frontend to check whether the caller's identity verification has settled." })
  @ApiResponse({ status: 200, description: 'Current status.', schema: { type: 'object', properties: { status: { type: 'string', enum: ['approved', 'declined', 'pending', 'needs_review', 'not_started'] } } } })
  @Get('status')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async status(@Request() req: any) {
    return this.kycService.getStatus(req.user.id);
  }

  /**
   * Persona webhook receiver. Public, but every request is HMAC-verified
   * against PERSONA_WEBHOOK_SECRET before any state is touched.
   *
   * SkipThrottle so webhook retries during an outage / surge aren't
   * rate-limited away. HMAC verification is the real gate here.
   */
  @ApiOperation({ summary: 'Persona KYC webhook receiver', description: 'Public endpoint - Persona calls this directly. Every request is HMAC-verified against PERSONA_WEBHOOK_SECRET before any state is touched.' })
  @ApiHeader({ name: 'persona-signature', description: "Persona's webhook HMAC signature" })
  @ApiResponse({ status: 200, description: 'Acknowledgement.', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } })
  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: ExpressRequest & { rawBody?: Buffer },
    @Headers('persona-signature') signature: string,
  ) {
    // We need the *raw* unparsed body to compute the HMAC. Nest's default
    // body-parser already JSON-parsed it, so we accept either rawBody (set
    // by main.ts) or fall back to a re-stringify for dev.
    const raw = req.rawBody
      ? req.rawBody.toString('utf8')
      : JSON.stringify((req as any).body);
    return this.kycService.handleWebhook(raw, signature);
  }
}
