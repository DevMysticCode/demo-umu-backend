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
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { MarketplaceService } from './marketplace.service';
import { MarketplaceMessagesService } from './messages.service';
import { EscrowService } from './escrow.service';
import { ReviewsService } from './reviews.service';
import { CreateJobDto } from './dto/create-job.dto';
import { CreateOfferDto } from './dto/create-offer.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { CreateReviewDto } from './dto/create-review.dto';

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
    private jwtService: JwtService, // optional auth on job detail — see getJob()
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
  listCategories() {
    return this.service.listCategories();
  }

  @Get('jobs')
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
  @UseGuards(JwtAuthGuard)
  listMyJobs(@Req() req: any) {
    return this.service.listMyJobs(req.user.id);
  }

  @Get('me/stats')
  @UseGuards(JwtAuthGuard)
  getStats(@Req() req: any) {
    return this.service.getStats(req.user.id);
  }

  @Post('jobs')
  @UseGuards(JwtAuthGuard)
  createJob(@Req() req: any, @Body() dto: CreateJobDto) {
    return this.service.createJob(req.user.id, dto);
  }

  // Photo upload — multipart, one file at a time. The wizard calls
  // this per photo as the user picks them so we can show real previews.
  @Post('upload-photo')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dest = join(process.cwd(), 'uploads', 'job-photos');
          if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
          cb(null, dest);
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB per photo
    }),
  )
  uploadPhoto(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('No file uploaded');
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException('Only image files are allowed (jpg, png, webp, heic)');
    }
    return { url: `/uploads/job-photos/${file.filename}` };
  }

  // Param routes last so they don't capture /me or /upload-photo.
  @Get('jobs/:id')
  getJob(@Param('id') id: string, @Req() req: any) {
    return this.service.getJob(id, this.peekUserId(req));
  }

  // ── Offers ───────────────────────────────────────────────────────
  @Post('jobs/:id/offers')
  @UseGuards(JwtAuthGuard)
  createOffer(@Param('id') jobId: string, @Req() req: any, @Body() dto: CreateOfferDto) {
    return this.service.createOffer(req.user.id, jobId, dto);
  }

  @Get('jobs/:id/offers')
  @UseGuards(JwtAuthGuard)
  listOffers(@Param('id') jobId: string, @Req() req: any) {
    return this.service.listOffersForJob(req.user.id, jobId);
  }

  @Get('offers/:id')
  @UseGuards(JwtAuthGuard)
  getOffer(@Param('id') id: string, @Req() req: any) {
    return this.service.getOfferDto(req.user.id, id);
  }

  @Post('offers/:id/accept')
  @UseGuards(JwtAuthGuard)
  acceptOffer(@Param('id') offerId: string, @Req() req: any) {
    return this.service.acceptOffer(req.user.id, offerId);
  }

  @Post('offers/:id/decline')
  @UseGuards(JwtAuthGuard)
  declineOffer(@Param('id') offerId: string, @Req() req: any) {
    return this.service.declineOffer(req.user.id, offerId);
  }

  // ── Threads / messages (Step 4) ──────────────────────────────────
  @Get('threads')
  @UseGuards(JwtAuthGuard)
  listThreads(@Req() req: any) {
    return this.messages.listThreads(req.user.id);
  }

  @Get('threads/:id')
  @UseGuards(JwtAuthGuard)
  getThread(@Param('id') id: string, @Req() req: any) {
    return this.messages.getThread(req.user.id, id);
  }

  @Post('threads/:id/messages')
  @UseGuards(JwtAuthGuard)
  sendMessage(@Param('id') id: string, @Req() req: any, @Body() dto: SendMessageDto) {
    return this.messages.sendMessage(req.user.id, id, dto);
  }

  @Post('threads/:id/read')
  @UseGuards(JwtAuthGuard)
  markRead(@Param('id') id: string, @Req() req: any) {
    return this.messages.markRead(req.user.id, id);
  }

  // Supplier flow: opening a job and tapping "Message customer". The
  // current user is the supplier; the job's customer is derived from
  // the job record.
  @Post('jobs/:jobId/thread')
  @UseGuards(JwtAuthGuard)
  openThreadForJob(@Param('jobId') jobId: string, @Req() req: any) {
    return this.messages.getOrCreateThread(req.user.id, jobId, req.user.id);
  }

  // Customer flow: looking at an offer and tapping "Message". We look
  // up the offer to derive (jobId, supplierId); the customer is
  // implicit (the job's owner).
  @Post('offers/:offerId/thread')
  @UseGuards(JwtAuthGuard)
  async openThreadForOffer(@Param('offerId') offerId: string, @Req() req: any) {
    const offer = await this.service.getOfferOrThrow(offerId);
    return this.messages.getOrCreateThread(req.user.id, offer.jobId, offer.supplierId);
  }

  // ── Escrow / payments (Step 5) ───────────────────────────────────
  @Post('offers/:id/authorize')
  @UseGuards(JwtAuthGuard)
  authorizeOffer(@Param('id') offerId: string, @Req() req: any) {
    return this.escrow.authorizeOffer(req.user.id, offerId);
  }

  @Post('payments/:id/confirm')
  @UseGuards(JwtAuthGuard)
  async confirmPayment(@Param('id') paymentId: string, @Req() req: any) {
    const payment = await this.escrow.confirmPayment(req.user.id, paymentId);
    // Drop a system message into the thread so the supplier sees the
    // "funds held in escrow" event in their chat. Best-effort — a
    // failure here shouldn't block the confirm.
    try {
      const thread = await this.messages.getOrCreateThread(req.user.id, payment.jobId, payment.supplierId);
      await this.messages.sendMessage(req.user.id, thread.id, {
        body: `🛡 Funds authorised — £${(payment.amount / 100).toLocaleString('en-GB')} held in UProtect escrow until the job's verified complete.`,
      });
    } catch { /* ignore */ }
    return payment;
  }

  @Post('payments/:id/release')
  @UseGuards(JwtAuthGuard)
  async releasePayment(@Param('id') paymentId: string, @Req() req: any) {
    const payment = await this.escrow.releasePayment(req.user.id, paymentId);
    try {
      const thread = await this.messages.getOrCreateThread(req.user.id, payment.jobId, payment.supplierId);
      await this.messages.sendMessage(req.user.id, thread.id, {
        body: `✅ Customer released the funds — £${(payment.amount / 100).toLocaleString('en-GB')} payable to you. Job marked complete.`,
      });
    } catch { /* ignore */ }
    return payment;
  }

  @Get('payments/:id')
  @UseGuards(JwtAuthGuard)
  getPayment(@Param('id') paymentId: string, @Req() req: any) {
    return this.escrow.getPayment(req.user.id, paymentId);
  }

  // Used by the offers page to know whether to show the receipt link
  // instead of the accept/decline buttons.
  @Get('jobs/:id/payment')
  @UseGuards(JwtAuthGuard)
  getPaymentForJob(@Param('id') jobId: string, @Req() req: any) {
    return this.escrow.getPaymentForJob(req.user.id, jobId);
  }

  // ── Reviews + earnings (Step 6) ──────────────────────────────────
  @Post('jobs/:id/review')
  @UseGuards(JwtAuthGuard)
  createReview(@Param('id') jobId: string, @Req() req: any, @Body() dto: CreateReviewDto) {
    return this.reviews.createReview(req.user.id, jobId, dto);
  }

  @Get('users/:id/reviews')
  listUserReviews(@Param('id') userId: string) {
    // Public — anyone can see reviews of a given user.
    return this.reviews.listForUser(userId);
  }

  @Get('users/:id/stats')
  getUserStats(@Param('id') userId: string) {
    return this.reviews.getStats(userId);
  }

  @Get('me/earnings')
  @UseGuards(JwtAuthGuard)
  getEarnings(@Req() req: any) {
    return this.reviews.getEarnings(req.user.id);
  }

  @Get('me/payouts')
  @UseGuards(JwtAuthGuard)
  listPayouts(@Req() req: any) {
    return this.reviews.listMyPayouts(req.user.id);
  }
}
