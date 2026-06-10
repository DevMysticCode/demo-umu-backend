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
import { SkipThrottle } from '@nestjs/throttler';
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
   */
  @Post('create-intent')
  @UseGuards(JwtAuthGuard)
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
      throw new BadRequestException('Raw body unavailable — check main.ts setup');
    }
    return this.paymentService.handleWebhook(req.rawBody, signature);
  }
}
