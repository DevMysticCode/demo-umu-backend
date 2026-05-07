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
import { KycService } from './kyc.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import type { Request as ExpressRequest } from 'express';

@Controller('kyc')
export class KycController {
  constructor(private kycService: KycService) {}

  /**
   * Start (or resume) a KYC inquiry for the logged-in user. Returns the
   * Persona inquiry id and the hosted-flow URL the frontend should open.
   * If the user is already approved, returns { alreadyVerified: true }.
   */
  @Post('start')
  @UseGuards(JwtAuthGuard)
  async start(@Request() req: any) {
    return this.kycService.startInquiry(req.user.id);
  }

  /**
   * Polled by the frontend to check whether KYC has settled. Returns
   * { status: 'approved' | 'declined' | 'pending' | 'needs_review' | 'not_started' }.
   */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  async status(@Request() req: any) {
    return this.kycService.getStatus(req.user.id);
  }

  /**
   * Persona webhook receiver. Public, but every request is HMAC-verified
   * against PERSONA_WEBHOOK_SECRET before any state is touched.
   */
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
