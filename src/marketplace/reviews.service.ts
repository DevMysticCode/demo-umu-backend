import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';

// Reviews are scoped to a (job, fromUser) pair — one review per direction.
// Direction is derived from the job's customer/supplier ids so the
// reviewer can't accidentally lie about which side they're on.
export interface MarketplaceReviewDto {
  id: string;
  jobId: string;
  fromUserId: string;
  toUserId: string;
  direction: 'customer_to_supplier' | 'supplier_to_customer';
  rating: number;
  body: string | null;
  // Per-dimension scores. Null when the reviewer skipped the sliders.
  punctuality: number | null;
  communication: number | null;
  workmanship: number | null;
  reliability: number | null;
  tags: string[];
  createdAt: string;
  fromUserName: string;
  fromUserInitials: string;
}

export interface MarketplaceUserStats {
  userId: string;
  reviewCount: number;
  averageRating: number | null;   // null when there are no reviews
  jobsCompleted: number;          // released payments where user was supplier
  jobsPosted: number;             // total jobs the user has posted as customer
}

export interface MarketplaceEarnings {
  totalEarned: number;       // pence — sum of `amount` on released payments
  payoutCount: number;
  averagePayout: number;     // pence
  pendingHeld: number;       // pence — payments currently held but not released yet (future earnings)
  pendingCount: number;
}

function initialsFor(first?: string | null, last?: string | null) {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase() || 'U';
}
function nameFor(first?: string | null, last?: string | null) {
  return `${first ?? ''} ${last ?? ''}`.trim() || 'A user';
}

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  async createReview(viewerUserId: string, jobId: string, dto: CreateReviewDto): Promise<MarketplaceReviewDto> {
    const job = await this.prisma.marketplaceJob.findUnique({
      where: { id: jobId },
      include: { payment: true },
    });
    if (!job) throw new NotFoundException('Job not found');
    if (!job.payment) {
      throw new BadRequestException('You can only review a job after escrow has been authorised');
    }
    if (job.payment.status !== 'released') {
      throw new BadRequestException('You can only review once funds have been released');
    }

    let direction: 'customer_to_supplier' | 'supplier_to_customer';
    let toUserId: string;
    if (job.customerId === viewerUserId) {
      direction = 'customer_to_supplier';
      toUserId = job.payment.supplierId;
    } else if (job.payment.supplierId === viewerUserId) {
      direction = 'supplier_to_customer';
      toUserId = job.customerId!;
    } else {
      throw new ForbiddenException('You are not a party to this job');
    }

    // Defence-in-depth: refuse self-reviews even though createOffer
    // blocks customer==supplier at the booking stage. A job seeded
    // with customerId=null and later self-served, or a future code
    // path that doesn't re-check, would otherwise let a user inflate
    // their own public rating with a 5-star self-review.
    if (toUserId === viewerUserId) {
      throw new ForbiddenException('You cannot review yourself');
    }

    // Normalise the tag list — trim each entry, drop blanks, cap length
    // per chip. Keeps the column compact and predictable for downstream
    // search/filter even if the client sends sloppy data.
    const cleanTags = (dto.tags ?? [])
      .map((t) => (t ?? '').toString().trim())
      .filter((t) => t.length > 0 && t.length <= 60);

    try {
      const review = await this.prisma.marketplaceReview.create({
        data: {
          jobId,
          fromUserId: viewerUserId,
          toUserId,
          direction,
          rating: dto.rating,
          body: dto.body?.trim() || null,
          punctuality: dto.punctuality ?? null,
          communication: dto.communication ?? null,
          workmanship: dto.workmanship ?? null,
          reliability: dto.reliability ?? null,
          tags: cleanTags,
        },
        include: { fromUser: true },
      });
      return this.toDto(review);
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new BadRequestException('You have already reviewed this job');
      }
      throw err;
    }
  }

  async listForUser(userId: string): Promise<MarketplaceReviewDto[]> {
    const reviews = await this.prisma.marketplaceReview.findMany({
      where: { toUserId: userId },
      orderBy: { createdAt: 'desc' },
      include: { fromUser: true },
      take: 50,
    });
    return reviews.map((r) => this.toDto(r));
  }

  async getStats(userId: string): Promise<MarketplaceUserStats> {
    const [agg, jobsCompleted, jobsPosted] = await Promise.all([
      this.prisma.marketplaceReview.aggregate({
        where: { toUserId: userId },
        _avg: { rating: true },
        _count: { _all: true },
      }),
      this.prisma.marketplacePayment.count({
        where: { supplierId: userId, status: 'released' },
      }),
      this.prisma.marketplaceJob.count({
        where: { customerId: userId },
      }),
    ]);
    return {
      userId,
      reviewCount: agg._count._all,
      averageRating: agg._avg.rating != null ? Number(agg._avg.rating.toFixed(2)) : null,
      jobsCompleted,
      jobsPosted,
    };
  }

  // Used by the offers page to show a per-offer rating chip without
  // making one network call per offer card.
  async getStatsForUsers(userIds: string[]): Promise<Record<string, MarketplaceUserStats>> {
    if (!userIds.length) return {};
    const unique = Array.from(new Set(userIds));

    const [reviewAgg, completedAgg] = await Promise.all([
      this.prisma.marketplaceReview.groupBy({
        by: ['toUserId'],
        where: { toUserId: { in: unique } },
        _avg: { rating: true },
        _count: { _all: true },
      }),
      this.prisma.marketplacePayment.groupBy({
        by: ['supplierId'],
        where: { supplierId: { in: unique }, status: 'released' },
        _count: { _all: true },
      }),
    ]);

    const completedBy = new Map<string, number>();
    for (const row of completedAgg) completedBy.set(row.supplierId, row._count._all);

    const result: Record<string, MarketplaceUserStats> = {};
    for (const id of unique) {
      result[id] = {
        userId: id,
        reviewCount: 0,
        averageRating: null,
        jobsCompleted: completedBy.get(id) ?? 0,
        jobsPosted: 0, // not needed for the offer card — leave 0
      };
    }
    for (const row of reviewAgg) {
      result[row.toUserId] = {
        ...result[row.toUserId],
        reviewCount: row._count._all,
        averageRating: row._avg.rating != null ? Number(row._avg.rating.toFixed(2)) : null,
      };
    }
    return result;
  }

  async getEarnings(viewerUserId: string): Promise<MarketplaceEarnings> {
    const [released, held] = await Promise.all([
      this.prisma.marketplacePayment.aggregate({
        where: { supplierId: viewerUserId, status: 'released' },
        _sum: { amount: true },
        _count: { _all: true },
        _avg: { amount: true },
      }),
      this.prisma.marketplacePayment.aggregate({
        where: { supplierId: viewerUserId, status: 'held' },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);
    return {
      totalEarned: released._sum.amount ?? 0,
      payoutCount: released._count._all,
      averagePayout: released._avg.amount ? Math.round(released._avg.amount) : 0,
      pendingHeld: held._sum.amount ?? 0,
      pendingCount: held._count._all,
    };
  }

  async listMyPayouts(viewerUserId: string) {
    const payments = await this.prisma.marketplacePayment.findMany({
      where: { supplierId: viewerUserId, status: { in: ['held', 'released'] } },
      orderBy: { releasedAt: 'desc' },
      include: {
        job: { include: { category: true } },
        customer: true,
      },
    });
    return payments.map((p) => ({
      id: p.id,
      jobId: p.jobId,
      jobTitle: p.job.title,
      jobCategoryLabel: `${p.job.category.emoji} ${p.job.category.name}`,
      customerName: nameFor(p.customer.firstName, p.customer.lastName),
      customerInitials: initialsFor(p.customer.firstName, p.customer.lastName),
      amount: p.amount,
      status: p.status as 'held' | 'released',
      releasedAt: p.releasedAt?.toISOString() ?? null,
      heldAt: p.heldAt?.toISOString() ?? null,
    }));
  }

  // ─── internal ─────────────────────────────────────────────────────
  private toDto(r: any): MarketplaceReviewDto {
    return {
      id: r.id,
      jobId: r.jobId,
      fromUserId: r.fromUserId,
      toUserId: r.toUserId,
      direction: r.direction,
      rating: r.rating,
      body: r.body,
      punctuality: r.punctuality ?? null,
      communication: r.communication ?? null,
      workmanship: r.workmanship ?? null,
      reliability: r.reliability ?? null,
      tags: Array.isArray(r.tags) ? r.tags : [],
      createdAt: r.createdAt.toISOString(),
      fromUserName: nameFor(r.fromUser?.firstName, r.fromUser?.lastName),
      fromUserInitials: initialsFor(r.fromUser?.firstName, r.fromUser?.lastName),
    };
  }
}
