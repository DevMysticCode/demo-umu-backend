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
} from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { timingSafeStringEqual } from '../common/timing-safe-equal';

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

@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  private guard(secret: string | undefined) {
    const expected = process.env.ADMIN_SECRET;
    if (!expected || !timingSafeStringEqual(secret, expected)) {
      throw new ForbiddenException('Invalid or missing admin secret');
    }
  }

  private guardDestructive(secret: string | undefined, confirm: string | undefined) {
    this.guard(secret);
    if (confirm !== CONFIRM_WIPE) {
      throw new BadRequestException(`confirm must be '${CONFIRM_WIPE}'`);
    }
  }

  /** Set imageUrl = NULL for all properties with Pexels image URLs */
  @Post('fix-images')
  @HttpCode(HttpStatus.OK)
  async fixImages(@Headers('x-admin-secret') secret: string) {
    this.guard(secret);
    return this.maintenanceService.clearPexelsImages();
  }

  /** Delete all Passport records (cascades sections, tasks, collaborators, etc.) */
  @Delete('passports')
  @HttpCode(HttpStatus.OK)
  async deletePassports(
    @Headers('x-admin-secret') secret: string,
    @Body('confirm') confirm: string,
  ) {
    this.guardDestructive(secret, confirm);
    return this.maintenanceService.deleteAllPassports();
  }

  /** Delete all Property records (passports must be cleared first) */
  @Delete('properties')
  @HttpCode(HttpStatus.OK)
  async deleteProperties(
    @Headers('x-admin-secret') secret: string,
    @Body('confirm') confirm: string,
  ) {
    this.guardDestructive(secret, confirm);
    return this.maintenanceService.deleteAllProperties();
  }

  /** One-shot: clear Pexels images + delete all passports + delete all properties */
  @Delete('all')
  @HttpCode(HttpStatus.OK)
  async deleteAll(
    @Headers('x-admin-secret') secret: string,
    @Body('confirm') confirm: string,
  ) {
    this.guardDestructive(secret, confirm);
    return this.maintenanceService.nukeAll();
  }
}
