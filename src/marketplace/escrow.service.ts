import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';

// Platform fee — 10% of the job amount, paid by the customer on top
// of the supplier's quoted price. Lifted to a constant so the wizard
// preview, breakdown card, and authorize endpoint never drift.
export const PLATFORM_FEE_BPS = 1000; // 10%

export interface MarketplacePaymentDto {
  id: string;
  jobId: string;
  offerId: string;
  customerId: string;
  supplierId: string;
  amount: number;       // pence
  platformFee: number;  // pence
  total: number;        // pence
  status: 'pending' | 'held' | 'released' | 'refunded';
  createdAt: string;
  heldAt: string | null;
  releasedAt: string | null;
  refundedAt: string | null;
  evidencePhotos: string[];
}

export interface AuthorizeResult {
  payment: MarketplacePaymentDto;
  clientSecret: string;
}

@Injectable()
export class EscrowService {
  private readonly stripe: Stripe;

  constructor(private prisma: PrismaService) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    this.stripe = new Stripe(key);
  }

  // Called from POST /marketplace/offers/:id/authorize — the customer
  // committing to the offer. We do everything in one transaction so
  // we never have an "accepted" offer with no payment row, or two
  // accepted offers on the same job.
  async authorizeOffer(viewerUserId: string, offerId: string): Promise<AuthorizeResult> {
    const offer = await this.prisma.marketplaceOffer.findUnique({
      where: { id: offerId },
      include: { job: true },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.job.customerId !== viewerUserId) {
      throw new ForbiddenException('Only the job poster can authorise payment');
    }
    if (offer.status !== 'pending') {
      throw new BadRequestException(`Offer is already ${offer.status}`);
    }
    if (offer.job.status !== 'open') {
      throw new BadRequestException('This job is no longer open');
    }

    // Reject if any payment already exists for this job (e.g. the
    // customer refreshed mid-flow). The frontend treats this as
    // "resume": fetch the existing record and continue confirming.
    const existing = await this.prisma.marketplacePayment.findUnique({ where: { jobId: offer.jobId } });
    if (existing) {
      throw new BadRequestException('This job already has a payment in progress');
    }

    const amount = offer.price * 100; // pounds → pence
    const platformFee = Math.round((amount * PLATFORM_FEE_BPS) / 10_000);
    const total = amount + platformFee;

    const intent = await this.stripe.paymentIntents.create({
      amount: total,
      currency: 'gbp',
      description: `UProtect escrow · job ${offer.jobId}`,
      automatic_payment_methods: { enabled: true },
      metadata: {
        umuType: 'marketplace_escrow',
        jobId: offer.jobId,
        offerId: offer.id,
        supplierId: offer.supplierId,
        customerId: viewerUserId,
      },
    });

    // Single DB transaction: accept the offer, decline siblings,
    // flip job to in_progress, create Payment row.
    const [payment] = await this.prisma.$transaction([
      this.prisma.marketplacePayment.create({
        data: {
          jobId: offer.jobId,
          offerId: offer.id,
          customerId: viewerUserId,
          supplierId: offer.supplierId,
          amount,
          platformFee,
          total,
          status: 'pending',
          stripePaymentIntentId: intent.id,
        },
      }),
      this.prisma.marketplaceOffer.update({
        where: { id: offer.id },
        data: { status: 'accepted' },
      }),
      this.prisma.marketplaceOffer.updateMany({
        where: { jobId: offer.jobId, id: { not: offer.id }, status: 'pending' },
        data: { status: 'declined' },
      }),
      this.prisma.marketplaceJob.update({
        where: { id: offer.jobId },
        data: { status: 'in_progress' },
      }),
    ]);

    return {
      payment: this.toDto(payment),
      clientSecret: intent.client_secret!,
    };
  }

  // Frontend calls this after Stripe confirmCardPayment resolves
  // succeeded. We verify against Stripe to make sure the client isn't
  // lying — only mark held when Stripe agrees.
  async confirmPayment(viewerUserId: string, paymentId: string): Promise<MarketplacePaymentDto> {
    const payment = await this.findOwnPayment(viewerUserId, paymentId);

    if (payment.status === 'held') return this.toDto(payment); // idempotent
    if (payment.status !== 'pending') {
      throw new BadRequestException(`Payment is already ${payment.status}`);
    }
    if (!payment.stripePaymentIntentId) {
      throw new BadRequestException('Payment is missing its Stripe intent');
    }

    const intent = await this.stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
    if (intent.status !== 'succeeded') {
      throw new BadRequestException(`Stripe says payment is ${intent.status}`);
    }

    const updated = await this.prisma.marketplacePayment.update({
      where: { id: paymentId },
      data: { status: 'held', heldAt: new Date() },
    });
    return this.toDto(updated);
  }

  // Customer releases funds after verifying the work is done. The
  // actual money transfer to the supplier's account waits for the
  // Stripe Connect pass — for now this flips DB state and the caller
  // (controller) drops a system message into the thread.
  async releasePayment(viewerUserId: string, paymentId: string): Promise<MarketplacePaymentDto> {
    const payment = await this.findOwnPayment(viewerUserId, paymentId);
    if (payment.status === 'released') return this.toDto(payment);
    if (payment.status !== 'held') {
      throw new BadRequestException(`Cannot release a ${payment.status} payment`);
    }

    // Use a transaction so payment + job land in their terminal states
    // together. The supplier Transfer happens in the Connect pass —
    // funds remain on the platform balance until then.
    const [released] = await this.prisma.$transaction([
      this.prisma.marketplacePayment.update({
        where: { id: paymentId },
        data: { status: 'released', releasedAt: new Date() },
      }),
      this.prisma.marketplaceJob.update({
        where: { id: payment.jobId },
        data: { status: 'completed' },
      }),
    ]);
    return this.toDto(released);
  }

  async getPayment(viewerUserId: string, paymentId: string): Promise<MarketplacePaymentDto> {
    const payment = await this.findVisiblePayment(viewerUserId, paymentId);
    return this.toDto(payment);
  }

  // For receipts shown on the offers page — fetch by jobId if the
  // viewer is the job customer or the accepted-offer supplier.
  async getPaymentForJob(viewerUserId: string, jobId: string): Promise<MarketplacePaymentDto | null> {
    const payment = await this.prisma.marketplacePayment.findUnique({ where: { jobId } });
    if (!payment) return null;
    if (payment.customerId !== viewerUserId && payment.supplierId !== viewerUserId) {
      return null;
    }
    return this.toDto(payment);
  }

  // Append evidence photo URLs to the payment row. Either party can
  // add (customer uploads "before" + ongoing shots, supplier uploads
  // "completion" shots). We pre-validate that the URLs look like our
  // own uploads to avoid users pasting in arbitrary external links.
  async addEvidencePhotos(
    viewerUserId: string,
    paymentId: string,
    photos: string[],
  ): Promise<MarketplacePaymentDto> {
    const payment = await this.findVisiblePayment(viewerUserId, paymentId);

    const cleaned = (photos ?? [])
      .map((p) => (p ?? '').toString().trim())
      .filter((p) => p.startsWith('/uploads/'));
    if (!cleaned.length) {
      throw new BadRequestException('No valid photo URLs provided');
    }
    // Soft cap so a misbehaving client can't fill the column unbounded.
    const next = [...(payment.evidencePhotos ?? []), ...cleaned].slice(0, 60);

    const updated = await this.prisma.marketplacePayment.update({
      where: { id: paymentId },
      data: { evidencePhotos: next },
    });
    return this.toDto(updated);
  }

  // ─── internal ─────────────────────────────────────────────────────
  private async findOwnPayment(viewerUserId: string, paymentId: string) {
    const payment = await this.prisma.marketplacePayment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.customerId !== viewerUserId) {
      throw new ForbiddenException('Only the paying customer can act on this payment');
    }
    return payment;
  }

  private async findVisiblePayment(viewerUserId: string, paymentId: string) {
    const payment = await this.prisma.marketplacePayment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.customerId !== viewerUserId && payment.supplierId !== viewerUserId) {
      throw new ForbiddenException('You are not a party to this payment');
    }
    return payment;
  }

  private toDto(p: any): MarketplacePaymentDto {
    return {
      id: p.id,
      jobId: p.jobId,
      offerId: p.offerId,
      customerId: p.customerId,
      supplierId: p.supplierId,
      amount: p.amount,
      platformFee: p.platformFee,
      total: p.total,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      heldAt: p.heldAt?.toISOString() ?? null,
      releasedAt: p.releasedAt?.toISOString() ?? null,
      refundedAt: p.refundedAt?.toISOString() ?? null,
      evidencePhotos: Array.isArray(p.evidencePhotos) ? p.evidencePhotos : [],
    };
  }
}
