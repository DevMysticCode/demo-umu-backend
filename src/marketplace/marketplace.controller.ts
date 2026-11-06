import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt.guard';

// Same tighter throttle as payment.controller.ts's createIntent — this
// mints a Stripe PaymentIntent too, and sat on the generous global
// default with no endpoint-specific limit of its own (data-leakage
// audit 2026-10-19). The idempotency key on the Stripe call caps
// duplicate intents per single offer, but not a script cycling through
// many distinct offer/job IDs.
const ESCROW_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
import { createUploadStorage, publicUrlFor, IMAGE_MIME_TYPES } from '../common/storage';
import { MarketplaceService } from './marketplace.service';
import { MarketplaceMessagesService } from './messages.service';
import { EscrowService } from './escrow.service';
import { ReviewsService } from './reviews.service';
import { CreateJobDto } from './dto/create-job.dto';
import { CreateOfferDto } from './dto/create-offer.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import { AddEvidenceDto } from './dto/add-evidence.dto';

const CATEGORY_SCHEMA = { type: 'object' as const, properties: { slug: { type: 'string' }, name: { type: 'string' }, emoji: { type: 'string' }, background: { type: 'string' } } };
const JOB_LIST_ITEM_SCHEMA = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' }, title: { type: 'string' }, categorySlug: { type: 'string' }, categoryLabel: { type: 'string' },
    locationLabel: { type: 'string' }, distanceMi: { type: 'number', nullable: true },
    urgency: { type: 'string', enum: ['urgent', 'standard', 'flexible'] }, postedAgo: { type: 'string' },
    availability: { type: 'string', nullable: true }, budgetMin: { type: 'number' }, budgetMax: { type: 'number', nullable: true },
    offerCount: { type: 'number' }, photoBg: { type: 'string', nullable: true }, photoUrl: { type: 'string', nullable: true },
    status: { type: 'string', description: 'open | in_progress | completed | cancelled' },
  },
};
const JOB_DETAIL_SCHEMA = {
  type: 'object' as const,
  properties: {
    ...JOB_LIST_ITEM_SCHEMA.properties,
    description: { type: 'string' }, availableDates: { type: 'array', items: { type: 'string' } },
    photoBgs: { type: 'array', items: { type: 'string' } }, photos: { type: 'array', items: { type: 'string' } },
    postcode: { type: 'string', nullable: true }, customerId: { type: 'string', nullable: true },
    isMine: { type: 'boolean', description: 'true when the requesting user posted this job (false for an unauthenticated viewer)' },
  },
};
const OFFER_SCHEMA = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' }, jobId: { type: 'string' }, supplierId: { type: 'string' }, supplierName: { type: 'string' },
    supplierInitials: { type: 'string' }, price: { type: 'number' }, message: { type: 'string' },
    availableDate: { type: 'string', nullable: true }, status: { type: 'string', description: 'pending | accepted | declined | withdrawn' },
    createdAt: { type: 'string' }, supplierRating: { type: 'number', nullable: true }, supplierReviewCount: { type: 'number' },
    supplierJobsCompleted: { type: 'number' },
  },
};
const PAYMENT_SCHEMA = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' }, jobId: { type: 'string' }, offerId: { type: 'string' }, customerId: { type: 'string' },
    supplierId: { type: 'string' }, amount: { type: 'number', description: 'pence' }, platformFee: { type: 'number', description: 'pence' },
    total: { type: 'number', description: 'pence' }, status: { type: 'string', enum: ['pending', 'held', 'released', 'refunded'] },
    createdAt: { type: 'string' }, heldAt: { type: 'string', nullable: true }, releasedAt: { type: 'string', nullable: true },
    refundedAt: { type: 'string', nullable: true }, evidencePhotos: { type: 'array', items: { type: 'string' } },
  },
};
const REVIEW_SCHEMA = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' }, jobId: { type: 'string' }, fromUserId: { type: 'string' }, toUserId: { type: 'string' },
    direction: { type: 'string', enum: ['customer_to_supplier', 'supplier_to_customer'] }, rating: { type: 'number' },
    body: { type: 'string', nullable: true }, punctuality: { type: 'number', nullable: true }, communication: { type: 'number', nullable: true },
    workmanship: { type: 'number', nullable: true }, reliability: { type: 'number', nullable: true },
    tags: { type: 'array', items: { type: 'string' } }, createdAt: { type: 'string' }, fromUserName: { type: 'string' }, fromUserInitials: { type: 'string' },
  },
};

// Read endpoints are public; write endpoints (post job, upload photo,
// own-job aggregates) are gated by JwtAuthGuard. Auth is applied per
// handler so unauthenticated browse / search keeps working.
@Controller('marketplace')
export class MarketplaceController {
  constructor(
    private service: MarketplaceService,
    private messages: MarketplaceMessagesService,
    private escrow: EscrowService,
    private reviews: ReviewsService,
    private jwtService: JwtService, // optional auth on job detail - see getJob()
  ) {}

  // Decode the bearer token if present, but don't reject anonymous calls.
  // Lets us include `isMine` on the public job-detail response without
  // forcing every browser to authenticate.
  private peekUserId(req: any): string | null {
    const authHeader = req.headers?.authorization;
    if (!authHeader) return null;
    const [bearer, token] = String(authHeader).split(' ');
    if (bearer !== 'Bearer' || !token) return null;
    try {
      const decoded: any = this.jwtService.verify(token);
      return decoded?.sub ?? null;
    } catch {
      return null;
    }
  }

  // ── Public reads ─────────────────────────────────────────────────
  @Get('categories')
  @ApiOperation({ summary: 'List marketplace job categories', description: 'Public. Returns every tradesperson job category (slug, display name, emoji and gradient background) used to tag and filter jobs.' })
  @ApiResponse({ status: 200, description: 'Array of categories.', schema: { type: 'array', items: CATEGORY_SCHEMA } })
  listCategories() {
    return this.service.listCategories();
  }

  @Get('jobs')
  @ApiOperation({ summary: 'Browse marketplace jobs', description: 'Public. Lists open jobs, optionally filtered by category and capped to a limit, newest first.' })
  @ApiQuery({ name: 'category', required: false, description: 'Category slug to filter by (e.g. "bathroom"). Omit to list all categories.' })
  @ApiQuery({ name: 'limit', required: false, description: 'Maximum number of jobs to return.' })
  @ApiResponse({ status: 200, description: 'Array of job summaries.', schema: { type: 'array', items: JOB_LIST_ITEM_SCHEMA } })
  listJobs(@Query('category') category?: string, @Query('limit') limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return this.service.listJobs({
      categorySlug: category || undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    });
  }

  // ── Authed routes ────────────────────────────────────────────────
  // /me/* must come BEFORE /:id so Nest's path matcher doesn't try to
  // treat "me" as a job id.
  @Get('me/jobs')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "List the caller's posted jobs", description: 'Returns every job the authenticated user has posted as a customer.' })
  @ApiResponse({ status: 200, description: 'Array of job summaries.', schema: { type: 'array', items: JOB_LIST_ITEM_SCHEMA } })
  listMyJobs(@Req() req: any) {
    return this.service.listMyJobs(req.user.id);
  }

  @Get('me/stats')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get the caller's job counts", description: 'Counts of jobs the authenticated user has posted, broken down by posted / in-progress / completed.' })
  @ApiResponse({ status: 200, description: 'Job counts.', schema: { type: 'object', properties: { posted: { type: 'number' }, inProgress: { type: 'number' }, completed: { type: 'number' } } } })
  getStats(@Req() req: any) {
    return this.service.getStats(req.user.id);
  }

  @Post('jobs')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Post a new job', description: 'Creates a job listing as the authenticated user (the customer). Requires at least 3 and at most 12 photo URLs, each previously uploaded via POST /marketplace/upload-photo.' })
  @ApiResponse({ status: 201, description: 'The created job.', schema: JOB_DETAIL_SCHEMA })
  createJob(@Req() req: any, @Body() dto: CreateJobDto) {
    return this.service.createJob(req.user.id, dto);
  }

  // Photo upload — multipart, one file at a time. The wizard calls
  // this per photo as the user picks them so we can show real previews.
  @Post('upload-photo')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor(
      'file',
      createUploadStorage({
        bucket: 'job-photos',
        maxMb: 8,
        mimeAllowList: IMAGE_MIME_TYPES,
      }),
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Upload a job photo', description: 'Uploads a single image (jpg/png/webp/heic, max 8MB) to the job-photos bucket and returns its public URL, for use in the "post a job" wizard or marketplace evidence photos.' })
  @ApiResponse({ status: 201, description: 'The uploaded photo URL.', schema: { type: 'object', properties: { url: { type: 'string' } } } })
  uploadPhoto(@UploadedFile() file: any) {
    if (!file) {
      // null from fileFilter (rejected MIME) lands here too — give the
      // user a clearer message than multer's generic empty-file error.
      throw new BadRequestException(
        'Upload missing or unsupported file type (allowed: jpg, png, webp, heic)',
      );
    }
    return { url: publicUrlFor('job-photos', file.filename) };
  }

  // Param routes last so they don't capture /me or /upload-photo.
  @Get('jobs/:id')
  @ApiOperation({ summary: 'Get job detail', description: 'Public. Returns full job detail including description, photos and status. If a valid bearer token is present, `isMine` reflects whether the caller posted it; anonymous callers always get isMine: false.' })
  @ApiParam({ name: 'id', description: 'Job ID' })
  @ApiResponse({ status: 200, description: 'The job.', schema: JOB_DETAIL_SCHEMA })
  getJob(@Param('id') id: string, @Req() req: any) {
    return this.service.getJob(id, this.peekUserId(req));
  }

  // ── Offers ───────────────────────────────────────────────────────
  @Post('jobs/:id/offers')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Submit an offer on a job', description: 'The authenticated user (a supplier) quotes a price and optional availability on the given job.' })
  @ApiParam({ name: 'id', description: 'Job ID' })
  @ApiResponse({ status: 201, description: 'The created offer.', schema: OFFER_SCHEMA })
  createOffer(@Param('id') jobId: string, @Req() req: any, @Body() dto: CreateOfferDto) {
    return this.service.createOffer(req.user.id, jobId, dto);
  }

  @Get('jobs/:id/offers')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List offers on a job', description: "Only the job's customer can call this. Returns every offer with the supplier's reputation (rating, review count, jobs completed) so quotes can be compared." })
  @ApiParam({ name: 'id', description: 'Job ID' })
  @ApiResponse({ status: 200, description: 'Array of offers.', schema: { type: 'array', items: OFFER_SCHEMA } })
  listOffers(@Param('id') jobId: string, @Req() req: any) {
    return this.service.listOffersForJob(req.user.id, jobId);
  }

  @Get('offers/:id')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get a single offer', description: 'Returns one offer. Caller must be either the job customer or the offering supplier.' })
  @ApiParam({ name: 'id', description: 'Offer ID' })
  @ApiResponse({ status: 200, description: 'The offer.', schema: OFFER_SCHEMA })
  getOffer(@Param('id') id: string, @Req() req: any) {
    return this.service.getOfferDto(req.user.id, id);
  }

  @Post('offers/:id/accept')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Accept an offer', description: "The job's customer accepts a supplier's offer. Does not move money — see POST /marketplace/offers/:id/authorize for that." })
  @ApiParam({ name: 'id', description: 'Offer ID' })
  @ApiResponse({ status: 200, description: 'The updated offer.', schema: OFFER_SCHEMA })
  acceptOffer(@Param('id') offerId: string, @Req() req: any) {
    return this.service.acceptOffer(req.user.id, offerId);
  }

  @Post('offers/:id/decline')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Decline an offer', description: "The job's customer declines a supplier's offer." })
  @ApiParam({ name: 'id', description: 'Offer ID' })
  @ApiResponse({ status: 200, description: 'The updated offer.', schema: OFFER_SCHEMA })
  declineOffer(@Param('id') offerId: string, @Req() req: any) {
    return this.service.declineOffer(req.user.id, offerId);
  }

  // ── Threads / messages (Step 4) ──────────────────────────────────
  @Get('threads')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "List the caller's marketplace message threads", description: 'One row per conversation the authenticated user is part of (as customer or supplier), with the other party, last message preview and unread count.' })
  @ApiResponse({ status: 200, description: 'Array of threads.', schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, jobId: { type: 'string' }, jobTitle: { type: 'string' }, jobCategoryLabel: { type: 'string' }, role: { type: 'string', enum: ['customer', 'supplier'] }, otherPartyName: { type: 'string' }, otherPartyInitials: { type: 'string' }, lastMessageBody: { type: 'string', nullable: true }, lastMessageAt: { type: 'string', nullable: true }, unreadCount: { type: 'number' } } } } })
  listThreads(@Req() req: any) {
    return this.messages.listThreads(req.user.id);
  }

  @Get('threads/:id')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get a marketplace thread with its messages', description: 'Caller must be a participant. Returns full message history for the thread.' })
  @ApiParam({ name: 'id', description: 'Thread ID' })
  @ApiResponse({ status: 200, description: 'The thread with its messages.', schema: { type: 'object', properties: { id: { type: 'string' }, jobId: { type: 'string' }, jobTitle: { type: 'string' }, jobCategoryLabel: { type: 'string' }, role: { type: 'string', enum: ['customer', 'supplier'] }, otherPartyName: { type: 'string' }, otherPartyInitials: { type: 'string' }, messages: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, senderId: { type: 'string' }, body: { type: 'string' }, createdAt: { type: 'string' }, isMine: { type: 'boolean' } } } } } } })
  getThread(@Param('id') id: string, @Req() req: any) {
    return this.messages.getThread(req.user.id, id);
  }

  @Post('threads/:id/messages')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Send a marketplace message', description: 'Posts a text message into the thread as the authenticated user. Caller must be a participant.' })
  @ApiParam({ name: 'id', description: 'Thread ID' })
  @ApiResponse({ status: 201, description: 'The created message.', schema: { type: 'object', properties: { id: { type: 'string' }, senderId: { type: 'string' }, body: { type: 'string' }, createdAt: { type: 'string' }, isMine: { type: 'boolean' } } } })
  sendMessage(@Param('id') id: string, @Req() req: any, @Body() dto: SendMessageDto) {
    return this.messages.sendMessage(req.user.id, id, dto);
  }

  @Post('threads/:id/read')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Mark a marketplace thread read', description: 'Marks every unread message in the thread as read for the authenticated user.' })
  @ApiParam({ name: 'id', description: 'Thread ID' })
  @ApiResponse({ status: 200, description: 'Number of messages marked read.', schema: { type: 'object', properties: { marked: { type: 'number' } } } })
  markRead(@Param('id') id: string, @Req() req: any) {
    return this.messages.markRead(req.user.id, id);
  }

  // Supplier flow: opening a job and tapping "Message customer". The
  // current user is the supplier; the job's customer is derived from
  // the job record.
  @Post('jobs/:jobId/thread')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Open (or reuse) a thread about a job', description: "Supplier flow: opens a message thread with the job's customer, or returns the existing one if already open." })
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  @ApiResponse({ status: 200, description: 'The thread with its messages.', schema: { type: 'object', properties: { id: { type: 'string' }, jobId: { type: 'string' } } } })
  openThreadForJob(@Param('jobId') jobId: string, @Req() req: any) {
    return this.messages.getOrCreateThread(req.user.id, jobId, req.user.id);
  }

  // Customer flow: looking at an offer and tapping "Message". We look
  // up the offer to derive (jobId, supplierId); the customer is
  // implicit (the job's owner).
  @Post('offers/:offerId/thread')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Open (or reuse) a thread about an offer', description: "Customer flow: opens a message thread with the offer's supplier, or returns the existing one if already open." })
  @ApiParam({ name: 'offerId', description: 'Offer ID' })
  @ApiResponse({ status: 200, description: 'The thread with its messages.', schema: { type: 'object', properties: { id: { type: 'string' }, jobId: { type: 'string' } } } })
  async openThreadForOffer(@Param('offerId') offerId: string, @Req() req: any) {
    const offer = await this.service.getOfferOrThrow(offerId);
    return this.messages.getOrCreateThread(req.user.id, offer.jobId, offer.supplierId);
  }

  // ── Escrow / payments (Step 5) ───────────────────────────────────
  @Throttle(ESCROW_THROTTLE)
  @Post('offers/:id/authorize')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Authorise escrow payment for an accepted offer', description: "The customer commits to the offer: creates a Stripe PaymentIntent for the offer price plus platform fee (10%) and a pending payment row, in one transaction. Throttled to 10 requests/minute per IP." })
  @ApiParam({ name: 'id', description: 'Offer ID' })
  @ApiResponse({ status: 200, description: 'The pending payment and a Stripe client secret to confirm it with.', schema: { type: 'object', properties: { payment: PAYMENT_SCHEMA, clientSecret: { type: 'string' } } } })
  authorizeOffer(@Param('id') offerId: string, @Req() req: any) {
    return this.escrow.authorizeOffer(req.user.id, offerId);
  }

  @Post('payments/:id/confirm')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Confirm escrow payment held', description: 'Marks the payment as held in escrow once the Stripe PaymentIntent has succeeded, and drops a system message into the job thread confirming funds are held.' })
  @ApiParam({ name: 'id', description: 'Payment ID' })
  @ApiResponse({ status: 200, description: 'The updated payment.', schema: PAYMENT_SCHEMA })
  async confirmPayment(@Param('id') paymentId: string, @Req() req: any) {
    const payment = await this.escrow.confirmPayment(req.user.id, paymentId);
    // Drop a system message into the thread so the supplier sees the
    // "funds held in escrow" event in their chat. Best-effort — a
    // failure here shouldn't block the confirm.
    try {
      const thread = await this.messages.getOrCreateThread(req.user.id, payment.jobId, payment.supplierId);
      await this.messages.sendMessage(req.user.id, thread.id, {
        body: `🛡 Funds authorised - £${(payment.amount / 100).toLocaleString('en-GB')} held in UProtect escrow until the job's verified complete.`,
      });
    } catch { /* ignore */ }
    return payment;
  }

  @Post('payments/:id/release')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Release escrowed payment to the supplier', description: 'The customer confirms the job is complete and releases the held funds to the supplier; marks the job complete and posts a system message to the thread.' })
  @ApiParam({ name: 'id', description: 'Payment ID' })
  @ApiResponse({ status: 200, description: 'The updated payment.', schema: PAYMENT_SCHEMA })
  async releasePayment(@Param('id') paymentId: string, @Req() req: any) {
    const payment = await this.escrow.releasePayment(req.user.id, paymentId);
    try {
      const thread = await this.messages.getOrCreateThread(req.user.id, payment.jobId, payment.supplierId);
      await this.messages.sendMessage(req.user.id, thread.id, {
        body: `✅ Customer released the funds - £${(payment.amount / 100).toLocaleString('en-GB')} payable to you. Job marked complete.`,
      });
    } catch { /* ignore */ }
    return payment;
  }

  @Get('payments/:id')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get an escrow payment', description: 'Returns one payment. Caller must be the customer or supplier on it.' })
  @ApiParam({ name: 'id', description: 'Payment ID' })
  @ApiResponse({ status: 200, description: 'The payment.', schema: PAYMENT_SCHEMA })
  getPayment(@Param('id') paymentId: string, @Req() req: any) {
    return this.escrow.getPayment(req.user.id, paymentId);
  }

  // Evidence photos posted against the contract. Body shape:
  //   { photos: ['/uploads/job-photos/abc.jpg', …] }
  // Either the customer or the supplier can append (their respective
  // before/after shots). Validated against /uploads/ prefix to keep
  // arbitrary external URLs out of the column.
  @Post('payments/:id/evidence')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Add evidence photos to a payment', description: "Appends before/after photo URLs (each must already be in the job-photos upload bucket) to the payment's evidence trail. Either the customer or supplier may add their own." })
  @ApiParam({ name: 'id', description: 'Payment ID' })
  @ApiResponse({ status: 200, description: 'The updated payment.', schema: PAYMENT_SCHEMA })
  addEvidence(
    @Param('id') paymentId: string,
    @Req() req: any,
    @Body() body: AddEvidenceDto,
  ) {
    return this.escrow.addEvidencePhotos(req.user.id, paymentId, body?.photos ?? []);
  }

  // Contract page bundle — job + payment + offer + parties + thread.
  @Get('jobs/:id/contract')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get the contract bundle for a job', description: 'Single round-trip payload for the contract screen: job, payment, accepted offer, both parties (with reputation) and the viewer\'s role.' })
  @ApiParam({ name: 'id', description: 'Job ID' })
  @ApiResponse({ status: 200, description: 'Bundled contract data.', schema: { type: 'object', properties: { job: { type: 'object' }, payment: PAYMENT_SCHEMA, offer: { type: 'object' }, parties: { type: 'object' }, viewerRole: { type: 'string', enum: ['customer', 'supplier'] } } } })
  getContract(@Param('id') jobId: string, @Req() req: any) {
    return this.service.getContract(req.user.id, jobId);
  }

  // Used by the offers page to know whether to show the receipt link
  // instead of the accept/decline buttons.
  @Get('jobs/:id/payment')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get the payment for a job, if any', description: "Returns the job's payment (if one has been authorised) or null — used to decide whether to show the receipt link or the accept/decline buttons." })
  @ApiParam({ name: 'id', description: 'Job ID' })
  @ApiResponse({ status: 200, description: 'The payment, or null if none exists yet.', schema: { ...PAYMENT_SCHEMA, nullable: true } })
  getPaymentForJob(@Param('id') jobId: string, @Req() req: any) {
    return this.escrow.getPaymentForJob(req.user.id, jobId);
  }

  // ── Reviews + earnings (Step 6) ──────────────────────────────────
  @Post('jobs/:id/review')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Leave a review on a completed job', description: 'One review per direction (customer→supplier or supplier→customer) per job; direction is derived from the job record so the reviewer cannot misrepresent their side.' })
  @ApiParam({ name: 'id', description: 'Job ID' })
  @ApiResponse({ status: 201, description: 'The created review.', schema: REVIEW_SCHEMA })
  createReview(@Param('id') jobId: string, @Req() req: any, @Body() dto: CreateReviewDto) {
    return this.reviews.createReview(req.user.id, jobId, dto);
  }

  @Get('users/:id/reviews')
  @ApiOperation({ summary: "List a user's marketplace reviews", description: "Public. Every review left for the given user, as either customer or supplier." })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'Array of reviews.', schema: { type: 'array', items: REVIEW_SCHEMA } })
  listUserReviews(@Param('id') userId: string) {
    // Public — anyone can see reviews of a given user.
    return this.reviews.listForUser(userId);
  }

  @Get('users/:id/stats')
  @ApiOperation({ summary: "Get a user's marketplace reputation", description: 'Public. Review count, average rating, jobs completed (as supplier) and jobs posted (as customer).' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'Reputation summary.', schema: { type: 'object', properties: { userId: { type: 'string' }, reviewCount: { type: 'number' }, averageRating: { type: 'number', nullable: true }, jobsCompleted: { type: 'number' }, jobsPosted: { type: 'number' } } } })
  getUserStats(@Param('id') userId: string) {
    return this.reviews.getStats(userId);
  }

  @Get('me/earnings')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get the caller's marketplace earnings summary", description: 'Total earned, payout count/average, and currently-held (pending) earnings for the authenticated supplier.' })
  @ApiResponse({ status: 200, description: 'Earnings summary.', schema: { type: 'object', properties: { totalEarned: { type: 'number', description: 'pence' }, payoutCount: { type: 'number' }, averagePayout: { type: 'number', description: 'pence' }, pendingHeld: { type: 'number', description: 'pence' }, pendingCount: { type: 'number' } } } })
  getEarnings(@Req() req: any) {
    return this.reviews.getEarnings(req.user.id);
  }

  @Get('me/payouts')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "List the caller's marketplace payouts", description: 'Every held or released payment where the authenticated user is the supplier, most recently released first.' })
  @ApiResponse({ status: 200, description: 'Array of payouts.', schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, jobId: { type: 'string' }, jobTitle: { type: 'string' }, jobCategoryLabel: { type: 'string' }, customerName: { type: 'string' }, customerInitials: { type: 'string' }, amount: { type: 'number' }, status: { type: 'string', enum: ['held', 'released'] }, releasedAt: { type: 'string', nullable: true }, heldAt: { type: 'string', nullable: true } } } } })
  listPayouts(@Req() req: any) {
    return this.reviews.listMyPayouts(req.user.id);
  }
}
