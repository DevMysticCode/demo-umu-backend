import { Controller, Post, Delete, Headers, HttpCode, HttpStatus, ForbiddenException } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';

@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  private guard(secret: string | undefined) {
    const expected = process.env.ADMIN_SECRET;
    if (!expected || secret !== expected) {
      throw new ForbiddenException('Invalid or missing admin secret');
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
  async deletePassports(@Headers('x-admin-secret') secret: string) {
    this.guard(secret);
    return this.maintenanceService.deleteAllPassports();
  }

  /** Delete all Property records (passports must be cleared first) */
  @Delete('properties')
  @HttpCode(HttpStatus.OK)
  async deleteProperties(@Headers('x-admin-secret') secret: string) {
    this.guard(secret);
    return this.maintenanceService.deleteAllProperties();
  }

  /** One-shot: clear Pexels images + delete all passports + delete all properties */
  @Delete('all')
  @HttpCode(HttpStatus.OK)
  async deleteAll(@Headers('x-admin-secret') secret: string) {
    this.guard(secret);
    return this.maintenanceService.nukeAll();
  }
}
