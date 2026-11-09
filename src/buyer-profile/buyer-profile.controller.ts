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
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiParam, ApiHeader } from '@nestjs/swagger';
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
  @ApiOperation({ summary: "Get my buyer profile", description: "Returns the signed-in user's own Buyer Profile row, or null if they haven't started building one yet. idVerified is computed live from User.kycStatus rather than read from the (unused) stored column." })
  @ApiResponse({ status: 200, description: 'The buyer profile, or null if none exists yet.', schema: { type: 'object', nullable: true, properties: { id: { type: 'string' }, userId: { type: 'string' }, publicRef: { type: 'string' }, tier: { type: 'string', example: 'UNVERIFIED' }, idDocumentType: { type: 'string', nullable: true }, idVerified: { type: 'boolean' }, fundsType: { type: 'string', nullable: true }, fundsAmount: { type: 'integer', nullable: true }, fundsVerified: { type: 'boolean' }, chainPosition: { type: 'string', nullable: true }, strengthScore: { type: 'integer' }, published: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Get()
  async getMine(@Request() req) {
    return this.buyerProfileService.getMine(req.user.id);
  }

  // POST /buyer-profile/ai-story  body: { existingDraft?: string }
  @ApiOperation({ summary: 'Generate an AI-drafted buyer intro', description: "Uses the caller's own saved profile signals (chain position, timeline, funds, etc.) to draft, or rewrite an existing draft of, a short 80-120 word intro a buyer can send to a seller. Never invents facts beyond what is already saved on the profile." })
  @ApiResponse({ status: 201, description: 'The generated/rewritten text.', schema: { type: 'object', properties: { text: { type: 'string' } } } })
  @ApiResponse({ status: 400, description: 'The AI did not return a usable draft - try again.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Post('ai-story')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        existingDraft: { type: 'string', nullable: true },
      },
    },
  })
  async aiStory(@Request() req, @Body('existingDraft') existingDraft?: string) {
    return this.buyerProfileService.generateStory(req.user.id, existingDraft);
  }

  // PATCH /buyer-profile — upsert partial fields as the user progresses through the build
  @ApiOperation({ summary: 'Create or update my buyer profile', description: 'Upserts whichever fields are supplied (identity, funds, chain position, etc.) as the buyer progresses through the builder. Recomputes strengthScore against the merged result on every call; mints a publicRef short-code on first creation.' })
  @ApiResponse({ status: 200, description: 'The created/updated buyer profile.', schema: { type: 'object', properties: { id: { type: 'string' }, userId: { type: 'string' }, publicRef: { type: 'string' }, strengthScore: { type: 'integer' } } } })
  @ApiBody({ schema: { type: 'object', description: 'All fields optional - only supplied fields are upserted', properties: {
    tier: { type: 'string', nullable: true }, idDocumentType: { type: 'string', nullable: true }, idDocumentUrl: { type: 'string', nullable: true },
    fundsType: { type: 'string', nullable: true }, fundsAmount: { type: 'number', nullable: true }, fundsDocumentUrl: { type: 'string', nullable: true },
    chainPosition: { type: 'string', nullable: true }, solicitorStatus: { type: 'string', nullable: true }, timeline: { type: 'string', nullable: true },
    propertyType: { type: 'string', nullable: true }, statement: { type: 'string', nullable: true }, completedSteps: { type: 'integer', nullable: true },
  } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @ApiBearerAuth('access-token')
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
  @ApiOperation({ summary: 'Upload a proof-of-funds or mortgage AIP document', description: "Stores the file in the private documents bucket and sets that document's review status to \"pending\" - the verified badge only flips on once an admin approves it via the review queue, never just from uploading." })
  @ApiParam({ name: 'kind', description: 'Which document is being uploaded.', enum: ['funds', 'mortgage'] })
  @ApiResponse({ status: 201, description: 'Upload accepted, pending admin review.', schema: { type: 'object', properties: { fileUrl: { type: 'string' }, reviewStatus: { type: 'string', example: 'pending' },
    profile: { type: 'object', description: 'The full BuyerProfile row after the upsert - the fields this call actually changes are shown below; the rest of the ~60-column row (identity, deposit, chain, affordability, etc.) is unchanged and documented on PATCH /buyer-profile above.', properties: {
      id: { type: 'string' }, userId: { type: 'string' }, publicRef: { type: 'string' }, strengthScore: { type: 'integer' },
      fundsDocumentUrl: { type: 'string', nullable: true }, fundsReviewStatus: { type: 'string', nullable: true, example: 'pending' }, fundsVerified: { type: 'boolean' }, fundsVerifiedAt: { type: 'string', format: 'date-time', nullable: true },
      mortgageAipUrl: { type: 'string', nullable: true }, mortgageAipReviewStatus: { type: 'string', nullable: true, example: 'pending' }, mortgageAipVerified: { type: 'boolean' }, mortgageAipVerifiedAt: { type: 'string', format: 'date-time', nullable: true },
    } },
  } } })
  @ApiResponse({ status: 400, description: 'No file provided, or kind is not "funds"/"mortgage".' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Post('documents/:kind')
  @UseInterceptors(
    FileInterceptor('file', createUploadStorage({ bucket: 'documents', maxMb: 20, mimeAllowList: DOCUMENT_MIME_TYPES })),
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
  @ApiOperation({ summary: 'List buyer documents awaiting admin review', description: 'Admin-only (requires both the x-admin-secret header and a JWT for a user with isAdmin=true). Returns one row per pending document (funds proof or mortgage AIP), flattened across all buyer profiles.' })
  @ApiResponse({ status: 200, description: 'Pending review items - every pending document, not paginated.', schema: { type: 'array', items: { type: 'object', properties: { profileId: { type: 'string' }, kind: { type: 'string', enum: ['funds', 'mortgage'] }, buyerName: { type: 'string' }, email: { type: 'string' }, documentUrl: { type: 'string' } } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @ApiResponse({ status: 403, description: 'Invalid/missing x-admin-secret, or the caller is not an admin.' })
  @ApiHeader({ name: 'x-admin-secret', description: 'Shared admin secret - required in addition to a JWT for a user with isAdmin=true.' })
  @Get('admin/review-queue')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async listReviewQueue(
    @Headers('x-admin-secret') secret: string,
    @Request() req: any,
  ) {
    this.guardAdmin(secret, req);
    return this.buyerProfileService.listPendingReviews();
  }

  // POST /buyer-profile/admin/review/:profileId  body: { kind, decision: "approve"|"reject" }
  @ApiOperation({ summary: "Approve or reject a buyer's uploaded document", description: 'Admin-only. Approve flips the matching verified flag and timestamp on; reject clears the review status so the user has to re-submit.' })
  @ApiParam({ name: 'profileId', description: 'The BuyerProfile id (not the user id).' })
  @ApiResponse({ status: 201, description: 'The updated buyer profile, with a freshly recomputed strengthScore.', schema: { type: 'object', properties: { id: { type: 'string' }, strengthScore: { type: 'integer' } } } })
  @ApiResponse({ status: 400, description: 'kind is not "funds"/"mortgage", or decision is not "approve"/"reject".' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @ApiResponse({ status: 403, description: 'Invalid/missing x-admin-secret, or the caller is not an admin.' })
  @ApiResponse({ status: 404, description: 'No buyer profile with that id.' })
  @ApiHeader({ name: 'x-admin-secret', description: 'Shared admin secret - required in addition to a JWT for a user with isAdmin=true.' })
  @Post('admin/review/:profileId')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        decision: { type: 'string', enum: ['approve', 'reject'] },
      },
      required: ['kind', 'decision'],
    },
  })
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
  @ApiOperation({ summary: 'Publish my buyer profile', description: "Marks the profile published once the four required steps (identity document, funds type, budget, chain position) are all present - rejects with 400 naming whichever are still missing. Publishing by itself does not share the profile with anyone; it only unlocks the ability to create a share link." })
  @ApiResponse({ status: 201, description: 'The published buyer profile.', schema: { type: 'object', properties: { published: { type: 'boolean' }, publishedAt: { type: 'string', format: 'date-time' } } } })
  @ApiResponse({ status: 400, description: 'Required steps are missing, or no profile exists yet.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @ApiBody({ required: false, schema: { type: 'object', description: 'Optional - any fields supplied here are upserted first, same shape as PATCH /buyer-profile', properties: {
    idDocumentType: { type: 'string', nullable: true }, fundsType: { type: 'string', nullable: true }, fundsAmount: { type: 'number', nullable: true }, chainPosition: { type: 'string', nullable: true },
  } } })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Post('publish')
  async publish(@Request() req, @Body() dto: UpdateBuyerProfileDto) {
    if (dto && Object.keys(dto).length > 0) {
      await this.buyerProfileService.upsert(req.user.id, dto);
    }
    return this.buyerProfileService.publish(req.user.id);
  }

  // DELETE /buyer-profile
  @ApiOperation({ summary: 'Delete my buyer profile', description: 'Permanently deletes the buyer profile row. Idempotent - returns a plain message rather than erroring if none exists.' })
  @ApiResponse({ status: 200, description: 'Deletion result.', schema: { type: 'object', properties: { message: { type: 'string' } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Delete()
  async remove(@Request() req) {
    return this.buyerProfileService.remove(req.user.id);
  }

  // ── Digital signature ────────────────────────────────────────────────────
  @ApiOperation({ summary: 'Sign my buyer profile', description: 'Saves a digital signature - either a canvas PNG data URL or a typed name - plus a server-generated signedAt timestamp. At least one of signatureData/signedName must be provided.' })
  @ApiResponse({ status: 201, description: 'The full BuyerProfile row (all ~60 columns) with its signature fields set; shown below are the signature-relevant fields plus identifiers.', schema: { type: 'object', properties: { id: { type: 'string' }, userId: { type: 'string' }, tier: { type: 'string' }, signatureData: { type: 'string', nullable: true, description: 'PNG data URL, if signed via canvas' }, signedName: { type: 'string', nullable: true }, signedAt: { type: 'string', format: 'date-time', nullable: true } } } })
  @ApiBody({ schema: { type: 'object', properties: {
    signatureData: { type: 'string', nullable: true, description: 'Canvas-drawn signature as a PNG data URL' },
    signedName: { type: 'string', nullable: true, description: 'Typed name, used as an alternative to a canvas signature' },
  } } })
  @ApiResponse({ status: 400, description: 'Neither signatureData nor signedName was provided.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @ApiResponse({ status: 404, description: 'No buyer profile exists yet - build one first.' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Post('sign')
  async sign(@Request() req, @Body() dto: SignProfileDto) {
    return this.buyerProfileService.signProfile(req.user.id, dto);
  }

  @ApiOperation({ summary: 'Clear my buyer profile signature', description: 'Wipes any previously saved signature data, name and timestamp.' })
  @ApiResponse({ status: 201, description: 'The full BuyerProfile row with its signature fields cleared; shown below are the signature-relevant fields plus identifiers.', schema: { type: 'object', properties: { id: { type: 'string' }, userId: { type: 'string' }, tier: { type: 'string' }, signatureData: { type: 'string', nullable: true, example: null }, signedName: { type: 'string', nullable: true, example: null }, signedAt: { type: 'string', format: 'date-time', nullable: true, example: null } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @ApiResponse({ status: 404, description: 'No buyer profile exists yet.' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Post('sign/clear')
  async clearSign(@Request() req) {
    return this.buyerProfileService.clearSignature(req.user.id);
  }

  // ── Tier upgrade (Stripe) ─────────────────────────────────────────────────
  // POST /buyer-profile/tier/checkout  body: { tier: "VERIFIED" }
  @ApiOperation({ summary: 'Start a buyer-tier upgrade payment', description: "Creates a one-off Stripe PaymentIntent for the paid \"Verified\" tier (£19.99, the only purchasable tier today). The frontend confirms the PaymentIntent client-side, then calls tier/confirm with the resulting id to actually flip the tier." })
  @ApiResponse({ status: 201, description: 'Stripe PaymentIntent details to confirm client-side.', schema: { type: 'object', properties: { clientSecret: { type: 'string' }, amount: { type: 'integer', description: 'GBP pence' }, tier: { type: 'string' } } } })
  @ApiResponse({ status: 400, description: 'tier is missing, or is not a purchasable tier (only "VERIFIED" today).' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Post('tier/checkout')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        tier: { type: 'string', example: 'VERIFIED' },
      },
      required: ['tier'],
    },
  })
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
  @ApiOperation({ summary: 'Confirm a buyer-tier upgrade payment', description: "Re-fetches the PaymentIntent from Stripe and verifies it actually succeeded, belongs to this user, and carries a valid target tier before flipping the profile's tier - never trusts the client's say-so alone." })
  @ApiResponse({ status: 201, description: 'The buyer profile with its tier upgraded.', schema: { type: 'object', properties: { tier: { type: 'string' }, strengthScore: { type: 'integer' } } } })
  @ApiResponse({ status: 400, description: 'Payment not completed, or does not match this user/tier.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Post('tier/confirm')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        paymentIntentId: { type: 'string' },
      },
      required: ['paymentIntentId'],
    },
  })
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
  @ApiOperation({ summary: 'Get buyer-verification activity stats', description: 'Public, no authentication required. Powers the "N buyers verified this week" ticker shown on the intro screen - counts of profiles published in the last 7 days and overall.' })
  @ApiResponse({ status: 200, description: 'Activity counts.', schema: { type: 'object', properties: { publishedLast7d: { type: 'integer' }, totalPublished: { type: 'integer' } } } })
  @Get('stats/activity')
  async getActivity() {
    return this.buyerProfileService.getActivityStats();
  }

  // ── Sharing ───────────────────────────────────────────────────────────────
  @ApiOperation({ summary: 'List my buyer-profile share links', description: 'All share links the caller has created for their own profile, most recent first.' })
  @ApiResponse({ status: 200, description: 'The share links - every one the caller has created, not paginated.', schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, token: { type: 'string' }, recipientName: { type: 'string', nullable: true }, recipientEmail: { type: 'string', nullable: true }, scope: { type: 'array', items: { type: 'string' } }, expiresAt: { type: 'string', format: 'date-time' }, revokedAt: { type: 'string', format: 'date-time', nullable: true } } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Get('shares')
  async listShares(@Request() req) {
    return this.buyerProfileService.listShares(req.user.id);
  }

  @ApiOperation({ summary: 'Create a buyer-profile share link', description: 'Requires the profile to already be published. Creates a time-limited (default 30 days, max 365) scoped share link, and emails the recipient a notification if an email address is given. The caller chooses exactly which categories (identity/deposit/sof/afford/credit/story) are included; defaults to all of them.' })
  @ApiResponse({ status: 201, description: 'The newly created share link.', schema: { type: 'object', properties: { id: { type: 'string' }, token: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' }, scope: { type: 'array', items: { type: 'string' } } } } })
  @ApiResponse({ status: 400, description: 'Profile is not published yet.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @ApiResponse({ status: 404, description: 'No buyer profile exists yet.' })
  @ApiBody({ schema: { type: 'object', properties: {
    recipientName: { type: 'string', nullable: true },
    recipientEmail: { type: 'string', nullable: true, format: 'email' },
    scope: { type: 'array', items: { type: 'string' }, nullable: true, description: 'Which categories to include; defaults to all (identity/deposit/sof/afford/credit/story)' },
    expiresInDays: { type: 'integer', nullable: true, description: 'Default 30, max 365' },
  } } })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Post('shares')
  async createShare(
    @Request() req,
    @Body() dto: CreateShareDto,
    @Headers('origin') origin: string | undefined,
  ) {
    return this.buyerProfileService.createShare(req.user.id, dto, origin);
  }

  @ApiOperation({ summary: 'Revoke a buyer-profile share link', description: 'Marks the given share link revoked immediately - any subsequent attempt to open it returns 410 Gone. Only the owner of the underlying profile can revoke it; idempotent if already revoked.' })
  @ApiParam({ name: 'id', description: 'The share link id (not the token).' })
  @ApiResponse({ status: 201, description: 'The share link, now revoked.', schema: { type: 'object', properties: { id: { type: 'string' }, profileId: { type: 'string' }, token: { type: 'string' }, recipientName: { type: 'string', nullable: true }, recipientEmail: { type: 'string', nullable: true }, scope: { type: 'array', items: { type: 'string' }, example: ['identity', 'deposit'] }, sentAt: { type: 'string', format: 'date-time' }, expiresAt: { type: 'string', format: 'date-time' }, revokedAt: { type: 'string', format: 'date-time' }, lastViewedAt: { type: 'string', format: 'date-time', nullable: true }, viewCount: { type: 'integer' } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @ApiResponse({ status: 404, description: "Share not found, or doesn't belong to the caller." })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Post('shares/:id/revoke')
  async revokeShare(@Request() req, @Param('id') id: string) {
    return this.buyerProfileService.revokeShare(req.user.id, id);
  }

  // GET /buyer-profile/public/:token — used by the read-only /shared-buyer
  // route on the frontend. No auth; scope-filtered; 410 on revoke/expiry.
  @ApiOperation({ summary: 'Read a shared buyer profile by token', description: "Public, no authentication required - this is what the recipient of a share link actually opens. Returns only the categories the sharer chose to include (identity/deposit/sof/afford/story); raw uploaded documents are never included, only verified status and chosen figures. Increments the link's view counter on every read. Returns 410 if the link has been revoked or has expired." })
  @ApiParam({ name: 'token', description: 'The share link token.' })
  @ApiResponse({ status: 200, description: 'The scope-filtered profile view.', schema: { type: 'object', properties: { publicRef: { type: 'string' }, tier: { type: 'string' }, strengthScore: { type: 'integer' }, publishedAt: { type: 'string', format: 'date-time' }, sharedTo: { type: 'string', nullable: true }, expiresAt: { type: 'string', format: 'date-time' }, chainPosition: { type: 'string', nullable: true }, timeline: { type: 'string', nullable: true }, solicitorStatus: { type: 'string', nullable: true } } } })
  @ApiResponse({ status: 404, description: 'Share link not found.' })
  @ApiResponse({ status: 410, description: 'Share link has been revoked or has expired.' })
  @Get('public/:token')
  async getPublicShare(@Param('token') token: string) {
    return this.buyerProfileService.getPublicShare(token);
  }
}
