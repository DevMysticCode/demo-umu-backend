import {
  Controller,
  Post,
  Delete,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  BadRequestException,
  Ip,
  Logger,
} from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { timingSafeStringEqual } from '../common/timing-safe-equal';
import { ApiOperation, ApiResponse, ApiHeader, ApiBody } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

// Total-data-loss endpoints (deleteMany({}) with no filter). The only
// thing keeping this module out of production is `PROD_BUILD` in
// app.module.ts excluding it when NODE_ENV === 'production' — a real
// gate for the actual deployed image, but the module itself has no
// second, independent safety if some other environment (a manual
// `docker run`, a differently-configured host reusing this image, a
// local build accidentally pointed at a prod DATABASE_URL) doesn't go
// through that exact build path. The `confirm` literal below is that
// second gate — it doesn't depend on any env var, so it still protects
// even when PROD_BUILD's exclusion somehow doesn't apply (security
// review 2026-09-22, H10).
const CONFIRM_WIPE = 'DELETE-EVERYTHING';

// Security/launch review finding #8: same static-secret weakness as
// AdminController, logged and rate-limited the same way here too — this
// module is excluded from production builds (see app.module.ts), but that
// exclusion is only as good as NODE_ENV being set correctly on every
// environment that loads this image (e.g. the Railway deployment currently
// holding real user data, per DEPLOYMENT.md), so it still needs its own
// independent hardening rather than relying solely on PROD_BUILD.
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@Controller('maintenance')
export class MaintenanceController {
  private readonly logger = new Logger(MaintenanceController.name);

  constructor(private readonly maintenanceService: MaintenanceService) {}

  private guard(secret: string | undefined, ip: string, route: string) {
    const expected = process.env.ADMIN_SECRET;
    const ok = !!expected && timingSafeStringEqual(secret, expected);
    this.logger.warn(
      `maintenance call: route=${route} ip=${ip} result=${ok ? 'ALLOWED' : 'DENIED'}`,
    );
    if (!ok) {
      throw new ForbiddenException('Invalid or missing admin secret');
    }
  }

  private guardDestructive(
    secret: string | undefined,
    confirm: string | undefined,
    ip: string,
    route: string,
  ) {
    this.guard(secret, ip, route);
    if (confirm !== CONFIRM_WIPE) {
      throw new BadRequestException(`confirm must be '${CONFIRM_WIPE}'`);
    }
  }

  /** Set imageUrl = NULL for all properties with Pexels image URLs */
  @ApiOperation({ summary: 'Clear placeholder Pexels property images', description: "Admin-secret-gated. Sets imageUrl to NULL for every property whose image is a Pexels placeholder URL. This module is excluded entirely from production builds (PROD_BUILD)." })
  @ApiHeader({ name: 'x-admin-secret', description: 'Shared admin secret' })
  @ApiResponse({ status: 200, description: 'Count of properties updated.', schema: { type: 'object', properties: { updated: { type: 'number' } } } })
  @ApiResponse({ status: 403, description: 'Missing or invalid x-admin-secret.' })
  @Post('fix-images')
  @HttpCode(HttpStatus.OK)
  async fixImages(
    @Headers('x-admin-secret') secret: string,
    @Ip() ip: string,
  ) {
    this.guard(secret, ip, 'POST /maintenance/fix-images');
    return this.maintenanceService.clearPexelsImages();
  }

  /** Delete all Passport records (cascades sections, tasks, collaborators, etc.) */
  @ApiOperation({ summary: 'Delete every Passport record', description: "DESTRUCTIVE. Admin-secret-gated and requires body.confirm === 'DELETE-EVERYTHING' as a second gate independent of environment. Cascades sections, tasks, collaborators, etc. Excluded from production builds." })
  @ApiHeader({ name: 'x-admin-secret', description: 'Shared admin secret' })
  @ApiBody({ schema: { type: 'object', required: ['confirm'], properties: { confirm: { type: 'string', description: "Must equal the literal string 'DELETE-EVERYTHING'" } } } })
  @ApiResponse({ status: 200, description: 'Count of passports deleted.', schema: { type: 'object', properties: { deleted: { type: 'number' } } } })
  @ApiResponse({ status: 403, description: 'Missing or invalid x-admin-secret.' })
  @ApiResponse({ status: 400, description: "confirm did not equal 'DELETE-EVERYTHING'." })
  @Delete('passports')
  @HttpCode(HttpStatus.OK)
  async deletePassports(
    @Headers('x-admin-secret') secret: string,
    @Body('confirm') confirm: string,
    @Ip() ip: string,
  ) {
    this.guardDestructive(secret, confirm, ip, 'DELETE /maintenance/passports');
    return this.maintenanceService.deleteAllPassports();
  }

  /** Delete all Property records (passports must be cleared first) */
  @ApiOperation({ summary: 'Delete every Property record', description: "DESTRUCTIVE. Admin-secret-gated plus the same 'DELETE-EVERYTHING' confirm literal. Passports must already be cleared first (FK constraint). Excluded from production builds." })
  @ApiHeader({ name: 'x-admin-secret', description: 'Shared admin secret' })
  @ApiBody({ schema: { type: 'object', required: ['confirm'], properties: { confirm: { type: 'string', description: "Must equal the literal string 'DELETE-EVERYTHING'" } } } })
  @ApiResponse({ status: 200, description: 'Count of properties deleted.', schema: { type: 'object', properties: { deleted: { type: 'number' } } } })
  @Delete('properties')
  @HttpCode(HttpStatus.OK)
  async deleteProperties(
    @Headers('x-admin-secret') secret: string,
    @Body('confirm') confirm: string,
    @Ip() ip: string,
  ) {
    this.guardDestructive(secret, confirm, ip, 'DELETE /maintenance/properties');
    return this.maintenanceService.deleteAllProperties();
  }

  /** One-shot: clear Pexels images + delete all passports + delete all properties */
  @ApiOperation({ summary: 'Wipe passports, properties and placeholder images in one call', description: "DESTRUCTIVE, one-shot combination of all three operations above. Admin-secret-gated plus the 'DELETE-EVERYTHING' confirm literal. Excluded from production builds." })
  @ApiHeader({ name: 'x-admin-secret', description: 'Shared admin secret' })
  @ApiBody({ schema: { type: 'object', required: ['confirm'], properties: { confirm: { type: 'string', description: "Must equal the literal string 'DELETE-EVERYTHING'" } } } })
  @ApiResponse({ status: 200, description: 'Summary of what was wiped.', schema: { type: 'object', properties: { passportsDeleted: { type: 'number' }, propertiesDeleted: { type: 'number' } } } })
  @Delete('all')
  @HttpCode(HttpStatus.OK)
  async deleteAll(
    @Headers('x-admin-secret') secret: string,
    @Body('confirm') confirm: string,
    @Ip() ip: string,
  ) {
    this.guardDestructive(secret, confirm, ip, 'DELETE /maintenance/all');
    return this.maintenanceService.nukeAll();
  }
}
