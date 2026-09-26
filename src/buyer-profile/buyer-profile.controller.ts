import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  Request,
  Headers,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createUploadStorage, DOCUMENT_MIME_TYPES } from '../common/storage';
import {
  BuyerProfileService,
  UpdateBuyerProfileDto,
  CreateShareDto,
  SignProfileDto,
} from './buyer-profile.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { timingSafeStringEqual } from '../common/timing-safe-equal';

@Controller('buyer-profile')
export class BuyerProfileController {
  private readonly logger = new Logger(BuyerProfileController.name);

  constructor(private buyerProfileService: BuyerProfileService) {}

  // GET /buyer-profile — current user's buyer profile (may be null)
  @UseGuards(JwtAuthGuard)
  @Get()
  async getMine(@Request() req) {
    return this.buyerProfileService.getMine(req.user.id);
  }

  // POST /buyer-profile/ai-story  body: { existingDraft?: string }
  @UseGuards(JwtAuthGuard)
  @Post('ai-story')
  async aiStory(@Request() req, @Body('existingDraft') existingDraft?: string) {
    return this.buyerProfileService.generateStory(req.user.id, existingDraft);
  }

  // PATCH /buyer-profile — upsert partial fields as the user progresses through the build
  @UseGuards(JwtAuthGuard)
  @Patch()
  async update(@Request() req, @Body() dto: UpdateBuyerProfileDto) {
    return this.buyerProfileService.upsert(req.user.id, dto);
  }

  // POST /buyer-profile/documents/:kind  (kind: "funds" | "mortgage")
  // Uploads to the same private "documents" bucket the user's own document
  // vault uses, and marks the profile's review status "pending" — the
  // "✓ VERIFIED" badge only flips on once an admin approves it via the
  // review queue below, never just from uploading.
  @UseGuards(JwtAuthGuard)
  @Post('documents/:kind')
  @UseInterceptors(
    FileInterceptor('file', createUploadStorage({ bucket: 'documents', maxMb: 20, mimeAllowList: DOCUMENT_MIME_TYPES })),
  )
  async uploadReviewDocument(
    @Request() req,
    @Param('kind') kind: string,
    @UploadedFile() file: any,
  ) {
    return this.buyerProfileService.uploadReviewDocument(req.user.id, kind, file);
  }

  // ── Admin review queue ───────────────────────────────────────────────
  // Requires BOTH the shared x-admin-secret AND a JWT belonging to a user
  // with isAdmin=true — the secret alone used to be the entire access
  // control for approving KYC/AML buyer documents (higher-value than
  // passport/property deletion elsewhere in the admin surface), with no
  // way to tell which operator acted. isAdmin is granted only via
  // POST /admin/users/:email/admin-role (also admin-secret-gated) - see
  // AdminController (security review 2026-09-22, M6).
  private guardAdmin(secret: string | undefined, req: any) {
    const expected = process.env.ADMIN_SECRET;
    if (!expected || !timingSafeStringEqual(secret, expected)) {
      throw new ForbiddenException('Invalid or missing admin secret');
    }
    if (!req.user?.isAdmin) {
      throw new ForbiddenException('This account is not an admin');
    }
  }

  // GET /buyer-profile/admin/review-queue
  @Get('admin/review-queue')
  @UseGuards(JwtAuthGuard)
  async listReviewQueue(
    @Headers('x-admin-secret') secret: string,
    @Request() req: any,
  ) {
    this.guardAdmin(secret, req);
    return this.buyerProfileService.listPendingReviews();
  }

  // POST /buyer-profile/admin/review/:profileId  body: { kind, decision: "approve"|"reject" }
  @Post('admin/review/:profileId')
  @UseGuards(JwtAuthGuard)
  async reviewDocument(
    @Headers('x-admin-secret') secret: string,
    @Param('profileId') profileId: string,
    @Body('kind') kind: string,
    @Body('decision') decision: string,
    @Request() req: any,
  ) {
    this.guardAdmin(secret, req);
    this.logger.warn(
      `admin review: profileId=${profileId} kind=${kind} decision=${decision} by=${req.user.id}`,
    );
    return this.buyerProfileService.reviewDocument(profileId, kind, decision);
  }

  // POST /buyer-profile/publish — marks the profile as published.
  @UseGuards(JwtAuthGuard)
  @Post('publish')
  async publish(@Request() req, @Body() dto: UpdateBuyerProfileDto) {
    if (dto && Object.keys(dto).length > 0) {
      await this.buyerProfileService.upsert(req.user.id, dto);
    }
    return this.buyerProfileService.publish(req.user.id);
  }

  // DELETE /buyer-profile
  @UseGuards(JwtAuthGuard)
  @Delete()
  async remove(@Request() req) {
    return this.buyerProfileService.remove(req.user.id);
  }

  // ── Digital signature ────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Post('sign')
  async sign(@Request() req, @Body() dto: SignProfileDto) {
    return this.buyerProfileService.signProfile(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sign/clear')
  async clearSign(@Request() req) {
    return this.buyerProfileService.clearSignature(req.user.id);
  }

  // ── Tier upgrade (Stripe) ─────────────────────────────────────────────────
  // POST /buyer-profile/tier/checkout  body: { tier: "VERIFIED" }
  @UseGuards(JwtAuthGuard)
  @Post('tier/checkout')
  async createTierCheckout(
    @Request() req,
    @Body() body: { tier?: string },
  ) {
    if (!body?.tier) throw new BadRequestException('tier is required');
    return this.buyerProfileService.createTierPaymentIntent(
      req.user.id,
      body.tier,
    );
  }

  // POST /buyer-profile/tier/confirm  body: { paymentIntentId }
  @UseGuards(JwtAuthGuard)
  @Post('tier/confirm')
  async confirmTier(
    @Request() req,
    @Body() body: { paymentIntentId?: string },
  ) {
    if (!body?.paymentIntentId)
      throw new BadRequestException('paymentIntentId is required');
    return this.buyerProfileService.confirmTierPayment(
      req.user.id,
      body.paymentIntentId,
    );
  }

  // ── Activity ticker (public — no auth) ────────────────────────────────────
  // GET /buyer-profile/stats/activity
  @Get('stats/activity')
  async getActivity() {
    return this.buyerProfileService.getActivityStats();
  }

  // ── Sharing ───────────────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('shares')
  async listShares(@Request() req) {
    return this.buyerProfileService.listShares(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('shares')
  async createShare(
    @Request() req,
    @Body() dto: CreateShareDto,
    @Headers('origin') origin: string | undefined,
  ) {
    return this.buyerProfileService.createShare(req.user.id, dto, origin);
  }

  @UseGuards(JwtAuthGuard)
  @Post('shares/:id/revoke')
  async revokeShare(@Request() req, @Param('id') id: string) {
    return this.buyerProfileService.revokeShare(req.user.id, id);
  }

  // GET /buyer-profile/public/:token — used by the read-only /shared-buyer
  // route on the frontend. No auth; scope-filtered; 410 on revoke/expiry.
  @Get('public/:token')
  async getPublicShare(@Param('token') token: string) {
    return this.buyerProfileService.getPublicShare(token);
  }
}
