import { Injectable, InternalServerErrorException } from '@nestjs/common';
import Stripe from 'stripe';

@Injectable()
export class PaymentService {
  private readonly stripe: Stripe;

  constructor() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    this.stripe = new Stripe(key);
  }

  async createPassportPaymentIntent(): Promise<{ clientSecret: string }> {
    const intent = await this.stripe.paymentIntents.create({
      amount: 9900, // £99.00 in pence
      currency: 'gbp',
      description: 'Property Passport unlock — UMovingU',
      automatic_payment_methods: { enabled: true },
    });

    if (!intent.client_secret) {
      throw new InternalServerErrorException('Failed to create payment intent');
    }

    return { clientSecret: intent.client_secret };
  }
}
