import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  UseGuards,
  Request,
  NotFoundException,
  Delete,
  Body,
  Res,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { join, extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { SkipThrottle } from '@nestjs/throttler';
import {
  PropertyService,
  PropertySearchFilterInput,
} from './property.service';
import { RunningCostsService } from './running-costs.service';
import { BillParserService } from './bill-parser.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('property')
export class PropertyController {
  constructor(
    private propertyService: PropertyService,
    private runningCostsService: RunningCostsService,
    private billParser: BillParserService,
  ) {}

  // Read-only property discovery — no reason to throttle here. Bots
  // scraping our public postcode search are cheaper to detect via
  // upstream OS Places / EPC quota consumption than to block at our
  // door, and the shared bucket kept 429-ing legit dev sessions.
  @SkipThrottle()
  @Get('search')
  async searchProperties(
    @Query('q') query: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('radius') radius?: string,
    @Query('propertyType') propertyType?: string,
    @Query('minBedrooms') minBedrooms?: string,
    @Query('maxBedrooms') maxBedrooms?: string,
    @Query('minEpc') minEpc?: string,
    @Query('minHomeScore') minHomeScore?: string,
    @Query('passportOnly') passportOnly?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    // Comma-list of 'unclaimed' | 'in_progress' | 'claimed' — the new
    // Explore results-list filter. Server-side WHERE clause (see
    // PropertyService.buildPropertyFilterWhere), unlike the legacy
    // `passportOnly` boolean below.
    @Query('passportStatus') passportStatus?: string,
  ) {
    if (!query || query.trim().length < 2) {
      return { items: [], total: 0 };
    }
    const off = parseInt(offset ?? '0') || 0;
    // Default bumped 10 → 25 — UK postcodes typically have 10–30 properties so
    // a single page covers most queries without forcing infinite scroll.
    // Caller can still pass a smaller limit; max stays at 50.
    const lim = Math.min(parseInt(limit ?? '25') || 25, 50);
    const r = radius ? parseFloat(radius) : undefined;
    const radiusMiles =
      r && !isNaN(r) && r > 0 && r <= 25 ? r : undefined;

    // New Rightmove-style filters (property type / bedrooms / EPC / price /
    // passport status) — a real server-side WHERE clause (see
    // PropertyService.buildPropertyFilterWhere), so `total` below reflects
    // the true filtered dataset size across pages, not just one page's pool.
    let minPriceNum = minPrice ? parseFloat(minPrice) : undefined;
    let maxPriceNum = maxPrice ? parseFloat(maxPrice) : undefined;
    if (minPriceNum != null && (isNaN(minPriceNum) || minPriceNum < 0)) {
      minPriceNum = undefined;
    }
    if (maxPriceNum != null && (isNaN(maxPriceNum) || maxPriceNum < 0)) {
      maxPriceNum = undefined;
    }
    if (minPriceNum != null && maxPriceNum != null && minPriceNum > maxPriceNum) {
      [minPriceNum, maxPriceNum] = [maxPriceNum, minPriceNum];
    }
    const filters: PropertySearchFilterInput | undefined =
      propertyType ||
      minBedrooms ||
      maxBedrooms ||
      minEpc ||
      minPriceNum != null ||
      maxPriceNum != null ||
      passportStatus
        ? {
            propertyTypes: propertyType
              ? propertyType.split(',').filter((v) => v && v !== 'any')
              : undefined,
            minBedrooms: minBedrooms ? parseInt(minBedrooms, 10) : undefined,
            maxBedrooms: maxBedrooms ? parseInt(maxBedrooms, 10) : undefined,
            minEpc: minEpc || undefined,
            minPrice: minPriceNum,
            maxPrice: maxPriceNum,
            passportStatus: passportStatus
              ? passportStatus.split(',').filter(Boolean)
              : undefined,
          }
        : undefined;

    const result = await this.propertyService.searchProperties(
      query.trim(),
      off,
      lim,
      radiusMiles,
      filters,
    );

    // Legacy `passportOnly`/`minHomeScore` — kept working exactly as
    // before (post-fetch, current-page-only) for callers that still send
    // them (e.g. the non-lightweight SearchFilterBar sheet used by
    // Discover). Not combined with the new WHERE-clause filters above;
    // callers should use `passportStatus` instead of `passportOnly` going
    // forward.
    if (!minHomeScore && !passportOnly) {
      return result;
    }
    const filtered = this.propertyService.applyPropertyFilters(result.items, {
      minHomeScore: minHomeScore ? parseInt(minHomeScore, 10) : undefined,
      passportOnly: passportOnly === '1' || passportOnly === 'true',
    });
    return { items: filtered, total: filtered.length };
  }

  // Rightmove-style location typeahead — distinct areas (city + county),
  // not individual properties. Used by Explore's lightweight search
  // dropdown; see PropertyService.searchAreas for the grouping logic.
  @SkipThrottle()
  @Get('search-areas')
  async searchAreas(@Query('q') query: string, @Query('limit') limit?: string) {
    if (!query || query.trim().length < 2) return { items: [] };
    const lim = Math.min(parseInt(limit ?? '8') || 8, 15);
    return this.propertyService.searchAreas(query.trim(), lim);
  }

  @Get(':id/passport-status')
  @UseGuards(JwtAuthGuard)
  async getPassportStatus(@Param('id') id: string, @Request() req: any) {
    const userId = req.user.id;
    return this.propertyService.getPassportStatus(id, userId);
  }

  @Post(':id/start-verification')
  @UseGuards(JwtAuthGuard)
  async startVerification(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.startVerification(id, req.user.id);
  }

  // Self-declared correction for tenure/propertyType when neither EPC nor OS
  // Places has the data (a genuine gap in those upstream registers, not
  // something enrichment can retry its way out of). Only ever fills a field
  // that's currently null — never overwrites a value sourced from EPC/OS,
  // so a claimant can't clobber verified data by mistake.
  @Post(':id/self-declare')
  @UseGuards(JwtAuthGuard)
  async selfDeclarePropertyDetails(
    @Param('id') id: string,
    @Body() body: { tenure?: string; propertyType?: string },
  ) {
    return this.propertyService.selfDeclarePropertyDetails(id, body);
  }

  @Get(':id/verification-status')
  @UseGuards(JwtAuthGuard)
  async getVerificationStatus(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.getVerificationStatus(id, req.user.id);
  }

  @Post(':id/complete-verification')
  @UseGuards(JwtAuthGuard)
  async completeVerification(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.completeVerification(id, req.user.id);
  }

  // Run HM Land Registry Online Owner Verification for this property + the
  // logged-in user. Persists the result on the OwnershipVerification row and
  // returns a verdict the frontend can render directly. Body is optional —
  // `messageId` lets the caller pin a specific test stub scenario
  // (eoov-fm-1 etc.) when running against the BG test environment.
  @Post(':id/land-registry-check')
  @UseGuards(JwtAuthGuard)
  async verifyOwnershipWithLandRegistry(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { messageId?: string } | undefined,
  ) {
    return this.propertyService.verifyOwnershipWithLandRegistry(
      id,
      req.user.id,
      { messageId: body?.messageId },
    );
  }

  // These must stay above @Get(':id') to avoid route conflict
  @Get('wishlist')
  @UseGuards(JwtAuthGuard)
  async getWishlist(@Request() req: any) {
    return this.propertyService.getWishlist(req.user.id);
  }

  @Get('saved')
  @UseGuards(JwtAuthGuard)
  async getSaved(@Request() req: any) {
    return this.propertyService.getSavedProperties(req.user.id);
  }

  // "Recently viewed" strip — every property opened, not just saved ones.
  @Get('recently-viewed')
  @UseGuards(JwtAuthGuard)
  async getRecentlyViewed(@Request() req: any) {
    return this.propertyService.getRecentlyViewed(req.user.id);
  }

  // Fired from the property page's own mount — cheap upsert, not worth
  // throttling alongside the heavier enrichment endpoints.
  @SkipThrottle()
  @Post(':id/record-view')
  @UseGuards(JwtAuthGuard)
  async recordView(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.recordRecentlyViewed(req.user.id, id);
  }

  // Real "N HomeScores run in the last hour" counter for the HomeScore
  // landing page's social-proof pill — no auth required, site-wide count.
  @Get('activity/last-hour')
  async getLastHourActivity() {
    return this.propertyService.getLastHourSearchActivity();
  }

  // Feed endpoint — fires from the explore page mount alongside every
  // other cold read. Not sensible to throttle: JWT already gates it
  // per-user, and the fan-out inside getForYou can trigger 5+ upstream
  // API calls (OS Places + EPC + enrichment). Being throttled here
  // just cascades into empty explore feeds for legit users.
  @SkipThrottle()
  @Get('for-you')
  @UseGuards(JwtAuthGuard)
  async getForYou(
    @Request() req: any,
    @Query('propertyType') propertyType?: string,
    @Query('minBedrooms') minBedrooms?: string,
    @Query('maxBedrooms') maxBedrooms?: string,
    @Query('minEpc') minEpc?: string,
    @Query('minHomeScore') minHomeScore?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('passportOnly') passportOnly?: string,
    @Query('passportStatus') passportStatus?: string,
  ) {
    const hasFilters =
      !!propertyType ||
      !!minBedrooms ||
      !!maxBedrooms ||
      !!minEpc ||
      !!minHomeScore ||
      !!minPrice ||
      !!maxPrice ||
      !!passportOnly ||
      !!passportStatus;
    return this.propertyService.getForYou(
      req.user.id,
      hasFilters
        ? {
            propertyTypes: propertyType
              ? propertyType.split(',').filter((v) => v && v !== 'any')
              : undefined,
            minBedrooms: minBedrooms ? parseInt(minBedrooms, 10) : undefined,
            maxBedrooms: maxBedrooms ? parseInt(maxBedrooms, 10) : undefined,
            minEpc: minEpc || undefined,
            minHomeScore: minHomeScore ? parseInt(minHomeScore, 10) : undefined,
            minPrice: minPrice ? parseFloat(minPrice) : undefined,
            maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
            passportOnly: passportOnly === '1' || passportOnly === 'true',
            passportStatus: passportStatus
              ? passportStatus.split(',').filter(Boolean)
              : undefined,
          }
        : undefined,
    );
  }

  @Get('verified-passports')
  async getVerifiedPassports(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const lim = Math.min(parseInt(limit ?? '12') || 12, 50);
    const off = parseInt(offset ?? '0') || 0;
    return this.propertyService.getVerifiedPassportProperties(off, lim);
  }

  @Get(':id/actions')
  @UseGuards(JwtAuthGuard)
  async getPropertyActions(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.getPropertyActions(req.user.id, id);
  }

  @Post(':id/wishlist')
  @UseGuards(JwtAuthGuard)
  async toggleWishlist(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.toggleWishlist(req.user.id, id);
  }

  @Post(':id/save')
  @UseGuards(JwtAuthGuard)
  async toggleSave(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.toggleSave(req.user.id, id);
  }

  // "Watch this property" — per-property notification-preference toggles
  // (components/property/WatchPropertyDrawer.vue). Body keys match the
  // drawer's toggle keys 1:1: claimed/progress/published/comparables/
  // homescore.
  @Post(':id/watch')
  @UseGuards(JwtAuthGuard)
  async upsertPropertyWatch(
    @Param('id') id: string,
    @Request() req: any,
    @Body()
    body: {
      claimed?: boolean;
      progress?: boolean;
      published?: boolean;
      comparables?: boolean;
      homescore?: boolean;
    },
  ) {
    return this.propertyService.upsertPropertyWatch(req.user.id, id, body);
  }

  @Get(':id/watch')
  @UseGuards(JwtAuthGuard)
  async getPropertyWatch(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.getPropertyWatch(req.user.id, id);
  }

  @Delete(':id/watch')
  @UseGuards(JwtAuthGuard)
  async deletePropertyWatch(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.deletePropertyWatch(req.user.id, id);
  }

  @Get(':id/sold-history')
  async getSoldHistory(@Param('id') id: string) {
    return this.propertyService.getLiveSoldHistory(id);
  }

  @Get(':id/enrichment')
  async getEnrichment(@Param('id') id: string): Promise<any> {
    const data = await this.propertyService.getPropertyEnrichment(id);
    if (!data) throw new NotFoundException('Property not found');
    return data;
  }

  // Debug: per-source health for the enrichment pipeline. Reports which
  // upstream APIs returned data, were empty, or errored. Includes which
  // env-var keys are present without leaking values.
  @Get(':id/enrichment/debug')
  async getEnrichmentDebug(@Param('id') id: string): Promise<any> {
    return this.propertyService.getEnrichmentDebug(id);
  }

  // Force re-fetch of the EPC certificate + recommendations from the EPC
  // Register, bypassing any "already enriched" early-return. Used by the
  // homescore page when `epcRecommendations` is empty on the row so we can
  // recover from a previously-failed enrichment.
  @Post(':id/epc-refresh')
  async refreshEpc(@Param('id') id: string): Promise<any> {
    const data = await this.propertyService.refreshEpc(id);
    if (!data) throw new NotFoundException('Property not found');
    return data;
  }

  @Post(':id/homescore')
  @UseGuards(JwtAuthGuard)
  async saveHomeScore(@Param('id') id: string, @Request() req: any, @Body() body: any) {
    return this.propertyService.saveHomeScore(id, req.user.id, body);
  }

  @Get(':id/homescore/public')
  async getPublicHomeScore(@Param('id') id: string) {
    return this.propertyService.getPublicHomeScore(id);
  }

  @Get(':id/homescore')
  @UseGuards(JwtAuthGuard)
  async getHomeScore(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.getHomeScore(id, req.user.id);
  }

  // ── HomeScore publishing (to the street pool) ──────────────────────────
  @Post(':id/homescore/publish')
  @UseGuards(JwtAuthGuard)
  async publishHomeScore(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.publishHomeScore(id, req.user.id);
  }

  @Post(':id/homescore/unpublish')
  @UseGuards(JwtAuthGuard)
  async unpublishHomeScore(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.unpublishHomeScore(id, req.user.id);
  }

  @Get(':id/street-publish-stats')
  async getStreetPublishStats(@Param('id') id: string) {
    return this.propertyService.getStreetPublishStats(id);
  }

  // Energy-cost rank among neighbouring properties on the same outcode.
  // Powers the "Nth of M on street" + "best on street £X/yr" copy on the
  // buyer-results screen.
  @Get(':id/street-energy-rank')
  async getStreetEnergyRank(@Param('id') id: string) {
    return this.propertyService.getStreetEnergyRank(id);
  }

  // ── Bill OCR + parsing ─────────────────────────────────────────────────
  // Owner uploads a recent energy bill from the simulator; we OCR it with
  // Tesseract and parse the structured spend, supplier, and period. The
  // parsed result is persisted on the property and echoed back so the UI
  // can immediately reflect actual figures in the score / cost cards.
  @Post(':id/bill-parse')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadPath = join(process.cwd(), 'uploads', 'bills');
          if (!existsSync(uploadPath)) mkdirSync(uploadPath, { recursive: true });
          cb(null, uploadPath);
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    }),
  )
  async parseBill(
    @Param('id') id: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @UploadedFile() file: any,
  ) {
    if (!file) throw new NotFoundException('No file uploaded');
    return this.billParser.parseAndSave(id, file.path, file.mimetype);
  }

  // ── KYC / ownership verification ───────────────────────────────────────
  @Post(':id/kyc/submit')
  @UseGuards(JwtAuthGuard)
  async submitKyc(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { method: 'photo-id' | 'mortgage' | 'open-banking' },
  ) {
    return this.propertyService.submitKyc(id, req.user.id, body?.method);
  }

  @Get(':id/kyc/status')
  @UseGuards(JwtAuthGuard)
  async getKycStatus(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.getKycStatus(id, req.user.id);
  }

  @Get(':id/neighbourhood')
  async getNeighbourhood(@Param('id') id: string) {
    return this.propertyService.getNeighbourhoodStats(id);
  }

  // Aggregate market stats for an area (postcode-sector level by default).
  // Used by the "Market pulse" card on the explore home. Returns only the
  // figures we can actually compute from Land Registry + Passport tables —
  // the frontend hides any field that comes back null.
  @Get('market-pulse')
  async getMarketPulse(@Query('postcode') postcode?: string) {
    return this.propertyService.getMarketPulse(postcode);
  }


  @Get(':id/running-costs')
  async getRunningCosts(@Param('id') id: string) {
    return this.runningCostsService.getRunningCosts(id);
  }

  // Anonymous "I looked at this address" log — used to render the
  // "People searched this address this month" card. No auth required;
  // we accept an optional sessionId from the client for guest dedup.
  @Post(':id/log-search')
  async logSearch(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { sessionId?: string },
  ) {
    // Try to detect an authenticated user from the JWT, but don't require one
    let userId: string | null = null;
    try {
      const auth = req.headers?.authorization as string | undefined;
      if (auth && auth.startsWith('Bearer ')) {
        // Lightweight decode: don't fail if invalid — guests are allowed.
        const token = auth.slice(7);
        const parts = token.split('.');
        if (parts.length === 3) {
          const json = JSON.parse(
            Buffer.from(parts[1], 'base64').toString('utf8'),
          );
          if (typeof json?.sub === 'string') userId = json.sub;
        }
      }
    } catch {
      userId = null;
    }
    const sessionId =
      typeof body?.sessionId === 'string' && body.sessionId.length > 0
        ? body.sessionId
        : null;
    return this.propertyService.logPropertySearch(id, userId, sessionId);
  }

  @Get(':id/search-stats')
  async getSearchStats(@Param('id') id: string) {
    return this.propertyService.getPropertySearchStats(id);
  }

  @Get(':id/street')
  async getStreetProperties(@Param('id') id: string) {
    return this.propertyService.getStreetProperties(id);
  }

  @Get(':id/matched-buyers')
  async getMatchedBuyers(@Param('id') id: string) {
    return this.propertyService.getMatchedBuyers(id);
  }

  @Get(':id')
  async getProperty(@Param('id') id: string) {
    const property = await this.propertyService.getPropertyById(id);
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }

  @Post(':id/register-interest')
  @UseGuards(JwtAuthGuard)
  async registerInterest(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { interestLevel: string; name?: string; userEmail?: string },
  ) {
    return this.propertyService.registerInterest(id, req.user.id, body);
  }

  @Post(':id/tap-owner')
  @UseGuards(JwtAuthGuard)
  async tapOwner(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { message: string; sharePhone?: boolean },
  ) {
    return this.propertyService.tapOwner(id, req.user.id, body);
  }

  // Resolve the EPC LMK key for a property (via UPRN lookup on the EPC
  // Register) so the frontend can build a link to the gov.uk consumer
  // certificate page: find-energy-certificate.service.gov.uk/energy-
  // certificate/{lmk}. The previous /epc-download endpoint tried to
  // proxy a PDF from opendatacommunities.org, but that host was retired
  // with the EPC API migration and no equivalent PDF endpoint exists on
  // the new API — so we hand the user off to the gov.uk cert page (which
  // has its own print / save flow) instead.
  @Get(':id/epc-download-info')
  async epcDownloadInfo(@Param('id') id: string) {
    const info = await this.propertyService.getEpcDownloadInfo(id);
    if (!info) throw new NotFoundException('EPC certificate not available for this property');
    return { lmkKey: info.lmkKey };
  }
}
