import {
  Controller,
  Post,
  Put,
  Patch,
  Get,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  UseGuards,
  Request,
  ForbiddenException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { PassportService } from './passport.service';
import { PassportEventsService } from './passport-events.service';
import { PassportActionsService } from './passport-actions.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { createUploadStorage, publicUrlFor, storedFilename, isS3Mode, IMAGE_MIME_TYPES } from '../common/storage';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3002';

// JWT-gated but was relying solely on the 300 req/min/IP global default —
// each call is a paid Groq LLM invocation (security review 2026-09-22,
// M8), mirroring the same fix on ChatController.
const AI_SUMMARY_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

/**
 * Build an absolute upload URL. Prefers a request-derived scheme+host
 * over the BASE_URL env var — this keeps images loadable on Railway
 * and preview deployments where BASE_URL is often either unset (falls
 * back to `http://localhost:3002` and every uploaded URL breaks on
 * real devices) or lags behind the current deploy's actual hostname.
 * S3-mode public URLs are already absolute and returned unchanged.
 */
function absoluteUploadUrl(req: any, relativeOrAbsolute: string): string {
  if (isS3Mode) return relativeOrAbsolute;
  // Trust request headers first — every reverse-proxied deploy (Railway,
  // Vercel, Cloudflare) sets x-forwarded-proto/x-forwarded-host, and Express
  // parses those when trust proxy is on. Fall back to req.protocol / host
  // for local dev, and finally the env var if req isn't available.
  const proto =
    req?.headers?.['x-forwarded-proto'] ??
    req?.protocol ??
    (BASE_URL.startsWith('https') ? 'https' : 'http');
  const host =
    req?.headers?.['x-forwarded-host'] ??
    req?.get?.('host') ??
    req?.headers?.host ??
    BASE_URL.replace(/^https?:\/\//, '');
  return `${proto}://${host}${relativeOrAbsolute}`;
}

interface CreatePassportDto {
  addressLine1: string;
  postcode: string;
  propertyId?: string;
  type?: 'seller' | 'landlord';
  isHmo?: boolean;
}

interface ConvertToSellerDto {
  // No body fields needed — all info comes from the source passport
  // referenced in the URL.
  acknowledged?: boolean;
}

@Controller('passport')
export class PassportController {
  constructor(
    private passportService: PassportService,
    private events: PassportEventsService,
    private actionsService: PassportActionsService,
  ) {}

  @Post('create')
  @UseGuards(JwtAuthGuard)
  async createPassport(@Body() dto: CreatePassportDto, @Request() req: any) {
    const userId = req.user.id;
    // Manual passports / landlord→seller converts send a real type and get
    // it applied immediately. Property claims (dto.propertyId set) don't
    // send one anymore — createPassport() ignores it for that path and the
    // frontend calls set-type below once HMLR verifies ownership.
    const type =
      dto.type === 'landlord' ? 'LANDLORD' : dto.type === 'seller' ? 'SELLER' : undefined;
    return this.passportService.createPassport(
      userId,
      dto.addressLine1,
      dto.postcode,
      dto.propertyId,
      { type, isHmo: !!dto.isHmo },
    );
  }

  // Property owner-claims come back from createPassport in PENDING_PAYMENT
  // status with no type yet (KYC/HMLR cost real money — see PaymentService
  // pricing). Payment happens first (right after createPassport), then KYC
  // and HM Land Registry verification, then this sets the seller/landlord
  // choice once ownership is confirmed — call it right before :id/activate.
  @Post(':id/set-type')
  @UseGuards(JwtAuthGuard)
  async setPassportType(
    @Param('id') id: string,
    @Body() dto: { type: 'seller' | 'landlord'; isHmo?: boolean },
    @Request() req: any,
  ) {
    const type = dto.type === 'landlord' ? 'LANDLORD' : 'SELLER';
    return this.passportService.setPassportType(id, req.user.id, type, !!dto.isHmo);
  }

  // Last call in the chain — requires all of: Stripe charge succeeded, KYC
  // approved, HMLR ownership VERIFIED, and a type already set via
  // :id/set-type — before it seeds the passport's sections.
  @Post(':id/activate')
  @UseGuards(JwtAuthGuard)
  async activatePassport(@Param('id') id: string, @Request() req: any) {
    return this.passportService.activatePassport(id, req.user.id);
  }

  @Post(':id/convert-to-seller')
  @UseGuards(JwtAuthGuard)
  async convertToSeller(
    @Param('id') passportId: string,
    @Body() _dto: ConvertToSellerDto,
    @Request() req: any,
  ) {
    return this.passportService.convertLandlordToSeller(passportId, req.user.id);
  }

  @Get('my')
  @UseGuards(JwtAuthGuard)
  async getMyPassports(@Request() req: any) {
    return this.passportService.getUserPassports(req.user.id);
  }

  // Buyer's purchased "watching" list — published passports they've unlocked.
  // Returns array of records the Passport tab uses to render the Watching section.
  @Get('buyer-access')
  @UseGuards(JwtAuthGuard)
  async getMyBuyerAccess(@Request() req: any) {
    return this.passportService.getBuyerAccessList(req.user.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getPassport(@Param('id') passportId: string, @Request() req: any) {
    const userId = req.user.id;
    // getPassport() now enforces access itself (see its own comment) -
    // no separate checkUserAccess() call needed here any more.
    const passport = await this.passportService.getPassport(passportId, userId);

    if (!passport) {
      throw new ForbiddenException('Passport not found');
    }

    return passport;
  }

  @Get(':id/sections')
  @UseGuards(JwtAuthGuard)
  async getPassportSections(
    @Param('id') passportId: string,
    @Request() req: any,
  ) {
    const userId = req.user.id;
    return this.passportService.getPassportSections(passportId, userId);
  }

  // Address / UPRN / title number we already hold for this passport's
  // property — used to pre-fill the "address of the property" question
  // instead of asking the owner to re-type known facts.
  @Get(':id/property-facts')
  @UseGuards(JwtAuthGuard)
  async getPassportPropertyFacts(
    @Param('id') passportId: string,
    @Request() req: any,
  ) {
    return this.passportService.getPassportPropertyFacts(passportId, req.user.id);
  }

  @Post(':id/collaborators')
  @UseGuards(JwtAuthGuard)
  async addCollaborator(
    @Param('id') passportId: string,
    @Body('email') email: string,
    @Body('role') role: string | undefined,
    @Body('sectionKeys') sectionKeys: string[] | undefined,
    @Body('historyAccess') historyAccess: boolean | undefined,
    @Headers('origin') origin: string | undefined,
    @Request() req: any,
  ) {
    const userId = req.user.id;
    return this.passportService.addCollaborator(
      passportId,
      userId,
      email,
      { role, sectionKeys, historyAccess },
      origin,
    );
  }

  @Patch(':id/collaborators/:collaboratorId')
  @UseGuards(JwtAuthGuard)
  async updateCollaboratorScope(
    @Param('id') passportId: string,
    @Param('collaboratorId') collaboratorId: string,
    @Body('role') role: string | undefined,
    @Body('sectionKeys') sectionKeys: string[] | undefined,
    @Body('historyAccess') historyAccess: boolean | undefined,
    @Request() req: any,
  ) {
    return this.passportService.updateCollaboratorScope(
      passportId,
      req.user.id,
      collaboratorId,
      { role, sectionKeys, historyAccess },
    );
  }

  @Get(':id/collaborators')
  @UseGuards(JwtAuthGuard)
  async getCollaborators(@Param('id') passportId: string, @Request() req: any) {
    const userId = req.user.id;
    return this.passportService.getCollaborators(passportId, userId);
  }

  @Post(':id/collaborators/:collaboratorId/remove')
  @UseGuards(JwtAuthGuard)
  async removeCollaborator(
    @Param('id') passportId: string,
    @Param('collaboratorId') collaboratorId: string,
    @Request() req: any,
  ) {
    const userId = req.user.id;
    return this.passportService.removeCollaborator(
      passportId,
      userId,
      collaboratorId,
    );
  }

  @Post(':id/buyer-unlock')
  @UseGuards(JwtAuthGuard)
  async buyerUnlock(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.createBuyerAccess(passportId, req.user.id);
  }

  // Owner/collaborator shares the passport with a specific buyer —
  // opens (or reuses) a conversation between them and posts a
  // share_passport card. Does NOT grant BuyerPassportAccess; the buyer
  // still has to pay via /buyer-unlock. See sharePassportWithBuyer.
  @Post(':id/share-with-buyer')
  @UseGuards(JwtAuthGuard)
  async sharePassportWithBuyer(
    @Param('id') passportId: string,
    @Body() body: { buyerUserId: string; note?: string },
    @Request() req: any,
  ) {
    return this.passportService.sharePassportWithBuyer(
      passportId,
      req.user.id,
      body.buyerUserId,
      body.note,
    );
  }

  @Get(':id/buyer-view')
  @UseGuards(JwtAuthGuard)
  async getBuyerView(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.getBuyerView(passportId, req.user.id);
  }

  @Get(':id/readiness')
  @UseGuards(JwtAuthGuard)
  async getReadiness(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.getReadiness(passportId, req.user.id);
  }

  @Put(':id/publish')
  @UseGuards(JwtAuthGuard)
  async publishPassport(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.publishPassport(passportId, req.user.id);
  }

  @Put(':id/unpublish')
  @UseGuards(JwtAuthGuard)
  async unpublishPassport(
    @Param('id') passportId: string,
    @Request() req: any,
  ) {
    return this.passportService.unpublishPassport(passportId, req.user.id);
  }

  // Timeline / activity ledger — feeds the (soon to be retired) Timeline
  // tab's sale-stage tracker. Left untouched so the three live frontends
  // keep working during the History rollout — see getHistory() below for
  // the replacement.
  @Get(':id/timeline')
  @UseGuards(JwtAuthGuard)
  async getTimeline(
    @Param('id') passportId: string,
    @Request() req: any,
  ) {
    return this.passportService.getPassportTimeline(passportId, req.user.id);
  }

  // History — replaces the Timeline tab per the client handoff
  // (2026-09-25): paginated, filterable, permission-scoped event feed.
  // `category`: all | information | documents | actions | access.
  @Get(':id/history')
  @UseGuards(JwtAuthGuard)
  async getHistory(
    @Param('id') passportId: string,
    @Request() req: any,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('category') category?: string,
    @Query('sectionId') sectionId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.events.getHistory(passportId, req.user.id, {
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
      category: (category as any) ?? 'all',
      sectionId,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
    });
  }

  @Get(':id/history/:eventId')
  @UseGuards(JwtAuthGuard)
  async getHistoryEventDetail(
    @Param('id') passportId: string,
    @Param('eventId') eventId: string,
    @Request() req: any,
  ) {
    return this.events.getEventDetail(passportId, eventId, req.user.id);
  }

  // Actions — the "Needs your attention" list, generated by the rule
  // engine (see PassportActionsService). Owner/collaborator can list;
  // only the owner can mark addressed/reopen.
  @Get(':id/actions')
  @UseGuards(JwtAuthGuard)
  async listActions(@Param('id') passportId: string, @Request() req: any) {
    return this.actionsService.listActions(passportId, req.user.id);
  }

  @Patch(':id/actions/:actionId/addressed')
  @UseGuards(JwtAuthGuard)
  async markActionAddressed(
    @Param('id') passportId: string,
    @Param('actionId') actionId: string,
    @Request() req: any,
  ) {
    return this.actionsService.markAddressed(passportId, actionId, req.user.id);
  }

  @Patch(':id/actions/:actionId/reopen')
  @UseGuards(JwtAuthGuard)
  async reopenAction(
    @Param('id') passportId: string,
    @Param('actionId') actionId: string,
    @Request() req: any,
  ) {
    return this.actionsService.reopen(passportId, actionId, req.user.id);
  }

  // Vault — read sections with their visibility (PUBLIC | PRIVATE).
  @Get(':id/vault')
  @UseGuards(JwtAuthGuard)
  async getVault(
    @Param('id') passportId: string,
    @Request() req: any,
  ) {
    return this.passportService.getPassportVault(passportId, req.user.id);
  }

  // Toggle a section's visibility (drives whether it's included when the
  // Passport is published).
  @Patch('section/:sectionId/visibility')
  @UseGuards(JwtAuthGuard)
  async setSectionVisibility(
    @Param('sectionId') sectionId: string,
    @Request() req: any,
    @Body() body: { visibility: 'PUBLIC' | 'PRIVATE' },
  ) {
    return this.passportService.setSectionVisibility(
      sectionId,
      req.user.id,
      body.visibility,
    );
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async deletePassport(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.deletePassport(passportId, req.user.id);
  }

  // ── Resume tracking ──────────────────────────────────────────
  // Frontend pings this whenever the user opens or answers a task, so we
  // know where to drop them on next visit.
  @Put(':id/last-visited')
  @UseGuards(JwtAuthGuard)
  async setLastVisited(
    @Param('id') passportId: string,
    @Body() body: { taskId: string },
    @Request() req: any,
  ) {
    return this.passportService.setLastVisited(
      passportId,
      req.user.id,
      body?.taskId,
    );
  }

  // Resolves to the smartest "pick up where you left off" target. Returns
  // null when nothing remains incomplete.
  @Get(':id/resume')
  @UseGuards(JwtAuthGuard)
  async getResumeTarget(
    @Param('id') passportId: string,
    @Request() req: any,
  ) {
    return this.passportService.getResumeTarget(passportId, req.user.id);
  }

  @Post(':id/upload-image')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor(
      'file',
      createUploadStorage({
        bucket: 'property-images',
        maxMb: 20,
        // Not mimePrefix: ['image/'] any more - that also matched
        // image/svg+xml (security review 2026-09-22, finding H1).
        mimeAllowList: IMAGE_MIME_TYPES,
      }),
    ),
  )
  async uploadPropertyImage(
    @Param('id') passportId: string,
    @UploadedFile() file: any,
    @Request() req: any,
  ) {
    const hasAccess = await this.passportService.checkUserAccess(
      passportId,
      req.user.id,
    );
    if (!hasAccess) throw new ForbiddenException('Access denied');
    const relativeOrAbsolute = publicUrlFor('property-images', storedFilename(file));
    // S3 mode returns an absolute URL; disk mode returns a relative
    // path which we resolve against the incoming request so URLs work
    // on whatever host the app is actually being served from.
    const url = absoluteUploadUrl(req, relativeOrAbsolute);
    return {
      url,
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };
  }

  @Get(':id/property-images')
  @UseGuards(JwtAuthGuard)
  async getPropertyImages(
    @Param('id') passportId: string,
    @Request() req: any,
  ) {
    return this.passportService.getPropertyImages(passportId, req.user.id);
  }

  @Put(':id/property-images')
  @UseGuards(JwtAuthGuard)
  async updatePropertyImages(
    @Param('id') passportId: string,
    @Body('images') images: string[],
    @Request() req: any,
  ) {
    return this.passportService.updatePropertyImages(
      passportId,
      req.user.id,
      images,
    );
  }

  // ── Comparables ─────────────────────────────────────────────────────────

  @Get(':id/comparables')
  @UseGuards(JwtAuthGuard)
  async getComparables(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.getComparables(passportId, req.user.id);
  }

  // ── Share Link ───────────────────────────────────────────────────────────

  @Post(':id/share')
  @UseGuards(JwtAuthGuard)
  async createShareLink(
    @Param('id') passportId: string,
    @Body() body: { scope?: 'buyer' | 'tenant'; documentIds?: string[] } | undefined,
    @Headers('origin') origin: string | undefined,
    @Request() req: any,
  ) {
    const scope = body?.scope === 'tenant' ? 'tenant' : 'buyer';
    return this.passportService.createShareLink(
      passportId,
      req.user.id,
      scope,
      body?.documentIds,
      origin,
    );
  }

  @Get('shared/:token')
  async getSharedPassport(@Param('token') token: string) {
    return this.passportService.getSharedPassport(token);
  }

  // ── AI Summary ───────────────────────────────────────────────────────────

  @Throttle(AI_SUMMARY_THROTTLE)
  @Post(':id/ai-summary/:sectionKey')
  @UseGuards(JwtAuthGuard)
  async getSectionAiSummary(
    @Param('id') passportId: string,
    @Param('sectionKey') sectionKey: string,
    @Request() req: any,
  ) {
    return this.passportService.getSectionAiSummary(passportId, sectionKey, req.user.id);
  }

  // ── Buyer Notes ───────────────────────────────────────────────────────────

  @Post(':id/notes')
  @UseGuards(JwtAuthGuard)
  async createBuyerNote(
    @Param('id') passportId: string,
    @Body('text') text: string,
    @Body('sectionKey') sectionKey: string | undefined,
    @Request() req: any,
  ) {
    return this.passportService.createBuyerNote(passportId, req.user.id, text, sectionKey);
  }

  @Get(':id/notes')
  @UseGuards(JwtAuthGuard)
  async getBuyerNotes(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.getBuyerNotes(passportId, req.user.id);
  }

  @Delete('notes/:noteId')
  @UseGuards(JwtAuthGuard)
  async deleteBuyerNote(@Param('noteId') noteId: string, @Request() req: any) {
    return this.passportService.deleteBuyerNote(noteId, req.user.id);
  }
}
