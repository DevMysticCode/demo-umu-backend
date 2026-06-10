import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { captureException } from '../common/sentry';

// £99 in pence. Mirrored once so the create-intent + display copy never drift.
export const PASSPORT_UNLOCK_AMOUNT_PENCE = 9900;

@Injectable()
export class PaymentService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(PaymentService.name);

  constructor(private prisma: PrismaService) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    this.stripe = new Stripe(key);
  }

  /**
   * Create a Stripe PaymentIntent for a passport buyer-unlock, persisted
   * as a `PassportPayment` row in status='pending'. The intent's metadata
   * carries the (userId, passportId, paymentId) triple so we can match
   * up the webhook callback later.
   *
   * Refuses if:
   *   - passport doesn't exist (404)
   *   - the requesting user IS the owner (400 — owners don't unlock their own)
   *   - the user already has buyer access for this passport (409)
   *   - a successful payment already exists for (user, passport) (409 —
   *     caller should hit /buyer-unlock instead)
   *
   * Re-use of an existing PENDING payment row for the same (user, passport)
   * is intentional — if the user opens the drawer twice, we hand back the
   * same Stripe clientSecret instead of stacking up dead intents.
   */
  async createPassportPaymentIntent(
    userId: string,
    passportId: string,
  ): Promise<{ clientSecret: string; paymentId: string }> {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      select: { id: true, ownerId: true },
    });
    if (!passport) throw new NotFoundException('Passport not found');
    if (passport.ownerId === userId) {
      throw new BadRequestException('You already own this passport');
    }

    const existingAccess = await this.prisma.buyerPassportAccess.findUnique({
      where: { passportId_userId: { passportId, userId } },
    });
    if (existingAccess) {
      throw new ConflictException('You already have access to this passport');
    }

    const existingSuccess = await this.prisma.passportPayment.findFirst({
      where: { userId, passportId, status: 'succeeded' },
    });
    if (existingSuccess) {
      throw new ConflictException(
        'A successful payment already exists — call /passport/:id/buyer-unlock to grant access',
      );
    }

    // Reuse a still-pending intent if the user already started one.
    const pending = await this.prisma.passportPayment.findFirst({
      where: { userId, passportId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    if (pending) {
      const intent = await this.stripe.paymentIntents.retrieve(
        pending.stripePaymentIntentId,
      );
      if (
        intent.status !== 'canceled' &&
        intent.status !== 'succeeded' &&
        intent.client_secret
      ) {
        return { clientSecret: intent.client_secret, paymentId: pending.id };
      }
      // Pending row exists but the intent has aged out — supersede it.
      await this.prisma.passportPayment.update({
        where: { id: pending.id },
        data: { status: 'failed' },
      });
    }

    // Create the DB row first so we can stamp its id into the intent
    // metadata — the webhook then looks the payment up by paymentId
    // (faster than indexing on stripePaymentIntentId, and unambiguous
    // if Stripe ever resends with a duplicate intent id).
    const payment = await this.prisma.passportPayment.create({
      data: {
        userId,
        passportId,
        amount: PASSPORT_UNLOCK_AMOUNT_PENCE,
        status: 'pending',
        stripePaymentIntentId: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });

    const intent = await this.stripe.paymentIntents.create({
      amount: PASSPORT_UNLOCK_AMOUNT_PENCE,
      currency: 'gbp',
      description: 'Property Passport unlock — UMovingU',
      automatic_payment_methods: { enabled: true },
      metadata: {
        umuType: 'passport_unlock',
        paymentId: payment.id,
        userId,
        passportId,
      },
    });

    if (!intent.client_secret) {
      await this.prisma.passportPayment.delete({ where: { id: payment.id } });
      throw new Error('Stripe returned no client_secret');
    }

    await this.prisma.passportPayment.update({
      where: { id: payment.id },
      data: { stripePaymentIntentId: intent.id },
    });

    return { clientSecret: intent.client_secret, paymentId: payment.id };
  }

  /**
   * Webhook entry point. The controller hands us the raw body bytes and
   * the Stripe-Signature header; we verify with the endpoint secret and
   * update the matching PassportPayment row.
   *
   * Idempotent: replaying the same event leaves the row in the same state.
   */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<{ received: true }> {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new BadRequestException('Webhook secret not configured');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err: any) {
      this.logger.warn(`Stripe webhook signature failed: ${err?.message}`);
      throw new BadRequestException('Invalid signature');
    }

    // We only handle passport-unlock events here. Marketplace payments
    // use their own metadata + their own state machine — the umuType
    // tag keeps the two flows from cross-contaminating.
    const intent = event.data.object as Stripe.PaymentIntent;
    const umuType = intent.metadata?.umuType;
    if (umuType !== 'passport_unlock') return { received: true };

    const paymentId = intent.metadata?.paymentId;
    if (!paymentId) {
      this.logger.warn(
        `[stripe webhook] passport_unlock event missing paymentId metadata (intent ${intent.id})`,
      );
      return { received: true };
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.prisma.passportPayment.updateMany({
          where: { id: paymentId, status: { not: 'refunded' } },
          data: { status: 'succeeded', succeededAt: new Date() },
        });
        break;
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled':
        await this.prisma.passportPayment.updateMany({
          where: { id: paymentId, status: 'pending' },
          data: { status: 'failed' },
        });
        break;
      case 'charge.refunded':
        await this.prisma.passportPayment.updateMany({
          where: { id: paymentId, status: 'succeeded' },
          data: { status: 'refunded', refundedAt: new Date() },
        });
        break;
      default:
        this.logger.debug(`[stripe webhook] ignoring ${event.type} for ${paymentId}`);
    }

    return { received: true };
  }

  /**
   * Used by `createBuyerAccess` to confirm a payment is real before granting
   * access. Belt + braces: we first check the DB (webhook updated), then
   * fall back to a synchronous Stripe API check so a webhook lag doesn't
   * block a paying user.
   */
  async hasSuccessfulPayment(userId: string, passportId: string): Promise<boolean> {
    const row = await this.prisma.passportPayment.findFirst({
      where: { userId, passportId, status: 'succeeded' },
    });
    if (row) return true;

    const pending = await this.prisma.passportPayment.findFirst({
      where: { userId, passportId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending) return false;

    try {
      const intent = await this.stripe.paymentIntents.retrieve(
        pending.stripePaymentIntentId,
      );
      if (intent.status === 'succeeded') {
        await this.prisma.passportPayment.update({
          where: { id: pending.id },
          data: { status: 'succeeded', succeededAt: new Date() },
        });
        return true;
      }
    } catch (err) {
      this.logger.warn(`[payment] sync re-fetch failed: ${(err as any)?.message}`);
      // Sentry: this is the failover path that lets paying users unlock
      // when the webhook hasn't fired. If it's failing, the user is
      // either blocked (we return false) or double-charging risk. Alert.
      captureException(err, { route: 'payment.hasSuccessfulPayment' });
    }
    return false;
  }
}
