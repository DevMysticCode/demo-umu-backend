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
import { ApiBody, ApiOperation, ApiResponse, ApiHeader, ApiParam, ApiQuery } from '@nestjs/swagger';
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
  @ApiOperation({ summary: 'Search accounts by email substring (admin)', description: 'Read-only: finds accounts whose email contains any of the given comma-separated substrings, for reviewing before a bulk delete.' })
  @ApiHeader({ name: 'x-admin-secret', description: 'Shared admin secret' })
  @ApiQuery({ name: 'contains', description: 'Comma-separated substrings to match against email addresses' })
  @ApiResponse({ status: 200, description: 'Matching accounts. Not paginated - returns every match.', schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' }, firstName: { type: 'string', nullable: true }, lastName: { type: 'string', nullable: true }, isVerified: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' } } } } })
  @ApiResponse({ status: 400, description: "contains is missing or empty after trimming/splitting." })
  @ApiResponse({ status: 403, description: 'x-admin-secret is missing or incorrect.' })
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
  @ApiOperation({ summary: 'Delete accounts by email (admin)', description: 'Permanently deletes one or more user accounts by email address, cascading to all data they own.' })
  @ApiHeader({ name: 'x-admin-secret', description: 'Shared admin secret' })
  @ApiBody({ schema: { type: 'object', required: ['emails'], properties: { emails: { type: 'array', items: { type: 'string' }, description: 'Email addresses of the accounts to permanently delete.' } } } })
  @ApiResponse({ status: 200, description: 'Which emails were deleted vs. not found.', schema: { type: 'object', properties: { deleted: { type: 'array', items: { type: 'string' } }, notFound: { type: 'array', items: { type: 'string' } } } } })
  @ApiResponse({ status: 400, description: 'emails is missing or not a non-empty array.' })
  @ApiResponse({ status: 403, description: 'x-admin-secret is missing or incorrect.' })
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
  @ApiOperation({ summary: 'List Founder Numbers (admin)', description: 'Read-only: every FounderNumber row (certificate number, owning user email, passport id, assigned-at), for reviewing before a one-off sequence reset.' })
  @ApiHeader({ name: 'x-admin-secret', description: 'Shared admin secret' })
  @ApiResponse({ status: 200, description: 'All Founder Number rows. Not paginated - returns every row.', schema: { type: 'array', items: { type: 'object', properties: { number: { type: 'integer' }, userEmail: { type: 'string' }, passportId: { type: 'string' }, assignedAt: { type: 'string', format: 'date-time' } } } } })
  @ApiResponse({ status: 403, description: 'x-admin-secret is missing or incorrect.' })
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
  @ApiOperation({ summary: 'Reset the Founder Number sequence (admin, one-off)', description: "Wipes every FounderNumber row and restarts the database-native sequence at restartAt. Meant to be called once, to line up the launch sequence across databases. Requires confirm === 'RESET-FOUNDER-SEQ'." })
  @ApiHeader({ name: 'x-admin-secret', description: 'Shared admin secret' })
  @ApiBody({ schema: { type: 'object', required: ['restartAt', 'confirm'], properties: { restartAt: { type: 'integer', description: 'Value the sequence should restart at' }, confirm: { type: 'string', example: 'RESET-FOUNDER-SEQ', description: "Safety confirmation literal - must equal exactly 'RESET-FOUNDER-SEQ' or the reset is rejected." } } } })
  @ApiResponse({ status: 200, description: 'How many rows were wiped and the new sequence start.', schema: { type: 'object', properties: { deletedRows: { type: 'integer' }, sequenceRestartedAt: { type: 'integer' } } } })
  @ApiResponse({ status: 400, description: 'restartAt is not a positive integer.' })
  @ApiResponse({ status: 403, description: 'x-admin-secret is missing or incorrect.' })
  @ApiResponse({ status: 500, description: "confirm did not equal 'RESET-FOUNDER-SEQ' - currently surfaces as a generic server error rather than a 400, since the service throws a plain Error here rather than a BadRequestException." })
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
  @ApiOperation({ summary: 'Grant or revoke admin role (admin)', description: 'Sets the isAdmin flag on one account by email. The only way any account ever becomes an admin — there is no self-service path.' })
  @ApiHeader({ name: 'x-admin-secret', description: 'Shared admin secret' })
  @ApiParam({ name: 'email', description: 'Email address of the account to update' })
  @ApiResponse({ status: 200, description: 'The updated admin flag.', schema: { type: 'object', properties: { email: { type: 'string' }, isAdmin: { type: 'boolean' } } } })
  @ApiResponse({ status: 400, description: 'isAdmin is missing or not a boolean.' })
  @ApiResponse({ status: 403, description: 'x-admin-secret is missing or incorrect.' })
  @ApiResponse({ status: 404, description: 'No account exists for that email.' })
  @HttpCode(HttpStatus.OK)
  @ApiBody({
    schema: {
      type: 'object',
      required: ['isAdmin'],
      properties: {
        isAdmin: { type: 'boolean', description: 'true to grant admin role, false to revoke it.' },
      },
    },
  })
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
