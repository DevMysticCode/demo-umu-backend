import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewsService } from './reviews.service';
import { CreateJobDto } from './dto/create-job.dto';
import { CreateOfferDto } from './dto/create-offer.dto';

// Shape returned by the public endpoints. We collapse the DB row
// into something the mobile client can render directly — derived
// labels (postedAgo, categoryLabel) computed here, not stored.
export interface MarketplaceCategoryDto {
  slug: string;
  name: string;
  emoji: string;
  background: string;
}

export interface MarketplaceJobListItem {
  id: string;
  title: string;
  categorySlug: string;
  categoryLabel: string; // emoji + name, e.g. '🛁 Bathroom'
  locationLabel: string;
  distanceMi: number | null;
  urgency: 'urgent' | 'standard' | 'flexible';
  postedAgo: string;
  availability: string | null;
  budgetMin: number;
  budgetMax: number | null;
  offerCount: number;
  photoBg: string | null;    // legacy gradient placeholder for seeded demo jobs
  photoUrl: string | null;   // first real uploaded photo, if any (relative URL)
  status: string;            // open | in_progress | completed | cancelled
}

export interface MarketplaceJobDetail extends MarketplaceJobListItem {
  description: string;
  availableDates: string[];
  photoBgs: string[];   // legacy gradient fallback
  photos: string[];     // real uploaded photo URLs (preferred)
  postcode: string | null;
  status: string;
  customerId: string | null;
  isMine: boolean;      // true when the requesting user posted this job (false for unauthed)
}

export interface MarketplaceOfferDto {
  id: string;
  jobId: string;
  supplierId: string;
  supplierName: string;
  supplierInitials: string;
  price: number;
  message: string;
  availableDate: string | null;
  status: string;       // pending | accepted | declined | withdrawn
  createdAt: string;
  // Supplier reputation (Step 6) — populated by `listOffersForJob`
  // so the customer can compare quotes without an N+1 fetch.
  supplierRating?: number | null;
  supplierReviewCount?: number;
  supplierJobsCompleted?: number;
}

export interface MarketplaceStats {
  posted: number;
  inProgress: number;
  completed: number;
}

function postedAgoLabel(postedAt: Date): string {
  const ms = Date.now() - postedAt.getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.round(days / 7)}w ago`;
}

function normaliseUrgency(u: string): 'urgent' | 'standard' | 'flexible' {
  return u === 'urgent' || u === 'flexible' ? u : 'standard';
}

@Injectable()
export class MarketplaceService {
  constructor(
    private prisma: PrismaService,
    // Circular: ReviewsService also takes PrismaService only, so this
    // forwardRef is defensive — keeps Nest happy if ReviewsService ever
    // grows a back-reference to MarketplaceService.
    @Inject(forwardRef(() => ReviewsService))
    private reviews: ReviewsService,
  ) {}

  async listCategories(): Promise<MarketplaceCategoryDto[]> {
    const rows = await this.prisma.marketplaceCategory.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((c) => ({
      slug: c.slug,
      name: c.name,
      emoji: c.emoji,
      background: c.background,
    }));
  }

  async listJobs(params: { categorySlug?: string; limit?: number }): Promise<MarketplaceJobListItem[]> {
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
    const where: any = { status: 'open' };
    if (params.categorySlug) {
      where.category = { slug: params.categorySlug };
    }

    const rows = await this.prisma.marketplaceJob.findMany({
      where,
      include: { category: true },
      orderBy: { postedAt: 'desc' },
      take: limit,
    });

    return rows.map((j) => this.toListItem(j));
  }

  async getJob(id: string, viewerUserId?: string | null): Promise<MarketplaceJobDetail> {
    const job = await this.prisma.marketplaceJob.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!job) throw new NotFoundException('Job not found');

    const list = this.toListItem(job);
    return {
      ...list,
      description: job.description,
      availableDates: Array.isArray(job.availableDates) ? (job.availableDates as string[]) : [],
      photoBgs: Array.isArray(job.photoBgs) ? (job.photoBgs as string[]) : [],
      photos: job.photos ?? [],
      postcode: job.postcode,
      status: job.status,
      customerId: job.customerId,
      isMine: !!viewerUserId && job.customerId === viewerUserId,
    };
  }

  async createJob(userId: string, dto: CreateJobDto): Promise<MarketplaceJobDetail> {
    const category = await this.prisma.marketplaceCategory.findUnique({
      where: { slug: dto.categorySlug },
    });
    if (!category) throw new BadRequestException(`Unknown category "${dto.categorySlug}"`);

    if (dto.budgetMax != null && dto.budgetMax < dto.budgetMin) {
      throw new BadRequestException('budgetMax must be greater than or equal to budgetMin');
    }

    const created = await this.prisma.marketplaceJob.create({
      data: {
        customerId: userId,
        categoryId: category.id,
        title: dto.title.trim(),
        description: dto.description.trim(),
        locationLabel: dto.locationLabel.trim(),
        postcode: dto.postcode?.trim() ?? null,
        urgency: dto.urgency,
        availability: dto.availability?.trim() ?? null,
        availableDates: dto.availableDates ?? [],
        budgetMin: dto.budgetMin,
        budgetMax: dto.budgetMax ?? null,
        photos: dto.photos,
        // No mock gradient backdrop on real posts — the photos[0] becomes
        // the header on the detail page.
        photoBg: null,
        photoBgs: [],
        status: 'open',
      },
      include: { category: true },
    });

    return this.getJob(created.id, userId);
  }

  async listMyJobs(userId: string): Promise<MarketplaceJobListItem[]> {
    const rows = await this.prisma.marketplaceJob.findMany({
      where: { customerId: userId },
      include: { category: true },
      orderBy: { postedAt: 'desc' },
    });
    return rows.map((j) => this.toListItem(j));
  }

  async getStats(userId: string): Promise<MarketplaceStats> {
    const grouped = await this.prisma.marketplaceJob.groupBy({
      by: ['status'],
      where: { customerId: userId },
      _count: { _all: true },
    });

    let posted = 0;
    let inProgress = 0;
    let completed = 0;
    for (const row of grouped) {
      const n = row._count._all;
      posted += n;
      if (row.status === 'in_progress') inProgress += n;
      if (row.status === 'completed') completed += n;
    }
    return { posted, inProgress, completed };
  }

  private toListItem(job: any): MarketplaceJobListItem {
    // We deliberately return raw URLs (relative) and the legacy gradient
    // separately — the client resolves URLs against the API origin and
    // builds the CSS `linear-gradient(...) url(...)` expression itself.
    // This keeps demo gradients working without bleeding a half-built
    // CSS string into responses.
    const firstPhoto: string | null = Array.isArray(job.photos) && job.photos.length ? job.photos[0] : null;
    return {
      id: job.id,
      title: job.title,
      categorySlug: job.category.slug,
      categoryLabel: `${job.category.emoji} ${job.category.name}`,
      locationLabel: job.locationLabel,
      distanceMi: job.distanceMi ?? null,
      urgency: normaliseUrgency(job.urgency),
      postedAgo: postedAgoLabel(job.postedAt),
      availability: job.availability,
      budgetMin: job.budgetMin,
      budgetMax: job.budgetMax ?? null,
      offerCount: job.offerCount,
      photoBg: firstPhoto ? null : job.photoBg ?? null,
      photoUrl: firstPhoto,
      status: job.status,
    };
  }

  // Used by the messages controller to derive the supplier id from an
  // offer id (the customer side opens threads via the offer card, not
  // the supplier id directly).
  async getOfferOrThrow(offerId: string) {
    const offer = await this.prisma.marketplaceOffer.findUnique({
      where: { id: offerId },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    return offer;
  }

  // ─── Offers ───────────────────────────────────────────────────────
  async createOffer(supplierId: string, jobId: string, dto: CreateOfferDto): Promise<MarketplaceOfferDto> {
    const job = await this.prisma.marketplaceJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.status !== 'open') throw new BadRequestException('This job is no longer accepting offers');
    if (job.customerId && job.customerId === supplierId) {
      throw new BadRequestException('You cannot make an offer on your own job');
    }

    try {
      const offer = await this.prisma.marketplaceOffer.create({
        data: {
          jobId,
          supplierId,
          price: dto.price,
          message: dto.message.trim(),
          availableDate: dto.availableDate?.trim() ?? null,
        },
        include: { supplier: true },
      });

      // Bump the cached offerCount on the job so list cards stay accurate
      // without a join. We keep counting `pending` offers only — accepted
      // is a terminal state and shouldn't inflate the "N offers" pill.
      await this.prisma.marketplaceJob.update({
        where: { id: jobId },
        data: { offerCount: { increment: 1 } },
      });

      return this.toOfferDto(offer);
    } catch (err: any) {
      // P2002 = unique-constraint violation on (jobId, supplierId)
      if (err?.code === 'P2002') {
        throw new BadRequestException('You already have an offer on this job');
      }
      throw err;
    }
  }

  // Single-offer fetch used by the authorize-payment page. Visible
  // to the job's customer (the one paying) or the supplier (so they
  // can see status changes from their own offers).
  async getOfferDto(viewerUserId: string, offerId: string): Promise<MarketplaceOfferDto & { jobId: string; jobTitle: string; jobCategoryLabel: string }> {
    const offer = await this.prisma.marketplaceOffer.findUnique({
      where: { id: offerId },
      include: { job: { include: { category: true } }, supplier: true },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.job.customerId !== viewerUserId && offer.supplierId !== viewerUserId) {
      throw new ForbiddenException('You are not a party to this offer');
    }
    return {
      ...this.toOfferDto(offer),
      jobId: offer.jobId,
      jobTitle: offer.job.title,
      jobCategoryLabel: `${offer.job.category.emoji} ${offer.job.category.name}`,
    };
  }

  async listOffersForJob(viewerUserId: string, jobId: string): Promise<MarketplaceOfferDto[]> {
    const job = await this.prisma.marketplaceJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.customerId !== viewerUserId) {
      throw new ForbiddenException('Only the job poster can view offers');
    }

    const offers = await this.prisma.marketplaceOffer.findMany({
      where: { jobId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: { supplier: true },
    });

    // Single grouped lookup so the offer cards can render ratings +
    // jobs-completed without one round-trip per supplier.
    const stats = await this.reviews.getStatsForUsers(offers.map((o) => o.supplierId));
    return offers.map((o) => {
      const s = stats[o.supplierId];
      return {
        ...this.toOfferDto(o),
        supplierRating: s?.averageRating ?? null,
        supplierReviewCount: s?.reviewCount ?? 0,
        supplierJobsCompleted: s?.jobsCompleted ?? 0,
      };
    });
  }

  async acceptOffer(viewerUserId: string, offerId: string): Promise<MarketplaceOfferDto> {
    const offer = await this.prisma.marketplaceOffer.findUnique({
      where: { id: offerId },
      include: { job: true, supplier: true },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.job.customerId !== viewerUserId) {
      throw new ForbiddenException('Only the job poster can accept offers');
    }
    if (offer.status !== 'pending') {
      throw new BadRequestException(`Offer is already ${offer.status}`);
    }
    if (offer.job.status !== 'open') {
      throw new BadRequestException('This job is no longer open');
    }

    // Accept this offer, decline all other pending siblings, flip the
    // job to in_progress. Single transaction so we never end up with
    // two accepted offers on the same job.
    await this.prisma.$transaction([
      this.prisma.marketplaceOffer.update({
        where: { id: offerId },
        data: { status: 'accepted' },
      }),
      this.prisma.marketplaceOffer.updateMany({
        where: {
          jobId: offer.jobId,
          id: { not: offerId },
          status: 'pending',
        },
        data: { status: 'declined' },
      }),
      this.prisma.marketplaceJob.update({
        where: { id: offer.jobId },
        data: { status: 'in_progress' },
      }),
    ]);

    const refreshed = await this.prisma.marketplaceOffer.findUniqueOrThrow({
      where: { id: offerId },
      include: { supplier: true },
    });
    return this.toOfferDto(refreshed);
  }

  async declineOffer(viewerUserId: string, offerId: string): Promise<MarketplaceOfferDto> {
    const offer = await this.prisma.marketplaceOffer.findUnique({
      where: { id: offerId },
      include: { job: true, supplier: true },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.job.customerId !== viewerUserId) {
      throw new ForbiddenException('Only the job poster can decline offers');
    }
    if (offer.status !== 'pending') {
      throw new BadRequestException(`Offer is already ${offer.status}`);
    }

    const updated = await this.prisma.marketplaceOffer.update({
      where: { id: offerId },
      data: { status: 'declined' },
      include: { supplier: true },
    });
    return this.toOfferDto(updated);
  }

  private toOfferDto(offer: any): MarketplaceOfferDto {
    const f = offer.supplier?.firstName ?? '';
    const l = offer.supplier?.lastName ?? '';
    const fullName = `${f} ${l}`.trim() || 'A supplier';
    const initials = ((f[0] ?? '') + (l[0] ?? '')).toUpperCase() || 'S';
    return {
      id: offer.id,
      jobId: offer.jobId,
      supplierId: offer.supplierId,
      supplierName: fullName,
      supplierInitials: initials,
      price: offer.price,
      message: offer.message,
      availableDate: offer.availableDate,
      status: offer.status,
      createdAt: offer.createdAt.toISOString(),
    };
  }
}
