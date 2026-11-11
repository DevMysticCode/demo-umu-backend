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
import { join } from 'path';
import { existsSync, mkdirSync, unlink } from 'fs';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import {
  PropertyService,
  PropertySearchFilterInput,
} from './property.service';
import { RunningCostsService } from './running-costs.service';
import { BillParserService } from './bill-parser.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import {
  LandRegistryCheckDto,
  LogSearchDto,
  RegisterInterestDto,
  SaveHomeScoreDto,
  SelfDeclarePropertyDto,
  SubmitKycDto,
  TapOwnerDto,
  UpsertPropertyWatchDto,
} from './dto/property.dto';

// search/search-areas fan out to OS Places + EPC — paid, quota-capped
// external APIs (DEPLOYMENT.md documents a real "Free Trial allowance
// exceeded" failure on the OS Places 50 req/min cap). Leaving these
// fully @SkipThrottle()'d let a single scripted client burn that quota
// with no limit at all (security review 2026-09-22, H8). Generous
// enough not to interrupt normal typing/autocomplete use.
const SEARCH_THROTTLE = { default: { limit: 30, ttl: 60_000 } };
// for-you fans out to ~5 upstream calls per request (OS Places + EPC +
// enrichment) — same cost concern as search, tighter cap since it's a
// heavier per-request fan-out.
const FOR_YOU_THROTTLE = { default: { limit: 20, ttl: 60_000 } };
// Same paid-upstream-API cost concern as SEARCH_THROTTLE/FOR_YOU_THROTTLE
// above - every request is a billed Google Street View Static API call.
// No auth guard (lat/lon aren't secret), so this is the only backstop
// besides the service-level cache (security review, 14 Oct 2026).
const STREET_VIEW_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

// Bill photo/scan formats — PDF is accepted too since bills often arrive
// that way; parseBill degrades gracefully (empty result, not a crash) if
// Tesseract can't extract text from it. Extension is always derived from
// this table, never from the client's filename (see storage.ts's
// MIME_EXT for why).
const BILL_MIME_EXT: Readonly<Record<string, string>> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf',
};

@Controller('property')
export class PropertyController {
  constructor(
    private propertyService: PropertyService,
    private runningCostsService: RunningCostsService,
    private billParser: BillParserService,
  ) {}

  @Throttle(SEARCH_THROTTLE)
  @Get('search')
  @ApiOperation({ summary: 'Search properties by postcode/area', description: 'Full-text property search with pagination, radius, and optional Rightmove-style filters (type, bedrooms, EPC, price, passport status). Requires at least 2 characters of query text. No authentication required.' })
  @ApiQuery({ name: 'q', description: 'Search text (postcode or area), minimum 2 characters', required: true })
  @ApiQuery({ name: 'offset', description: 'Pagination offset, default 0', required: false })
  @ApiQuery({ name: 'limit', description: 'Page size, default 25, max 50', required: false })
  @ApiQuery({ name: 'radius', description: 'Search radius in miles, up to 25', required: false })
  @ApiQuery({ name: 'propertyType', description: 'Comma-separated property types to filter by', required: false })
  @ApiQuery({ name: 'minBedrooms', description: 'Minimum bedroom count', required: false })
  @ApiQuery({ name: 'maxBedrooms', description: 'Maximum bedroom count', required: false })
  @ApiQuery({ name: 'minEpc', description: 'Minimum EPC rating letter', required: false })
  @ApiQuery({ name: 'minHomeScore', description: 'Minimum HomeScore (legacy, post-fetch filter, current page only)', required: false })
  @ApiQuery({ name: 'passportOnly', description: 'Legacy boolean filter: only properties with a passport (current page only)', required: false })
  @ApiQuery({ name: 'minPrice', description: 'Minimum price', required: false })
  @ApiQuery({ name: 'maxPrice', description: 'Maximum price', required: false })
  @ApiQuery({ name: 'passportStatus', description: "Comma-separated passport status filter: 'unclaimed' | 'in_progress' | 'claimed'", required: false })
  @ApiResponse({ status: 200, description: 'Matching properties for the current page, plus the total count across all pages', schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', description: 'Property record - same shape as GET /property/:id', properties: {
    id: { type: 'string' }, udprn: { type: 'string', nullable: true }, uprn: { type: 'string', nullable: true },
    addressLine1: { type: 'string' }, postcode: { type: 'string' }, propertyType: { type: 'string', nullable: true },
    bedrooms: { type: 'number', nullable: true }, epcRating: { type: 'string', nullable: true }, estimatedPrice: { type: 'number', nullable: true },
  } } }, total: { type: 'number' } } } })
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
  @Throttle(SEARCH_THROTTLE)
  @Get('search-areas')
  @ApiOperation({ summary: 'Typeahead search for areas (city/county)', description: 'Rightmove-style location typeahead returning distinct areas rather than individual properties, for the Explore search dropdown. No authentication required.' })
  @ApiQuery({ name: 'q', description: 'Search text, minimum 2 characters', required: true })
  @ApiQuery({ name: 'limit', description: 'Max results, default 8, max 15', required: false })
  @ApiResponse({ status: 200, description: 'Matching areas', schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, city: { type: 'string', nullable: true }, county: { type: 'string', nullable: true }, postcode: { type: 'string', nullable: true } } } } } } })
  async searchAreas(@Query('q') query: string, @Query('limit') limit?: string) {
    if (!query || query.trim().length < 2) return { items: [] };
    const lim = Math.min(parseInt(limit ?? '8') || 8, 15);
    return this.propertyService.searchAreas(query.trim(), lim);
  }

  @Get(':id/passport-status')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get a property's claim/passport status", description: "Returns whether the property is unclaimed, claimed, or published, and (for the signed-in user) whether they are the owner, a collaborator, or hold buyer access. Drives the property page's Claim/Access Passport button." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Passport status for this property and the current user', schema: { type: 'object', properties: { hasPassport: { type: 'boolean' }, status: { type: 'string', nullable: true }, isOwner: { type: 'boolean' }, isCollaborator: { type: 'boolean' }, hasBuyerAccess: { type: 'boolean' } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  async getPassportStatus(@Param('id') id: string, @Request() req: any) {
    const userId = req.user.id;
    return this.propertyService.getPassportStatus(id, userId);
  }

  @Post(':id/start-verification')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Begin owner-claim verification (KYC + pricing snapshot)', description: "Starts the paid claim flow: snapshots the user's current KYC status (used to price the claim across its tiers) ahead of payment and HM Land Registry verification." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'The OwnershipVerification row for this (property, user) pair', schema: { type: 'object', properties: {
    id: { type: 'string' }, propertyId: { type: 'string' }, userId: { type: 'string' },
    status: { type: 'string', enum: ['SUBMITTED', 'IN_PROGRESS', 'VERIFIED', 'ADDITIONAL_INFO_NEEDED', 'FAILED'] },
    submittedAt: { type: 'string', format: 'date-time' }, verifiedAt: { type: 'string', format: 'date-time', nullable: true },
    kycAlreadyVerifiedAtStart: { type: 'boolean', nullable: true }, hmlrAlreadyVerifiedAtStart: { type: 'boolean', nullable: true },
  } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  async startVerification(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.startVerification(id, req.user.id);
  }

  // Self-declared correction for tenure/propertyType when neither EPC nor OS
  // Places has the data (a genuine gap in those upstream registers, not
  // something enrichment can retry its way out of). Only ever fills a field
  // that's currently null — never overwrites a value sourced from EPC/OS,
  // so a claimant can't clobber verified data by mistake.
  @Post(':id/self-declare')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Self-declare tenure/property type', description: 'Lets the property manager fill in tenure or property type when neither EPC nor OS Places has the data. Only ever fills a currently-null field - never overwrites a value already sourced from EPC/OS.' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'The updated property record', schema: { type: 'object', description: 'Full Property record - representative fields shown, not exhaustive', properties: {
    id: { type: 'string' }, udprn: { type: 'string', nullable: true }, uprn: { type: 'string', nullable: true },
    addressLine1: { type: 'string' }, postcode: { type: 'string' },
    propertyType: { type: 'string', nullable: true }, tenure: { type: 'string', nullable: true },
  } } })
  @ApiResponse({ status: 400, description: 'tenure is not one of the allowed values.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @ApiResponse({ status: 403, description: 'Caller does not manage this property.' })
  @ApiResponse({ status: 404, description: 'Property not found.' })
  async selfDeclarePropertyDetails(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: SelfDeclarePropertyDto,
  ) {
    return this.propertyService.selfDeclarePropertyDetails(id, req.user.id, body);
  }

  @Get(':id/verification-status')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get ownership verification status', description: "Returns this user's OwnershipVerification record for the property (method, status, HM Land Registry match result), if one exists." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Ownership verification record, or null if none started', schema: { type: 'object', nullable: true, properties: { status: { type: 'string' }, verificationMethod: { type: 'string' }, landRegistryMatchResult: { type: 'string', nullable: true } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  async getVerificationStatus(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.getVerificationStatus(id, req.user.id);
  }

  @Post(':id/complete-verification')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Confirm ownership verification as complete', description: "Finalises a claim that HM Land Registry verification has already marked VERIFIED with a SINGLE_MATCH result - rejects if that evidence isn't present. Does not itself create a passport." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Confirmation only - this endpoint does not return the verification record itself', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @ApiResponse({ status: 403, description: 'Ownership has not been verified against HM Land Registry yet (no VERIFIED/SINGLE_MATCH record).' })
  async completeVerification(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.completeVerification(id, req.user.id);
  }

  // Run HM Land Registry Online Owner Verification for this property + the
  // logged-in user. Persists the result on the OwnershipVerification row and
  // returns a verdict the frontend can render directly. Body is optional —
  // `messageId` lets the caller pin a specific test stub scenario
  // (eoov-fm-1 etc.) when running against the BG test environment.
  @Post(':id/land-registry-check')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Run HM Land Registry ownership check', description: "Calls HM Land Registry's Online Owner Verification service for this property and user, persists the result on the OwnershipVerification row, and returns a verdict the frontend renders directly." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'HM Land Registry verification verdict', schema: { type: 'object', properties: {
    status: { type: 'string', enum: ['VERIFIED', 'ADDITIONAL_INFO_NEEDED', 'FAILED', 'IN_PROGRESS'] },
    typeCode: { type: 'number', description: 'HMLR OOV TypeCode (30 = result, 20 = rejection, 10 = acknowledgement/queued)' },
    matchResult: { type: 'string', nullable: true, enum: ['SINGLE_MATCH', 'MULTIPLE_MATCHES', 'NO_MATCHES'] },
    titleNumber: { type: 'string', nullable: true },
    ownership: { type: 'object', nullable: true, description: 'Raw HMLR ownership info for the top match - a direct passthrough of HM Land Registry\'s SOAP response, not independently typed anywhere in this codebase' },
    historical: { type: 'boolean' },
    rejection: { type: 'object', nullable: true, description: 'Present only on a TypeCode 20 rejection - raw HMLR passthrough, not independently typed' },
    acknowledgement: { type: 'object', nullable: true, description: 'Present only on a TypeCode 10 queued acknowledgement - raw HMLR passthrough, not independently typed' },
    messageId: { type: 'string', description: 'HMLR message id, for pinning a specific test-stub scenario or audit trace' },
  } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  async verifyOwnershipWithLandRegistry(
    @Param('id') id: string,
    @Request() req: any,
    // `| undefined` dropped: TS's emitDecoratorMetadata erases a union
    // type to generic Object, which is why this never showed a body in
    // Swagger despite LandRegistryCheckDto being fully decorated — its
    // only field is @IsOptional(), and the handler only ever reads
    // `body?.messageId`, so an absent/empty body behaves identically.
    @Body() body: LandRegistryCheckDto,
  ) {
    return this.propertyService.verifyOwnershipWithLandRegistry(
      id,
      req.user.id,
      { messageId: body?.messageId },
    );
  }

  // These must stay above @Get(':id') to avoid route conflict

  // Proxies the Street View Static API image so GOOGLE_API_KEY never
  // reaches the browser (security review, 13 Oct 2026 - every property's
  // imageUrl used to embed the raw key). lat/lon aren't secret - already
  // public on the property page - so no auth guard, matching the other
  // public property-data endpoints (epc-*, sold-history, etc.).
  @Throttle(STREET_VIEW_THROTTLE)
  @Get('street-view-image')
  @ApiOperation({ summary: 'Proxy a Google Street View image', description: "Fetches a Street View Static image server-side (so the Google API key never reaches the browser) and streams it back. Cached to limit upstream billing. No authentication required." })
  @ApiQuery({ name: 'lat', description: 'Latitude, -90 to 90', required: true })
  @ApiQuery({ name: 'lon', description: 'Longitude, -180 to 180', required: true })
  @ApiQuery({ name: 'size', description: 'Image size, e.g. "640x400"', required: false })
  @ApiQuery({ name: 'fov', description: 'Field of view in degrees', required: false })
  @ApiQuery({ name: 'pitch', description: 'Camera pitch in degrees', required: false })
  @ApiQuery({ name: 'radius', description: 'Search radius for the nearest panorama, in metres', required: false })
  @ApiResponse({ status: 200, description: 'The Street View image, streamed directly.', content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 404, description: 'Invalid lat/lon, or no Street View panorama available near this location.' })
  async getStreetViewImage(
    @Query('lat') lat: string,
    @Query('lon') lon: string,
    @Query('size') size: string | undefined,
    @Query('fov') fov: string | undefined,
    @Query('pitch') pitch: string | undefined,
    @Query('radius') radius: string | undefined,
    @Res() res: Response,
  ) {
    const parsedLat = Number(lat);
    const parsedLon = Number(lon);
    if (
      !Number.isFinite(parsedLat) ||
      !Number.isFinite(parsedLon) ||
      parsedLat < -90 ||
      parsedLat > 90 ||
      parsedLon < -180 ||
      parsedLon > 180
    ) {
      throw new NotFoundException('Invalid coordinates');
    }
    const image = await this.propertyService.fetchStreetViewImage(parsedLat, parsedLon, {
      size,
      fov: fov ? Number(fov) : undefined,
      pitch: pitch ? Number(pitch) : undefined,
      radius: radius ? Number(radius) : undefined,
    });
    if (!image) throw new NotFoundException('Street View image not available');
    res.set('Content-Type', image.contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(image.buffer);
  }

  @Get('wishlist')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get the user's wishlisted properties", description: 'Returns every property the signed-in user has wishlisted. Entirely private - never visible to the property owner.' })
  @ApiResponse({ status: 200, description: 'Array of wishlisted properties. Not paginated - every wishlisted property is returned in one call.', schema: { type: 'array', items: { type: 'object', description: 'Full Property record plus wishlistedAt - representative fields shown, not exhaustive', properties: {
    id: { type: 'string' }, addressLine1: { type: 'string' }, postcode: { type: 'string' },
    estimatedPrice: { type: 'number', nullable: true }, epcRating: { type: 'string', nullable: true },
    wishlistedAt: { type: 'string', format: 'date-time' },
  } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  async getWishlist(@Request() req: any) {
    return this.propertyService.getWishlist(req.user.id);
  }

  @Get('saved')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get the user's saved properties", description: 'Returns every property the signed-in user has saved, each with its HomeScore if one exists. Entirely private - never visible to the property owner.' })
  @ApiResponse({ status: 200, description: 'Array of saved properties with HomeScore. Not paginated - every saved property is returned in one call.', schema: { type: 'array', items: { type: 'object', description: 'Full Property record plus savedAt/homeScore - representative fields shown, not exhaustive', properties: {
    id: { type: 'string' }, addressLine1: { type: 'string' }, postcode: { type: 'string' },
    estimatedPrice: { type: 'number', nullable: true }, epcRating: { type: 'string', nullable: true },
    savedAt: { type: 'string', format: 'date-time' },
    homeScore: { type: 'number', nullable: true, description: "Caller's own HomeScore if run, else the most recent score anyone produced, else the property's EPC score" },
  } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  async getSaved(@Request() req: any) {
    return this.propertyService.getSavedProperties(req.user.id);
  }

  // Real watch list — every property the user has opted into notifications
  // for via "Watch this property" (distinct from the plain Save heart).
  // Backs pages/profile/watched-properties.vue.
  @Get('watches')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get the user's watched properties", description: "Every property the user has opted into notifications for via \"Watch this property\", distinct from the plain Save heart." })
  @ApiResponse({ status: 200, description: 'Array of watched properties. Not paginated - every watched property is returned in one call.', schema: { type: 'array', items: { type: 'object', description: 'Full Property record plus watch metadata - representative fields shown, not exhaustive', properties: {
    id: { type: 'string' }, addressLine1: { type: 'string' }, postcode: { type: 'string' },
    estimatedPrice: { type: 'number', nullable: true }, epcRating: { type: 'string', nullable: true },
    watchedAt: { type: 'string', format: 'date-time' },
    watchPrefs: { type: 'object', properties: { claimed: { type: 'boolean' }, progress: { type: 'boolean' }, published: { type: 'boolean' }, comparables: { type: 'boolean' }, homescore: { type: 'boolean' } } },
    hasPassport: { type: 'boolean' }, passportPublished: { type: 'boolean' },
    homeScore: { type: 'number', nullable: true },
  } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  async getWatches(@Request() req: any) {
    return this.propertyService.getWatchedProperties(req.user.id);
  }

  // "Recently viewed" strip — every property opened, not just saved ones.
  @Get('recently-viewed')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get recently viewed properties", description: "Every property the user has opened recently, not just saved ones - private browsing history." })
  @ApiResponse({ status: 200, description: 'Array of recently viewed properties. Not paginated.', schema: { type: 'array', items: { type: 'object', description: 'Full Property record plus viewedAt - representative fields shown, not exhaustive', properties: {
    id: { type: 'string' }, addressLine1: { type: 'string' }, postcode: { type: 'string' },
    estimatedPrice: { type: 'number', nullable: true }, epcRating: { type: 'string', nullable: true },
    viewedAt: { type: 'string', format: 'date-time' },
  } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  async getRecentlyViewed(@Request() req: any) {
    return this.propertyService.getRecentlyViewed(req.user.id);
  }

  // Fired from the property page's own mount — cheap upsert, not worth
  // throttling alongside the heavier enrichment endpoints.
  @SkipThrottle()
  @Post(':id/record-view')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Record a property page view', description: "Upsert-and-bump: fired from the property page's mount to update the user's recently-viewed list." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Acknowledgement', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  async recordView(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.recordRecentlyViewed(req.user.id, id);
  }

  // Real "N HomeScores run in the last hour" counter for the HomeScore
  // landing page's social-proof pill — no auth required, site-wide count.
  @Get('activity/last-hour')
  @ApiOperation({ summary: 'Get HomeScore activity in the last hour', description: 'Site-wide count of HomeScores run in the last hour, for the landing page social-proof pill. No authentication required.' })
  @ApiResponse({ status: 200, description: 'Activity count', schema: { type: 'object', properties: { count: { type: 'number' } } } })
  async getLastHourActivity() {
    return this.propertyService.getLastHourSearchActivity();
  }

  // Feed endpoint — JWT-gated, but the fan-out inside getForYou can
  // trigger 5+ upstream API calls (OS Places + EPC + enrichment) per
  // request, so a fully unthrottled endpoint here is a quota/cost risk
  // (security review 2026-09-22, H8) even though it's per-user. 20/min
  // is well above any legitimate mount/refresh cadence.
  @Throttle(FOR_YOU_THROTTLE)
  @Get('for-you')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get personalised "For You" property feed', description: "Fans out to several upstream APIs (OS Places, EPC, enrichment) to build a personalised feed, with the same optional filters as search." })
  @ApiQuery({ name: 'propertyType', description: 'Comma-separated property types to filter by', required: false })
  @ApiQuery({ name: 'minBedrooms', description: 'Minimum bedroom count', required: false })
  @ApiQuery({ name: 'maxBedrooms', description: 'Maximum bedroom count', required: false })
  @ApiQuery({ name: 'minEpc', description: 'Minimum EPC rating letter', required: false })
  @ApiQuery({ name: 'minHomeScore', description: 'Minimum HomeScore', required: false })
  @ApiQuery({ name: 'minPrice', description: 'Minimum price', required: false })
  @ApiQuery({ name: 'maxPrice', description: 'Maximum price', required: false })
  @ApiQuery({ name: 'passportOnly', description: 'Only properties with a passport', required: false })
  @ApiQuery({ name: 'passportStatus', description: 'Comma-separated passport status filter', required: false })
  @ApiResponse({ status: 200, description: 'Personalised property feed, ranked by match score', schema: { type: 'object', properties: {
    items: { type: 'array', items: { type: 'object', description: 'Full Property record plus a computed matchScore - representative fields shown, not exhaustive', properties: {
      id: { type: 'string' }, addressLine1: { type: 'string' }, postcode: { type: 'string' },
      estimatedPrice: { type: 'number', nullable: true }, epcRating: { type: 'string', nullable: true },
      matchScore: { type: 'number', description: 'Weighted match score: budget 40%, property type 30%, energy efficiency 30%' },
    } } },
    total: { type: 'number' },
    needsPostcode: { type: 'boolean', nullable: true, description: 'True (with an empty items array) if the user has no postcode set yet' },
  } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
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
  @ApiOperation({ summary: 'Get publicly published passport properties', description: 'Paginated list of properties with a published seller passport. No authentication required.' })
  @ApiQuery({ name: 'limit', description: 'Page size, default 12, max 50', required: false })
  @ApiQuery({ name: 'offset', description: 'Pagination offset', required: false })
  @ApiResponse({ status: 200, description: 'Published properties and total count', schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', description: 'Property record - same shape as GET /property/:id', properties: {
    id: { type: 'string' }, addressLine1: { type: 'string' }, postcode: { type: 'string' }, propertyType: { type: 'string', nullable: true }, epcRating: { type: 'string', nullable: true },
  } } }, total: { type: 'number' } } } })
  async getVerifiedPassports(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const lim = Math.min(parseInt(limit ?? '12') || 12, 50);
    const off = parseInt(offset ?? '0') || 0;
    return this.propertyService.getVerifiedPassportProperties(off, lim);
  }

  @Get(':id/actions')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get the user's wishlist/save state for a property", description: "Quick lookup of whether the signed-in user has wishlisted or saved this specific property." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Wishlist/save flags', schema: { type: 'object', properties: { wishlisted: { type: 'boolean' }, saved: { type: 'boolean' } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  async getPropertyActions(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.getPropertyActions(req.user.id, id);
  }

  @Post(':id/wishlist')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Toggle wishlist for a property', description: 'Adds the property to the wishlist if not present, removes it if already there. Private - never visible to the owner.' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'New wishlist state', schema: { type: 'object', properties: { wishlisted: { type: 'boolean' } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  async toggleWishlist(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.toggleWishlist(req.user.id, id);
  }

  @Post(':id/save')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Toggle save for a property', description: 'Adds the property to saved properties if not present, removes it if already there. Private - never visible to the owner.' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'New saved state', schema: { type: 'object', properties: { saved: { type: 'boolean' } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  async toggleSave(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.toggleSave(req.user.id, id);
  }

  // "Watch this property" — per-property notification-preference toggles
  // (components/property/WatchPropertyDrawer.vue). Body keys match the
  // drawer's toggle keys 1:1: claimed/progress/published/comparables/
  // homescore.
  @Post(':id/watch')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Set per-property notification preferences', description: 'Upserts which notification categories (claimed/progress/published/comparables/homescore) the user wants for this property.' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiBody({ schema: { type: 'object', properties: {
    claimed: { type: 'boolean', description: 'Notify when this property is claimed.' },
    progress: { type: 'boolean', description: "Notify on the owner's passport progress." },
    published: { type: 'boolean', description: 'Notify when the passport is published.' },
    comparables: { type: 'boolean', description: 'Notify when new comparable properties are found.' },
    homescore: { type: 'boolean', description: 'Notify when a HomeScore result is available.' },
  } } })
  @ApiResponse({ status: 200, description: 'The saved watch preferences', schema: { type: 'object', properties: { claimed: { type: 'boolean' }, progress: { type: 'boolean' }, published: { type: 'boolean' }, comparables: { type: 'boolean' }, homescore: { type: 'boolean' } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  async upsertPropertyWatch(
    @Param('id') id: string,
    @Request() req: any,
    @Body()
    body: UpsertPropertyWatchDto,
  ) {
    return this.propertyService.upsertPropertyWatch(req.user.id, id, body);
  }

  @Get(':id/watch')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get notification preferences for a property', description: "Returns the user's current watch preferences for this property, if any." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Watch preferences, or null if not watching', schema: { type: 'object', nullable: true, properties: { claimed: { type: 'boolean' }, progress: { type: 'boolean' }, published: { type: 'boolean' }, comparables: { type: 'boolean' }, homescore: { type: 'boolean' } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  async getPropertyWatch(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.getPropertyWatch(req.user.id, id);
  }

  @Delete(':id/watch')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Stop watching a property', description: 'Removes all notification preferences for this property.' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Updated watch state', schema: { type: 'object', properties: { watching: { type: 'boolean' } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  async deletePropertyWatch(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.deletePropertyWatch(req.user.id, id);
  }

  @Get(':id/sold-history')
  @ApiOperation({ summary: 'Get sold-price history for a property and its area', description: "Live HM Land Registry price-paid history for this property and nearby sales. No authentication required." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'This property\'s own sales plus nearby sales', schema: { type: 'object', properties: {
    thisProperty: { type: 'array', items: { type: 'object', properties: { price: { type: 'number' }, date: { type: 'string' }, address: { type: 'string' }, town: { type: 'string', nullable: true }, propertyType: { type: 'string', nullable: true }, tenure: { type: 'string', nullable: true }, newBuild: { type: 'boolean' }, isThisProperty: { type: 'boolean' } } } },
    nearbySales: { type: 'array', items: { type: 'object', properties: { price: { type: 'number' }, date: { type: 'string' }, address: { type: 'string' }, town: { type: 'string', nullable: true }, propertyType: { type: 'string', nullable: true }, tenure: { type: 'string', nullable: true }, newBuild: { type: 'boolean' }, isThisProperty: { type: 'boolean' } } } },
  } } })
  async getSoldHistory(@Param('id') id: string) {
    return this.propertyService.getLiveSoldHistory(id);
  }

  @Get(':id/enrichment')
  @ApiOperation({ summary: 'Get property enrichment data', description: "Returns the property's enrichment fields (sqft, bedrooms, year built, heating type, council tax band, EPC) sourced from EPC/OS/other upstream APIs. No authentication required." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Enrichment data', schema: { type: 'object', properties: {
    nearby: { type: 'object', description: 'OS NGD (schools) + Overpass (everything else) results, each field sorted by distanceKm ascending', properties: {
      schools: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, phase: { type: 'string', description: "'Primary' | 'Secondary' | 'Further Education' | …" }, category: { type: 'string' }, description: { type: 'string', nullable: true }, lat: { type: 'number' }, lon: { type: 'number' }, distanceKm: { type: 'number' } } } },
      trains: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, lat: { type: 'number' }, lon: { type: 'number' }, distanceKm: { type: 'number' }, operator: { type: 'string', nullable: true } } } },
      busStops: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, ref: { type: 'string', nullable: true }, lat: { type: 'number' }, lon: { type: 'number' }, distanceKm: { type: 'number' } } } },
      parks: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, lat: { type: 'number' }, lon: { type: 'number' }, distanceKm: { type: 'number' } } } },
      airports: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, iata: { type: 'string', nullable: true }, icao: { type: 'string', nullable: true }, lat: { type: 'number' }, lon: { type: 'number' }, distanceKm: { type: 'number' }, isMajor: { type: 'boolean', description: 'A recognised UK major hub, or OSM-flagged international' } } } },
      listedBuildings: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, grade: { type: 'string', description: "e.g. 'Grade I', 'Grade II*', or 'Heritage Site' when no formal grade is tagged" }, location: { type: 'string', nullable: true }, link: { type: 'string', nullable: true }, historic: { type: 'string', nullable: true } } } },
      amenities: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, category: { type: 'string' }, icon: { type: 'string', description: 'Emoji icon' }, key: { type: 'string', description: 'Raw OSM tag value, e.g. supermarket/cafe/pharmacy' }, lat: { type: 'number' }, lon: { type: 'number' }, distanceKm: { type: 'number' } } } },
    } },
    floodRisk: { type: 'object', nullable: true, properties: {
      rating: { type: 'string', enum: ['Very Low', 'Low', 'Medium', 'High', 'Severe'] },
      zones: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, severity: { type: 'string' }, riverSea: { type: 'string', nullable: true }, polygon: { type: 'object', nullable: true, description: 'GeoJSON polygon' } } } },
    } },
    salesHistory: { type: 'object', description: 'Same shape as GET /property/:id/sold-history', properties: {
      thisProperty: { type: 'array', items: { type: 'object', properties: { price: { type: 'number' }, date: { type: 'string' }, address: { type: 'string' }, town: { type: 'string', nullable: true }, propertyType: { type: 'string', nullable: true }, tenure: { type: 'string', nullable: true }, newBuild: { type: 'boolean' }, isThisProperty: { type: 'boolean' } } } },
      nearbySales: { type: 'array', items: { type: 'object', properties: { price: { type: 'number' }, date: { type: 'string' }, address: { type: 'string' }, town: { type: 'string', nullable: true }, propertyType: { type: 'string', nullable: true }, tenure: { type: 'string', nullable: true }, newBuild: { type: 'boolean' }, isThisProperty: { type: 'boolean' } } } },
    } },
    broadband: { type: 'object', nullable: true, description: 'Ofcom coverage lookup', properties: {
      available: { type: 'boolean' }, reason: { type: 'string', nullable: true, enum: ['no_key', 'rate_limited', 'unauthorized', 'not_found', 'network', 'no_premises', 'timeout'] },
      fttp: { type: 'boolean' }, fttc: { type: 'boolean' }, cable: { type: 'boolean' }, maxDownload: { type: 'number', nullable: true }, maxUpload: { type: 'number', nullable: true },
      superfast: { type: 'boolean' }, ultrafast: { type: 'boolean' },
    } },
    mobileSignal: { type: 'object', nullable: true, description: 'Ofcom per-operator coverage (EE/O2/Three/Vodafone)', properties: {
      available: { type: 'boolean' }, reason: { type: 'string', nullable: true },
      EE: { type: 'object', nullable: true, properties: { voice4g: { type: 'string', nullable: true }, data4g: { type: 'string', nullable: true }, data5g: { type: 'string', nullable: true }, indoor4g: { type: 'string', nullable: true } } },
    } },
    osPlaces: { type: 'object', nullable: true, description: 'Ordnance Survey Places API lookup', properties: {
      totalAddresses: { type: 'number' }, ward: { type: 'string', nullable: true }, localAuthority: { type: 'string', nullable: true }, country: { type: 'string' },
      addresses: { type: 'array', items: { type: 'object', properties: { uprn: { type: 'string' }, address: { type: 'string' }, classification: { type: 'string', nullable: true } } } },
    } },
    epcData: { type: 'object', nullable: true, description: 'EPC certificate', properties: {
      certUrl: { type: 'string', nullable: true }, lmkKey: { type: 'string', nullable: true }, epcRating: { type: 'string', nullable: true }, epcScore: { type: 'number', nullable: true },
      potentialRating: { type: 'string', nullable: true }, potentialScore: { type: 'number', nullable: true }, councilTaxBand: { type: 'string', nullable: true },
      floorAreaSqm: { type: 'number', nullable: true }, bedrooms: { type: 'number', nullable: true }, tenure: { type: 'string', nullable: true }, yearBuilt: { type: 'number', nullable: true }, heatingType: { type: 'string', nullable: true },
    } },
    planningData: { type: 'object', properties: {
      constraints: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, name: { type: 'string' }, reference: { type: 'string', nullable: true }, category: { type: 'string' } } } },
      applications: { type: 'array', items: { type: 'object', properties: { reference: { type: 'string', nullable: true }, description: { type: 'string', nullable: true }, status: { type: 'string', nullable: true }, decision: { type: 'string', nullable: true }, decisionDate: { type: 'string', nullable: true }, applicationType: { type: 'string', nullable: true }, docUrl: { type: 'string', nullable: true } } } },
    } },
    nearbyCouncilTax: { type: 'array', items: { type: 'object', properties: { address: { type: 'string' }, band: { type: 'string' }, annualEstimate: { type: 'number', nullable: true } } } },
    titleBoundary: { type: 'object', nullable: true, properties: { geoJson: { type: 'object', description: 'GeoJSON Feature' }, geometry: { type: 'object', description: 'GeoJSON Polygon/MultiPolygon geometry (type + coordinates) - not enumerated further, standard GeoJSON' }, areaM2: { type: 'number', nullable: true }, uprns: { type: 'array', items: { type: 'string' } } } },
    crimeStats: { type: 'object', nullable: true, properties: {
      totalLast12m: { type: 'number' }, byCategory: { type: 'array', items: { type: 'object', properties: { category: { type: 'string' }, label: { type: 'string' }, count: { type: 'number' } } } },
      monthlyTrend: { type: 'array', items: { type: 'object', properties: { month: { type: 'string' }, count: { type: 'number' } } } },
      trendDirection: { type: 'string', enum: ['up', 'down', 'flat'] }, yoyChangePct: { type: 'number', nullable: true },
    } },
    radonData: { type: 'object', nullable: true, description: 'BGS/UKHSA indicative radon potential', properties: { classMax: { type: 'number' }, band: { type: 'string', enum: ['Low', 'Moderate', 'Higher'] }, description: { type: 'string', description: "BGS's own plain-English text, surfaced verbatim" } } },
    streetViewUrl: { type: 'string', nullable: true, description: 'Proxied URL - never the raw Google API key' },
  } } })
  @ApiResponse({ status: 404, description: 'Property not found.' })
  async getEnrichment(@Param('id') id: string): Promise<any> {
    const data = await this.propertyService.getPropertyEnrichment(id);
    if (!data) throw new NotFoundException('Property not found');
    return data;
  }

  // Debug: per-source health for the enrichment pipeline. Reports which
  // upstream APIs returned data, were empty, or errored. Includes which
  // env-var keys are present without leaking values.
  @Get(':id/enrichment/debug')
  @ApiOperation({ summary: 'Debug per-source enrichment pipeline health', description: 'Reports which upstream APIs returned data, were empty, or errored for this property, and which env-var keys are present (without leaking values). Diagnostic endpoint. No authentication required.' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Per-source diagnostic report', schema: { type: 'object', properties: {
    property: { type: 'object', properties: { id: { type: 'string' }, postcode: { type: 'string', nullable: true }, lat: { type: 'number', nullable: true }, lon: { type: 'number', nullable: true }, uprn: { type: 'string', nullable: true } } },
    env: { type: 'object', description: 'Boolean presence flags for each upstream API key - never the actual values', properties: {
      OS_API_KEY: { type: 'boolean' }, OFCOM_API_KEY: { type: 'boolean' }, GOOGLE_API_KEY: { type: 'boolean' }, EPC_API_KEY: { type: 'boolean' }, MAPBOX_TOKEN: { type: 'boolean' },
    } },
    overpassBreakdown: { type: 'object', nullable: true, description: 'Per-category result counts from the combined OS NGD + Overpass nearby-features fetch', properties: {
      schools: { type: 'number', nullable: true }, trains: { type: 'number', nullable: true }, busStops: { type: 'number', nullable: true }, parks: { type: 'number', nullable: true },
      airports: { type: 'number', nullable: true }, listedBuildings: { type: 'number', nullable: true }, amenities: { type: 'number', nullable: true },
    } },
    sources: { type: 'array', items: { type: 'object', properties: {
      source: { type: 'string' }, status: { type: 'string', enum: ['ok', 'empty', 'null', 'error'] }, count: { type: 'number', nullable: true }, ms: { type: 'number' }, error: { type: 'string', nullable: true },
    } } },
  } } })
  async getEnrichmentDebug(@Param('id') id: string): Promise<any> {
    return this.propertyService.getEnrichmentDebug(id);
  }

  // Force re-fetch of the EPC certificate + recommendations from the EPC
  // Register, bypassing any "already enriched" early-return. Used by the
  // homescore page when `epcRecommendations` is empty on the row so we can
  // recover from a previously-failed enrichment.
  @Post(':id/epc-refresh')
  @ApiOperation({ summary: 'Force a fresh EPC lookup', description: "Bypasses the \"already enriched\" early-return and re-fetches the EPC certificate/recommendations from the EPC Register, to recover from a previously-failed enrichment." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'The updated Property record (or null if the property was not found)', schema: { type: 'object', nullable: true, description: 'Full Property record with refreshed EPC fields - representative fields shown, not exhaustive', properties: {
    id: { type: 'string' }, addressLine1: { type: 'string' }, postcode: { type: 'string' },
    epcRating: { type: 'string', nullable: true }, epcScore: { type: 'number', nullable: true },
    epcLmkKey: { type: 'string', nullable: true }, epcRecommendations: { type: 'array', nullable: true, items: { type: 'object', properties: {
      id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string', nullable: true }, costRange: { type: 'string', nullable: true },
      typicalSaving: { type: 'number', nullable: true }, resultingSap: { type: 'number', nullable: true }, resultingEnvRating: { type: 'number', nullable: true }, improvementType: { type: 'string', nullable: true },
    } } },
  } } })
  async refreshEpc(@Param('id') id: string): Promise<any> {
    const data = await this.propertyService.refreshEpc(id);
    if (!data) throw new NotFoundException('Property not found');
    return data;
  }

  @Post(':id/homescore')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Save a HomeScore result', description: 'Persists the HomeScore quiz result (total, rating, pillar scores, answers) for this user and property.' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'The saved HomeScore record', schema: { type: 'object', properties: {
    id: { type: 'string' }, propertyId: { type: 'string' }, userId: { type: 'string' },
    total: { type: 'number' }, rating: { type: 'string' }, answers: { type: 'object', description: 'Record<questionId, answer> - the quiz question set varies, so keys are not fixed', additionalProperties: { type: 'string' } },
    tier: { type: 'string', nullable: true, enum: ['estimated', 'verified', 'certified'] },
    baseBill: { type: 'number', nullable: true }, adjustedBill: { type: 'number', nullable: true }, actualBill: { type: 'number', nullable: true },
    costPerSqm: { type: 'number', nullable: true }, neighbourMedian: { type: 'number', nullable: true }, billDifference: { type: 'number', nullable: true },
    costEfficiency: { type: 'number', nullable: true }, insulation: { type: 'number', nullable: true }, heating: { type: 'number', nullable: true },
    controls: { type: 'number', nullable: true }, ventilation: { type: 'number', nullable: true }, lighting: { type: 'number', nullable: true }, renewableBonus: { type: 'number', nullable: true },
  } } })
  async saveHomeScore(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: SaveHomeScoreDto,
  ) {
    return this.propertyService.saveHomeScore(id, req.user.id, body);
  }

  @Get(':id/homescore/public')
  @ApiOperation({ summary: "Get the property's public HomeScore", description: "Returns the owning seller's HomeScore if published, otherwise the most recently updated HomeScore on this property. No authentication required." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'A HomeScore record, or null', schema: { type: 'object', nullable: true, properties: {
    id: { type: 'string' }, propertyId: { type: 'string' }, userId: { type: 'string' }, total: { type: 'number' }, rating: { type: 'string' }, tier: { type: 'string', nullable: true },
  }, description: 'Same shape as POST :id/homescore\'s response - abbreviated here, see that endpoint for the full field list' } })
  async getPublicHomeScore(@Param('id') id: string) {
    return this.propertyService.getPublicHomeScore(id);
  }

  @Get(':id/homescore')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get the signed-in user's HomeScore for a property", description: "Returns this specific user's own HomeScore result for the property, if they've run one." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'HomeScore record, or null', schema: { type: 'object', nullable: true, properties: {
    id: { type: 'string' }, propertyId: { type: 'string' }, userId: { type: 'string' }, total: { type: 'number' }, rating: { type: 'string' }, tier: { type: 'string', nullable: true },
  }, description: 'Same shape as POST :id/homescore\'s response - abbreviated here, see that endpoint for the full field list' } })
  async getHomeScore(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.getHomeScore(id, req.user.id);
  }

  // ── HomeScore publishing (to the street pool) ──────────────────────────
  @Post(':id/homescore/publish')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Publish the user's HomeScore to the street pool", description: 'Marks the HomeScore as published, making it count toward street-level publish stats and comparables. Fails if no HomeScore exists yet.' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Updated HomeScore record', schema: { type: 'object', properties: {
    id: { type: 'string' }, propertyId: { type: 'string' }, userId: { type: 'string' }, total: { type: 'number' }, rating: { type: 'string' },
  }, description: 'Same shape as POST :id/homescore\'s response - abbreviated here, see that endpoint for the full field list' } })
  async publishHomeScore(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.publishHomeScore(id, req.user.id);
  }

  @Post(':id/homescore/unpublish')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Unpublish the user's HomeScore", description: 'Takes the HomeScore back out of the street pool.' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Updated HomeScore record', schema: { type: 'object', properties: {
    id: { type: 'string' }, propertyId: { type: 'string' }, userId: { type: 'string' }, total: { type: 'number' }, rating: { type: 'string' },
  }, description: 'Same shape as POST :id/homescore\'s response - abbreviated here, see that endpoint for the full field list' } })
  async unpublishHomeScore(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.unpublishHomeScore(id, req.user.id);
  }

  @Get(':id/street-publish-stats')
  @ApiOperation({ summary: 'Get street-level HomeScore publish stats', description: "Anonymised stats (total homes seen, homes with a published HomeScore) for the property's postcode outcode, for the publish screen's progress bar." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Street publish stats', schema: { type: 'object', properties: { outcode: { type: 'string' }, streetName: { type: 'string' }, totalHomes: { type: 'number' }, publishedHomes: { type: 'number' } } } })
  async getStreetPublishStats(@Param('id') id: string) {
    return this.propertyService.getStreetPublishStats(id);
  }

  // Energy-cost rank among neighbouring properties on the same outcode.
  // Powers the "Nth of M on street" + "best on street £X/yr" copy on the
  // buyer-results screen.
  @Get(':id/street-energy-rank')
  @ApiOperation({ summary: 'Get energy-cost rank among neighbouring properties', description: 'Ranks this property by energy cost among properties sharing its postcode outcode, powering the "Nth of M on street" comparison.' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Street energy ranking and neighbour comparison', schema: { type: 'object', properties: {
    rank: { type: 'number', nullable: true }, total: { type: 'number' }, bestCost: { type: 'number', nullable: true }, averageCost: { type: 'number', nullable: true }, yourCost: { type: 'number', nullable: true }, yourEpcRating: { type: 'string', nullable: true },
    epcDistribution: { type: 'array', items: { type: 'object', properties: { letter: { type: 'string' }, count: { type: 'number' } } } },
    avgEpcScore: { type: 'number', nullable: true },
    neighbours: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, cost: { type: 'number' }, epcRating: { type: 'string', nullable: true }, isYou: { type: 'boolean' } } } },
  } } })
  async getStreetEnergyRank(@Param('id') id: string) {
    return this.propertyService.getStreetEnergyRank(id);
  }

  // ── Bill OCR + parsing ─────────────────────────────────────────────────
  // Owner uploads a recent energy bill from the simulator; we OCR it with
  // Tesseract and parse the structured spend, supplier, and period. The
  // parsed result is persisted on the property and echoed back so the UI
  // can immediately reflect actual figures in the score / cost cards.
  //
  // Stays on local disk (not createUploadStorage/S3) even in production —
  // Tesseract needs a real filesystem path to read, and the file is a
  // scratch input for OCR text extraction, never served back to any
  // client. Still had no mimetype filter at all before this fix, and
  // derived its extension from the client filename like the other
  // upload endpoints (security review 2026-09-22, H3) — fixed the same
  // way: allow-list + extension derived from the validated mimetype, and
  // the temp file is now deleted once OCR is done since nothing needs it
  // afterwards.
  @Post(':id/bill-parse')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'Photo, scan, or PDF of an energy bill to OCR-parse.' },
      },
    },
  })
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
          const ext = BILL_MIME_EXT[file.mimetype] ?? '.bin';
          cb(null, `${unique}${ext}`);
        },
      }),
      limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
      fileFilter: (_req, file, cb) => {
        cb(null, file.mimetype in BILL_MIME_EXT);
      },
    }),
  )
  @ApiOperation({ summary: 'Upload and OCR-parse an energy bill', description: "Accepts a photo/scan/PDF of an energy bill, runs Tesseract OCR, parses the structured spend/supplier/period, and persists the result on the property. Requires the caller to manage this property." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Parsed bill data (all numeric fields are £/yr, normalised from the detected billing period; any field is null if OCR could not find it)', schema: { type: 'object', properties: {
    annualSpend: { type: 'number', nullable: true }, gasSpend: { type: 'number', nullable: true }, electricitySpend: { type: 'number', nullable: true },
    supplier: { type: 'string', nullable: true }, period: { type: 'string', enum: ['annual', 'quarterly', 'monthly', 'unknown'] }, rawText: { type: 'string' },
  } } })
  async parseBill(
    @Param('id') id: string,
    @Request() req: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @UploadedFile() file: any,
  ) {
    if (!file) throw new NotFoundException('No file uploaded');
    try {
      await this.propertyService.assertPropertyManager(id, req.user.id);
      return await this.billParser.parseAndSave(id, file.path, file.mimetype);
    } finally {
      unlink(file.path, () => {});
    }
  }

  // ── KYC / ownership verification ───────────────────────────────────────
  @Post(':id/kyc/submit')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Submit an ownership verification method', description: "Starts or re-submits an OwnershipVerification for this property using one of three methods: photo-id, mortgage, or open-banking." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'The created/updated OwnershipVerification row', schema: { type: 'object', properties: {
    id: { type: 'string' }, propertyId: { type: 'string' }, userId: { type: 'string' },
    status: { type: 'string', enum: ['SUBMITTED', 'IN_PROGRESS', 'VERIFIED', 'ADDITIONAL_INFO_NEEDED', 'FAILED'] },
    verificationMethod: { type: 'string', nullable: true, enum: ['photo-id', 'mortgage', 'open-banking'] },
    submittedAt: { type: 'string', format: 'date-time' }, verifiedAt: { type: 'string', format: 'date-time', nullable: true },
  } } })
  async submitKyc(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: SubmitKycDto,
  ) {
    return this.propertyService.submitKyc(id, req.user.id, body?.method);
  }

  @Get(':id/kyc/status')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get ownership KYC status', description: "Returns this user's OwnershipVerification record for the property." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Verification record, or null', schema: { type: 'object', nullable: true, properties: {
    id: { type: 'string' }, status: { type: 'string', enum: ['SUBMITTED', 'IN_PROGRESS', 'VERIFIED', 'ADDITIONAL_INFO_NEEDED', 'FAILED'] },
    verificationMethod: { type: 'string', nullable: true, enum: ['photo-id', 'mortgage', 'open-banking'] },
  } } })
  async getKycStatus(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.getKycStatus(id, req.user.id);
  }

  @Get(':id/neighbourhood')
  @ApiOperation({ summary: 'Get neighbourhood EPC price stats', description: "Fetches up to 100 EPC records for the property's postcode and computes median/standard-deviation cost stats. No authentication required." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Neighbourhood statistics', schema: { type: 'object', properties: { median: { type: 'number', nullable: true }, stdDev: { type: 'number', nullable: true }, sampleSize: { type: 'number' }, postcode: { type: 'string', nullable: true } } } })
  async getNeighbourhood(@Param('id') id: string) {
    return this.propertyService.getNeighbourhoodStats(id);
  }

  // Aggregate market stats for an area (postcode-sector level by default).
  // Used by the "Market pulse" card on the explore home. Returns only the
  // figures we can actually compute from Land Registry + Passport tables —
  // the frontend hides any field that comes back null.
  @Get('market-pulse')
  @ApiOperation({ summary: 'Get area market-pulse stats', description: 'Aggregate year-on-year price change, average days to sell, and passport listing counts for a postcode sector, computed from Land Registry and Passport data. Fields the backend cannot compute are returned null rather than guessed. No authentication required.' })
  @ApiQuery({ name: 'postcode', description: 'Postcode to compute stats for (sector-level)', required: false })
  @ApiResponse({ status: 200, description: 'Market pulse stats', schema: { type: 'object', properties: { area: { type: 'string', nullable: true }, priceChangeYoY: { type: 'number', nullable: true }, avgDaysToSell: { type: 'number', nullable: true }, passportListings: { type: 'number' }, sampleSize: { type: 'object', properties: { recent: { type: 'number' }, prior: { type: 'number' } } } } } })
  async getMarketPulse(@Query('postcode') postcode?: string) {
    return this.propertyService.getMarketPulse(postcode);
  }


  @Get(':id/running-costs')
  @ApiOperation({ summary: 'Get estimated running costs for a property', description: 'Returns estimated ongoing running costs (energy, council tax, etc.) computed for this property. No authentication required.' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Running cost breakdown', schema: { type: 'object', properties: {
    energy: { type: 'object', properties: {
      heating: { type: 'object', properties: { cost: { type: 'number' }, kwh: { type: 'number', nullable: true }, tariff: { type: 'number' }, label: { type: 'string' } } },
      hotWater: { type: 'object', properties: { cost: { type: 'number' }, kwh: { type: 'number', nullable: true }, tariff: { type: 'number' }, label: { type: 'string' } } },
      electricity: { type: 'object', properties: { cost: { type: 'number' }, kwh: { type: 'number', nullable: true }, tariff: { type: 'number' }, label: { type: 'string' } } },
      total: { type: 'number' }, potentialTotal: { type: 'number' }, potentialSaving: { type: 'number' },
    } },
    energyDetail: { type: 'object', properties: {
      gasKwh: { type: 'number', nullable: true }, electricityKwh: { type: 'number', nullable: true }, sapCurrent: { type: 'number' }, sapTarget: { type: 'number' },
      epcRating: { type: 'string' }, epcTarget: { type: 'string' }, primaryEnergyUse: { type: 'number', nullable: true }, primaryEnergyTarget: { type: 'number' }, floorAreaSqm: { type: 'number', nullable: true },
    } },
    risks: { type: 'object', description: 'flood/mining/planning risk levels', properties: {
      flood: { type: 'object', properties: { level: { type: 'string', enum: ['low', 'medium', 'high', 'clear'] }, label: { type: 'string' }, pill: { type: 'string' } } },
      mining: { type: 'object', properties: { level: { type: 'string', enum: ['low', 'medium', 'high', 'clear'] }, label: { type: 'string' }, pill: { type: 'string' } } },
      planning: { type: 'object', properties: { level: { type: 'string', enum: ['low', 'medium', 'high', 'clear'] }, label: { type: 'string' }, pill: { type: 'string' } } },
    } },
    environmentalImpact: { type: 'object', properties: {
      co2Now: { type: 'number' }, co2Potential: { type: 'number' }, reductionPct: { type: 'number' }, ukAverage: { type: 'number' },
      co2NowKg: { type: 'number' }, co2PotentialKg: { type: 'number' }, ukAverageKg: { type: 'number' }, savingKg: { type: 'number' },
      ratingCurrent: { type: 'string' }, ratingPotential: { type: 'string' }, ratingLabel: { type: 'string', description: 'EPC-style rating label (Very low -> Very high)' },
    } },
    savings: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, sub: { type: 'string' }, amount: { type: 'number' }, points: { type: 'number' } } }, description: 'Top-3 EPC-driven money-saving improvements, ranked by annual £ saving' },
    water: { type: 'object', properties: { cost: { type: 'number' }, label: { type: 'string' } } },
    councilTax: { type: 'object', properties: { band: { type: 'string' }, cost: { type: 'number' }, council: { type: 'string' } } },
    totalAnnual: { type: 'number' }, totalMonthly: { type: 'number' }, streetAverageEnergy: { type: 'number' },
    epcYear: { type: 'number', nullable: true }, confidence: { type: 'string', enum: ['epc', 'estimated'], description: 'Source of the underlying figures - drives the confidence banner copy' },
  } } })
  async getRunningCosts(@Param('id') id: string) {
    return this.runningCostsService.getRunningCosts(id);
  }

  // Anonymous "I looked at this address" log — used to render the
  // "People searched this address this month" card. No auth required;
  // we accept an optional sessionId from the client for guest dedup.
  @Post(':id/log-search')
  @ApiOperation({ summary: 'Log an anonymous property address view', description: "Records an \"I looked at this address\" event, used for the \"People searched this address this month\" card. Attempts to detect a signed-in user from the JWT but does not require one - guests are logged via an optional sessionId." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Whether the view was logged', schema: { type: 'object', properties: { logged: { type: 'boolean' } } } })
  async logSearch(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: LogSearchDto,
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
  @ApiOperation({ summary: 'Get search activity stats for a property', description: "Today/this-month/all-time view counts and distinct session counts for this property's address." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Search activity stats', schema: { type: 'object', properties: {
    today: { type: 'number' }, thisMonth: { type: 'number' }, allTime: { type: 'number' },
    distinctVisitors: { type: 'number', description: 'Distinct session + distinct signed-in-user count combined' },
    watchers: { type: 'number', description: 'Wishlist count + saved-property count combined' },
  } } })
  async getSearchStats(@Param('id') id: string) {
    return this.propertyService.getPropertySearchStats(id);
  }

  @Get(':id/street')
  @ApiOperation({ summary: 'Get other properties on the same street', description: "Up to 10 nearby properties sharing this property's postcode, for the Street comparison tab." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Nearby properties and stats', schema: { type: 'object', properties: {
    properties: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, addressLine1: { type: 'string' }, propertyType: { type: 'string', nullable: true }, bedrooms: { type: 'number', nullable: true }, epcRating: { type: 'string', nullable: true }, price: { type: 'number', nullable: true },
      hasPassport: { type: 'boolean' }, isPublished: { type: 'boolean' }, passportStatus: { type: 'string', nullable: true },
    } } },
    postcode: { type: 'string', nullable: true },
    stats: { type: 'object', nullable: true, properties: { published: { type: 'number' }, started: { type: 'number' }, notStarted: { type: 'number' }, avgEpc: { type: 'string', nullable: true }, avgPrice: { type: 'number', nullable: true } } },
  } } })
  async getStreetProperties(@Param('id') id: string) {
    return this.propertyService.getStreetProperties(id);
  }

  @Get(':id/matched-buyers')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get buyers matched to this property', description: "Returns verified buyer profiles whose criteria match this property, excluding the property's own passport team (owner and collaborators). Requires the caller to manage this property." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Up to 8 matched buyers, ranked by match score, plus the total candidate pool size.', schema: { type: 'object', properties: {
    buyers: { type: 'array', items: { type: 'object', properties: {
      userId: { type: 'string' }, name: { type: 'string', example: 'Jordan K.' }, area: { type: 'string', example: 'SW11' },
      budget: { type: 'string', example: 'Up to £450k' }, timeline: { type: 'string', example: 'Ready to buy now' },
      matchScore: { type: 'number', description: 'Weighted score: 60% budget fit, 40% property-type match' },
      tags: { type: 'array', items: { type: 'string' }, example: ['Strong match', 'Active buyer'] },
    } } },
    total: { type: 'number', description: 'Size of the candidate pool before ranking/truncating to 8' },
  } } })
  async getMatchedBuyers(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.getMatchedBuyers(id, req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a property by ID', description: 'Returns the full property record, including a summary of its seller passport(s) if any. Landlord passports are never exposed here - this view is buyer-facing. No authentication required.' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'The property record', schema: { type: 'object', description: 'Full Property record - representative fields shown, not exhaustive', properties: {
    id: { type: 'string' }, udprn: { type: 'string', nullable: true }, uprn: { type: 'string', nullable: true },
    addressLine1: { type: 'string' }, addressLine2: { type: 'string', nullable: true }, city: { type: 'string', nullable: true }, postcode: { type: 'string' },
    nation: { type: 'string', nullable: true, enum: ['England', 'Wales', 'Scotland', 'Northern Ireland'] },
    latitude: { type: 'number', nullable: true }, longitude: { type: 'number', nullable: true },
    propertyType: { type: 'string', nullable: true }, bedrooms: { type: 'number', nullable: true }, bathrooms: { type: 'number', nullable: true },
    sqft: { type: 'number', nullable: true }, epcRating: { type: 'string', nullable: true }, epcScore: { type: 'number', nullable: true },
    tenure: { type: 'string', nullable: true }, yearBuilt: { type: 'number', nullable: true },
    estimatedPrice: { type: 'number', nullable: true }, lastSoldPrice: { type: 'number', nullable: true }, lastSoldDate: { type: 'string', format: 'date-time', nullable: true },
    councilTaxBand: { type: 'string', nullable: true }, councilTaxAnnual: { type: 'number', nullable: true },
  } } })
  async getProperty(@Param('id') id: string) {
    const property = await this.propertyService.getPropertyById(id);
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }

  @Post(':id/register-interest')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Register buyer interest in a property', description: "Sends the property owner an email with the buyer's chosen interest level (Dream Home / Super Keen / Just Browsing) and name/email. Nothing else is shared." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Acknowledgement', schema: { type: 'object', properties: { success: { type: 'boolean' } } } })
  async registerInterest(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: RegisterInterestDto,
  ) {
    return this.propertyService.registerInterest(id, req.user.id, body);
  }

  @Post(':id/tap-owner')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Message the property owner directly', description: "Sends the owner a message with the buyer's name and email, and their phone number only if sharePhone is explicitly set. Requires a phone number on the buyer's own profile." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Whether the message was sent, and the owner phone if shared back for display', schema: { type: 'object', properties: { success: { type: 'boolean' }, ownerPhone: { type: 'string', nullable: true } } } })
  async tapOwner(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: TapOwnerDto,
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
  @ApiOperation({ summary: "Get a link to the property's EPC certificate", description: "Resolves the EPC LMK key via UPRN lookup so the frontend can link directly to the official gov.uk EPC certificate page." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'EPC certificate reference', schema: { type: 'object', properties: { lmkKey: { type: 'string' } } } })
  async epcDownloadInfo(@Param('id') id: string) {
    const info = await this.propertyService.getEpcDownloadInfo(id);
    if (!info) throw new NotFoundException('EPC certificate not available for this property');
    return { lmkKey: info.lmkKey };
  }

  // Self-contained HTML of the official EPC certificate (fetched
  // server-side from find-energy-certificate.service.gov.uk with its
  // CSS + images inlined) so the app can turn it into a downloadable
  // PDF without sending the user off-site.
  @Get(':id/epc-certificate')
  @ApiOperation({ summary: "Get a self-contained HTML copy of the EPC certificate", description: 'Fetches the official EPC certificate HTML server-side (with CSS/images inlined) so the app can render or convert it to PDF without sending the user off-site.' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Certificate HTML and its LMK key', schema: { type: 'object', properties: { html: { type: 'string' }, lmkKey: { type: 'string' } } } })
  async epcCertificate(@Param('id') id: string) {
    const result = await this.propertyService.getEpcCertificateHtml(id);
    if (!result) throw new NotFoundException('EPC certificate not available for this property');
    return result;
  }
}
