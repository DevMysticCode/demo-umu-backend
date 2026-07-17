import {
  Controller,
  Post,
  Put,
  Patch,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  ForbiddenException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PassportService } from './passport.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { createUploadStorage, publicUrlFor, storedFilename, isS3Mode } from '../common/storage';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3002';

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
  constructor(private passportService: PassportService) {}

  @Post('create')
  @UseGuards(JwtAuthGuard)
  async createPassport(@Body() dto: CreatePassportDto, @Request() req: any) {
    const userId = req.user.id;
    const type = dto.type === 'landlord' ? 'LANDLORD' : 'SELLER';
    return this.passportService.createPassport(
      userId,
      dto.addressLine1,
      dto.postcode,
      dto.propertyId,
      { type, isHmo: !!dto.isHmo },
    );
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
    const passport = await this.passportService.getPassport(passportId);

    if (!passport) {
      throw new ForbiddenException('Passport not found');
    }

    const hasAccess = await this.passportService.checkUserAccess(
      passportId,
      userId,
    );
    if (!hasAccess) {
      throw new ForbiddenException('You do not have access to this passport');
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

  @Post(':id/collaborators')
  @UseGuards(JwtAuthGuard)
  async addCollaborator(
    @Param('id') passportId: string,
    @Body('email') email: string,
    @Request() req: any,
  ) {
    const userId = req.user.id;
    return this.passportService.addCollaborator(passportId, userId, email);
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

  // Timeline / activity ledger — feeds the prototype's Timeline tab.
  @Get(':id/timeline')
  @UseGuards(JwtAuthGuard)
  async getTimeline(
    @Param('id') passportId: string,
    @Request() req: any,
  ) {
    return this.passportService.getPassportTimeline(passportId, req.user.id);
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
        mimePrefix: ['image/'],
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
    @Body() body: { scope?: 'buyer' | 'tenant' } | undefined,
    @Request() req: any,
  ) {
    const scope = body?.scope === 'tenant' ? 'tenant' : 'buyer';
    return this.passportService.createShareLink(passportId, req.user.id, scope);
  }

  @Get('shared/:token')
  async getSharedPassport(@Param('token') token: string) {
    return this.passportService.getSharedPassport(token);
  }

  // ── AI Summary ───────────────────────────────────────────────────────────

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
