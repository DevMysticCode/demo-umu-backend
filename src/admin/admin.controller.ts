import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { AdminService } from './admin.service';

// Deliberately separate from MaintenanceModule (excluded from production
// builds — see app.module.ts's PROD_BUILD comment): that module holds
// genuinely destructive bulk-wipe endpoints (delete ALL passports/
// properties) that must never be reachable in prod. Deleting specific,
// named accounts by email is a much narrower, safe-by-construction action
// (same x-admin-secret guard) that's still needed in prod — RDS sits in a
// private subnet with no other way to remove a test/scratch account.
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  private guard(secret: string | undefined) {
    const expected = process.env.ADMIN_SECRET;
    if (!expected || secret !== expected) {
      throw new ForbiddenException('Invalid or missing admin secret');
    }
  }

  /** Read-only: find accounts whose email contains any of the given
   * comma-separated substrings — for reviewing a bulk delete before running
   * it (query: ?contains=foo,bar) */
  @Get('users/search')
  @HttpCode(HttpStatus.OK)
  async searchUsers(
    @Headers('x-admin-secret') secret: string,
    @Query('contains') contains: string,
  ) {
    this.guard(secret);
    const substrings = (contains ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (substrings.length === 0) {
      throw new BadRequestException('contains must be a non-empty comma-separated list');
    }
    return this.adminService.findUsersByEmailContains(substrings);
  }

  /** Delete one or more user accounts by email (body: { emails: string[] }) */
  @Delete('users')
  @HttpCode(HttpStatus.OK)
  async deleteUsers(
    @Headers('x-admin-secret') secret: string,
    @Body('emails') emails: string[],
  ) {
    this.guard(secret);
    if (!Array.isArray(emails) || emails.length === 0) {
      throw new BadRequestException('emails must be a non-empty array');
    }
    return this.adminService.deleteUsersByEmail(emails);
  }
}
