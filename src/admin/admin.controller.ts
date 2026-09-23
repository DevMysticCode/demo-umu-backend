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
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { timingSafeStringEqual } from '../common/timing-safe-equal';

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
    if (!expected || !timingSafeStringEqual(secret, expected)) {
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

  /** Read-only: every FounderNumber row, for reviewing before a one-off
   * sequence reset. */
  @Get('founder-numbers')
  @HttpCode(HttpStatus.OK)
  async listFounderNumbers(@Headers('x-admin-secret') secret: string) {
    this.guard(secret);
    return this.adminService.listFounderNumbers();
  }

  /** One-off: wipe FounderNumber and restart its sequence at `restartAt`
   * (body: { restartAt: number, confirm: 'RESET-FOUNDER-SEQ' }). Meant to be
   * called once, right after the founder-number model moved to one-per-
   * claimed-property, to line the launch sequence up on both databases. */
  @Delete('founder-numbers')
  @HttpCode(HttpStatus.OK)
  async resetFounderNumbers(
    @Headers('x-admin-secret') secret: string,
    @Body('restartAt') restartAt: number,
    @Body('confirm') confirm: string,
  ) {
    this.guard(secret);
    if (!Number.isInteger(restartAt) || restartAt <= 0) {
      throw new BadRequestException('restartAt must be a positive integer');
    }
    return this.adminService.resetFounderNumberSequence(restartAt, confirm);
  }

  /** Grant or revoke the isAdmin flag on one account by email (body:
   * { isAdmin: boolean }). The only way any account ever becomes an
   * admin — there is no self-service path. Used to gate endpoints that
   * need a real per-operator identity on top of the shared admin secret
   * (security review 2026-09-22, M6), e.g. buyer-profile's KYC review
   * queue. */
  @Post('users/:email/admin-role')
  @HttpCode(HttpStatus.OK)
  async setAdminRole(
    @Headers('x-admin-secret') secret: string,
    @Param('email') email: string,
    @Body('isAdmin') isAdmin: boolean,
  ) {
    this.guard(secret);
    if (typeof isAdmin !== 'boolean') {
      throw new BadRequestException('isAdmin must be a boolean');
    }
    return this.adminService.setAdminRole(email, isAdmin);
  }
}
