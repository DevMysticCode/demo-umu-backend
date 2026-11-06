import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('payment')
export class PaymentController {
  constructor(private paymentService: PaymentService) {}

  /**
   * Create a Stripe PaymentIntent for a passport buyer-unlock.
   *
   * Body: { passportId: string }
   *
   * Returns: { clientSecret, paymentId }. The frontend uses clientSecret
   * with stripe.confirmCardPayment(); paymentId is informational (not
   * used for unlock — the link is reconstructed server-side via
   * Stripe metadata).
   *
   * Tighter throttle than the default 60/min — even a paying user
   * should never need to mint more than a handful of intents per
   * minute (drawer-reopen reuses the pending intent). 10/min/IP
   * is generous enough for genuine retries but rejects scripted
   * intent-spam, which would otherwise hit our Stripe rate limits
   * and rack up logged-event noise.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('create-intent')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiBody({
    schema: {
      type: 'object',
      required: ['passportId'],
      properties: {
        passportId: { type: 'string' },
      },
    },
  })
  @ApiOperation({ summary: 'Create a payment intent to unlock a passport', description: 'Creates (or reuses a still-valid pending) Stripe PaymentIntent for a buyer unlocking a published passport. Throttled to 10/min/IP. The frontend confirms payment client-side with the returned clientSecret.' })
  @ApiResponse({ status: 201, description: 'Stripe client secret and payment ID.', schema: { type: 'object', properties: { clientSecret: { type: 'string' }, paymentId: { type: 'string' } } } })
  createIntent(
    @Req() req: any,
    @Body('passportId') passportId?: string,
  ) {
    if (!passportId || typeof passportId !== 'string') {
      throw new BadRequestException('passportId is required');
    }
    return this.paymentService.createPassportPaymentIntent(req.user.id, passportId);
  }

  /**
   * Create a Stripe PaymentIntent for an owner-claim charge (KYC+HMLR or
   * HMLR-only, depending on whether the user already had approved KYC
   * before this claim — see PaymentService pricing constants).
   *
   * Body: { passportId: string } — the PENDING_PAYMENT passport that
   * PassportService.createPassport already created for this claim.
   *
   * Returns: { clientSecret, paymentId, amount }.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('create-claim-intent')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiBody({
    schema: {
      type: 'object',
      required: ['passportId'],
      properties: {
        passportId: { type: 'string' },
      },
    },
  })
  @ApiOperation({ summary: 'Create a payment intent for an owner-claim charge', description: 'Creates a Stripe PaymentIntent for claiming property ownership (covers HM Land Registry verification, plus KYC if not already approved) against a PENDING_PAYMENT passport. Throttled to 10/min/IP.' })
  @ApiResponse({ status: 201, description: 'Stripe client secret, payment ID and charged amount.', schema: { type: 'object', properties: { clientSecret: { type: 'string' }, paymentId: { type: 'string' }, amount: { type: 'number' } } } })
  createClaimIntent(
    @Req() req: any,
    @Body('passportId') passportId?: string,
  ) {
    if (!passportId || typeof passportId !== 'string') {
      throw new BadRequestException('passportId is required');
    }
    return this.paymentService.createOwnerClaimPaymentIntent(req.user.id, passportId);
  }

  /**
   * Stripe webhook. Public (no JWT) — auth is performed by HMAC-verifying
   * the body against STRIPE_WEBHOOK_SECRET inside the service.
   *
   * @SkipThrottle so Stripe's retry storms during a partial outage aren't
   * rate-limited away.
   *
   * Configure Stripe → Webhooks → Endpoint URL = `<API>/payment/webhook`.
   * Events to subscribe: payment_intent.succeeded,
   * payment_intent.payment_failed, payment_intent.canceled,
   * charge.refunded.
   */
  @ApiOperation({ summary: 'Stripe webhook receiver', description: "Public endpoint (no JWT) — Stripe calls this directly. Authenticity is verified by checking the Stripe-Signature header's HMAC against STRIPE_WEBHOOK_SECRET on the raw request body. Handles payment_intent.succeeded/payment_failed/canceled and charge.refunded." })
  @ApiHeader({ name: 'stripe-signature', description: "Stripe's webhook HMAC signature" })
  @ApiResponse({ status: 200, description: 'Acknowledgement (always 200 so Stripe does not retry handled events).', schema: { type: 'object', properties: { received: { type: 'boolean' } } } })
  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('stripe-signature') signature: string,
  ) {
    // main.ts boots Nest with `rawBody: true` so the raw bytes are
    // available here without disabling the JSON body parser globally.
    if (!req.rawBody) {
      throw new BadRequestException('Raw body unavailable - check main.ts setup');
    }
    return this.paymentService.handleWebhook(req.rawBody, signature);
  }
}
