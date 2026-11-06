import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { createUploadStorage, IMAGE_MIME_TYPES } from '../common/storage';
import { ProfileService } from './profile.service';
import {
  UpdateProfileDto,
  CreateAddressDto,
  UpdateAddressDto,
  CreateCompanyDto,
  UpdateCompanyDto,
  CreateSolicitorDto,
  UpdateSolicitorDto,
  AddCollaboratorDto,
  UpsertPreferencesDto,
  UpsertInterestDto,
} from './dto/update-profile.dto';

@Controller('profile')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Post('avatar')
  @ApiOperation({ summary: 'Upload profile avatar', description: 'Uploads a new avatar image (jpg/png/webp/gif, max 5MB), deletes the previous avatar file if one existed, and returns the updated user profile.' })
  @ApiResponse({ status: 201, description: 'Updated user profile including the new avatarUrl.', schema: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' }, avatarUrl: { type: 'string' } } } })
  @UseInterceptors(
    FileInterceptor('file', createUploadStorage({ bucket: 'avatars', maxMb: 5, mimeAllowList: IMAGE_MIME_TYPES })),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  uploadAvatar(@Req() req: any, @UploadedFile() file: any) {
    return this.profileService.uploadAvatar(req.user.id, file, req.hostname);
  }

  @Get('me')
  @ApiOperation({ summary: "Get the caller's profile", description: 'Returns the full profile of the authenticated user (password hash excluded), including their addresses, companies and solicitors.' })
  @ApiResponse({ status: 200, description: 'The user profile.', schema: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' }, firstName: { type: 'string' }, lastName: { type: 'string' }, addresses: { type: 'array', items: { type: 'object' } }, companies: { type: 'array', items: { type: 'object' } }, solicitors: { type: 'array', items: { type: 'object' } } } } })
  getProfile(@Req() req: any) {
    return this.profileService.getProfile(req.user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update profile fields', description: 'Partially updates the authenticated user\'s own profile fields.' })
  @ApiResponse({ status: 200, description: 'The updated user profile.', schema: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' } } } })
  updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    return this.profileService.updateProfile(req.user.id, dto);
  }

  // ─── Addresses ────────────────────────────────────────────────────────────

  @Post('address')
  @ApiOperation({ summary: 'Add an address', description: "Creates a new address row owned by the authenticated user." })
  @ApiResponse({ status: 201, description: 'The created address.', schema: { type: 'object', properties: { id: { type: 'string' }, userId: { type: 'string' }, label: { type: 'string' }, line1: { type: 'string' }, line2: { type: 'string', nullable: true }, city: { type: 'string', nullable: true }, county: { type: 'string', nullable: true }, postcode: { type: 'string' }, isCurrent: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' } } } })
  createAddress(@Req() req: any, @Body() dto: CreateAddressDto) {
    return this.profileService.createAddress(req.user.id, dto);
  }

  @Patch('address/:id')
  @ApiOperation({ summary: 'Update an address', description: 'Updates an address the authenticated user owns. 404 if it does not exist, 403 if it belongs to someone else.' })
  @ApiParam({ name: 'id', description: 'UserAddress id' })
  @ApiResponse({ status: 200, description: 'The updated address.', schema: { type: 'object', properties: { id: { type: 'string' }, userId: { type: 'string' }, label: { type: 'string' }, line1: { type: 'string' }, line2: { type: 'string', nullable: true }, city: { type: 'string', nullable: true }, county: { type: 'string', nullable: true }, postcode: { type: 'string' }, isCurrent: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' } } } })
  updateAddress(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateAddressDto) {
    return this.profileService.updateAddress(req.user.id, id, dto);
  }

  @Delete('address/:id')
  @ApiOperation({ summary: 'Delete an address', description: 'Deletes an address the authenticated user owns.' })
  @ApiParam({ name: 'id', description: 'UserAddress id' })
  @ApiResponse({ status: 200, description: 'Confirmation message.', schema: { type: 'object', properties: { message: { type: 'string', example: 'Address deleted' } } } })
  deleteAddress(@Req() req: any, @Param('id') id: string) {
    return this.profileService.deleteAddress(req.user.id, id);
  }

  // ─── Companies ────────────────────────────────────────────────────────────

  @Post('company')
  @ApiOperation({ summary: 'Add a company', description: 'Creates a new company row owned by the authenticated user, then attempts a live verification against Companies House if a company number was given.' })
  @ApiResponse({ status: 201, description: 'The created (and possibly Companies-House-verified) company.', schema: { type: 'object', properties: { id: { type: 'string' }, userId: { type: 'string' }, name: { type: 'string' }, address: { type: 'string', nullable: true }, companyNumber: { type: 'string', nullable: true }, director: { type: 'string', nullable: true }, chStatus: { type: 'string', nullable: true }, chCompanyName: { type: 'string', nullable: true }, chVerifiedAt: { type: 'string', format: 'date-time', nullable: true }, chVerifyError: { type: 'string', nullable: true }, createdAt: { type: 'string', format: 'date-time' } } } })
  createCompany(@Req() req: any, @Body() dto: CreateCompanyDto) {
    return this.profileService.createCompany(req.user.id, dto);
  }

  @Patch('company/:id')
  @ApiOperation({ summary: 'Update a company', description: 'Updates a company the authenticated user owns. Re-runs Companies House verification automatically if the company number changed.' })
  @ApiParam({ name: 'id', description: 'UserCompany id' })
  @ApiResponse({ status: 200, description: 'The updated company.', schema: { type: 'object', properties: { id: { type: 'string' }, userId: { type: 'string' }, name: { type: 'string' }, address: { type: 'string', nullable: true }, companyNumber: { type: 'string', nullable: true }, director: { type: 'string', nullable: true }, chStatus: { type: 'string', nullable: true }, chCompanyName: { type: 'string', nullable: true }, chVerifiedAt: { type: 'string', format: 'date-time', nullable: true }, chVerifyError: { type: 'string', nullable: true }, createdAt: { type: 'string', format: 'date-time' } } } })
  updateCompany(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateCompanyDto) {
    return this.profileService.updateCompany(req.user.id, id, dto);
  }

  @Post('company/:id/verify')
  @ApiOperation({ summary: 'Re-verify a company', description: "Re-checks a company's live status against Companies House and stores the result (status, name, verified-at, or an error message if the lookup failed)." })
  @ApiParam({ name: 'id', description: 'UserCompany id' })
  @ApiResponse({ status: 200, description: 'The company with refreshed Companies House verification fields.', schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, companyNumber: { type: 'string', nullable: true }, chStatus: { type: 'string', nullable: true }, chCompanyName: { type: 'string', nullable: true }, chVerifiedAt: { type: 'string', format: 'date-time', nullable: true }, chVerifyError: { type: 'string', nullable: true } } } })
  verifyCompany(@Req() req: any, @Param('id') id: string) {
    return this.profileService.verifyCompany(req.user.id, id);
  }

  @Delete('company/:id')
  @ApiOperation({ summary: 'Delete a company', description: 'Deletes a company the authenticated user owns.' })
  @ApiParam({ name: 'id', description: 'UserCompany id' })
  @ApiResponse({ status: 200, description: 'Confirmation message.', schema: { type: 'object', properties: { message: { type: 'string', example: 'Company deleted' } } } })
  deleteCompany(@Req() req: any, @Param('id') id: string) {
    return this.profileService.deleteCompany(req.user.id, id);
  }

  // ─── Solicitors ───────────────────────────────────────────────────────────

  @Post('solicitor')
  @ApiOperation({ summary: 'Add a solicitor', description: 'Creates a new solicitor contact row owned by the authenticated user.' })
  @ApiResponse({ status: 201, description: 'The created solicitor.', schema: { type: 'object', properties: { id: { type: 'string' }, userId: { type: 'string' }, name: { type: 'string' }, address: { type: 'string', nullable: true }, contactName: { type: 'string', nullable: true }, email: { type: 'string', nullable: true }, phone: { type: 'string', nullable: true }, reference: { type: 'string', nullable: true }, createdAt: { type: 'string', format: 'date-time' } } } })
  createSolicitor(@Req() req: any, @Body() dto: CreateSolicitorDto) {
    return this.profileService.createSolicitor(req.user.id, dto);
  }

  @Patch('solicitor/:id')
  @ApiOperation({ summary: 'Update a solicitor', description: 'Updates a solicitor contact the authenticated user owns.' })
  @ApiParam({ name: 'id', description: 'UserSolicitor id' })
  @ApiResponse({ status: 200, description: 'The updated solicitor.', schema: { type: 'object', properties: { id: { type: 'string' }, userId: { type: 'string' }, name: { type: 'string' }, address: { type: 'string', nullable: true }, contactName: { type: 'string', nullable: true }, email: { type: 'string', nullable: true }, phone: { type: 'string', nullable: true }, reference: { type: 'string', nullable: true }, createdAt: { type: 'string', format: 'date-time' } } } })
  updateSolicitor(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateSolicitorDto) {
    return this.profileService.updateSolicitor(req.user.id, id, dto);
  }

  @Delete('solicitor/:id')
  @ApiOperation({ summary: 'Delete a solicitor', description: 'Deletes a solicitor contact the authenticated user owns.' })
  @ApiParam({ name: 'id', description: 'UserSolicitor id' })
  @ApiResponse({ status: 200, description: 'Confirmation message.', schema: { type: 'object', properties: { message: { type: 'string', example: 'Solicitor deleted' } } } })
  deleteSolicitor(@Req() req: any, @Param('id') id: string) {
    return this.profileService.deleteSolicitor(req.user.id, id);
  }

  // ─── Collaborators ────────────────────────────────────────────────────────

  @Get('passports')
  @ApiOperation({ summary: "List the caller's passports", description: "Every passport the authenticated user owns (excluding abandoned PENDING_PAYMENT claims), most-recently-visited first, each with its property address, HomeScore, completion percentage and timestamps for dashboard summary cards." })
  @ApiResponse({ status: 200, description: 'Array of passport summaries.', schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, propertyId: { type: 'string', nullable: true }, address: { type: 'string' }, type: { type: 'string' }, status: { type: 'string' }, homeScore: { type: 'number', nullable: true }, completionPercentage: { type: 'number' }, createdAt: { type: 'string', format: 'date-time' }, lastVisitedAt: { type: 'string', format: 'date-time', nullable: true } } } } })
  getUserPassports(@Req() req: any) {
    return this.profileService.getUserPassports(req.user.id);
  }

  // "Founding Homeowner" certificate — one per CLAIMED PROPERTY, first 1M
  // claims. Get-or-assign so it's safe to call on every certificate page
  // view; the DB-native serial (see prisma/schema.prisma
  // FounderNumber.number) guarantees distinct numbers even if two
  // requests race. Ownership of passportId is checked in the service so
  // nobody can mint a certificate against a property that isn't theirs.
  @Get('founder-number')
  @ApiOperation({ summary: 'Get or assign a Founding Homeowner number', description: "Returns this property's Founding Homeowner certificate number, creating it on first request (one per claimed property, first 1M claims). The caller must own the given passport." })
  @ApiQuery({ name: 'passportId', description: 'The passport (claimed property) to get/assign a certificate number for' })
  @ApiResponse({ status: 200, description: 'The certificate number row, with isNew indicating whether it was just created.', schema: { type: 'object', properties: { number: { type: 'integer' }, passportId: { type: 'string' }, isNew: { type: 'boolean' } } } })
  getFounderNumber(@Req() req: any, @Query('passportId') passportId: string) {
    if (!passportId) {
      throw new BadRequestException('passportId is required');
    }
    return this.profileService.getOrAssignFounderNumber(req.user.id, passportId);
  }

  // Emails the (already-rendered) certificate image to the user's own
  // registered address. The website renders the JPEG client/server-side
  // (fonts + template live there) and POSTs the bytes here rather than
  // this backend re-implementing that rendering — this endpoint only
  // owns "look up the address, send it via Resend."
  @Post('founder-number/email')
  @ApiOperation({ summary: 'Email the Founding Homeowner certificate', description: "Sends the already-rendered certificate image (rendered client-side) to the authenticated user's own registered email address via Resend." })
  @ApiResponse({ status: 200, description: 'Send confirmation.', schema: { type: 'object', properties: { sent: { type: 'boolean' } } } })
  @HttpCode(HttpStatus.OK)
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        imageBase64: { type: 'string', description: 'Base64-encoded certificate JPEG rendered client/server-side' },
      },
    },
  })
  emailFounderCertificate(@Req() req: any, @Body() body: { imageBase64?: string }) {
    return this.profileService.emailFounderCertificate(req.user.id, body?.imageBase64 ?? '');
  }

  // "What brings you to Umovingu?" onboarding step + "Manage Interests"
  // edit. Upserts (one row per user) and emails a confirmation when the
  // user has opted in, on both first registration and later edits.
  @Post('interests')
  @ApiOperation({ summary: 'Save or update onboarding interests', description: "Upserts the authenticated user's \"what brings you to Umovingu\" interests/areas. Emails a one-time confirmation on both first registration and later edits (best-effort — a failed email doesn't fail the save)." })
  @ApiResponse({ status: 201, description: 'The saved UserInterest row.', schema: { type: 'object', properties: { id: { type: 'string' }, userId: { type: 'string' }, interestIds: { type: 'array', items: { type: 'string' } }, areas: { type: 'array', items: { type: 'string' } }, emailOptIn: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } } })
  upsertInterest(@Req() req: any, @Body() dto: UpsertInterestDto) {
    return this.profileService.upsertInterest(req.user.id, dto);
  }

  @Get('interests')
  @ApiOperation({ summary: "Get the caller's saved interests", description: "Returns the authenticated user's saved onboarding interests, or null if never set." })
  @ApiResponse({ status: 200, description: 'The UserInterest row, or null.', schema: { type: 'object', nullable: true, properties: { id: { type: 'string' }, interestIds: { type: 'array', items: { type: 'string' } }, areas: { type: 'array', items: { type: 'string' } }, emailOptIn: { type: 'boolean' } } } })
  getInterest(@Req() req: any) {
    return this.profileService.getInterest(req.user.id);
  }

  // Authenticated-only, but had no rate limit and returned full,
  // unmasked email addresses - any logged-in user could brute-force
  // short prefixes to enumerate other users' email addresses at scale
  // (security review 2026-09-22, L2). Throttled here; the email itself
  // is now partially masked in the service response.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('users/search')
  @ApiOperation({ summary: 'Search other users by name/email', description: "Searches other users by name or email (min 2 characters), excluding the caller. Returns at most 10 matches with a partially masked email (e.g. \"al**@gm**.com\") so this cannot be used to harvest full addresses. Rate-limited to 20 requests/minute." })
  @ApiQuery({ name: 'q', description: 'Search text (name or email), minimum 2 characters' })
  @ApiResponse({ status: 200, description: 'Up to 10 matching users, masked.', schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string', example: 'al**@gm**.com' }, name: { type: 'string' }, avatarUrl: { type: 'string', nullable: true } } } } })
  searchUsers(@Req() req: any, @Query('q') q: string) {
    return this.profileService.searchUsers(q, req.user.id);
  }

  @Get('collaborators')
  @ApiOperation({ summary: "List the caller's trusted contacts", description: "Returns the authenticated user's own \"trusted contacts\" directory (UserCollaborator) — a profile-level contact list. This is cosmetic only and does not itself grant any data access; see PassportCollaborator for real access grants." })
  @ApiResponse({ status: 200, description: 'Array of trusted-contact rows.', schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, collaboratorId: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, role: { type: 'string' }, permission: { type: 'string' }, propertyCount: { type: 'integer' } } } } })
  getCollaborators(@Req() req: any) {
    return this.profileService.getCollaborators(req.user.id);
  }

  @Get('collaborators/:id')
  @ApiOperation({ summary: 'Get one trusted contact', description: "Detail for a single trusted-contact row the caller owns, including which of the caller's passports it's associated with." })
  @ApiParam({ name: 'id', description: 'UserCollaborator row id' })
  @ApiResponse({ status: 200, description: 'The trusted-contact row with associated passports.', schema: { type: 'object', properties: { id: { type: 'string' }, userId: { type: 'string' }, collaboratorId: { type: 'string' }, role: { type: 'string', nullable: true }, permission: { type: 'string' }, collaborator: { type: 'object', properties: { id: { type: 'string' }, firstName: { type: 'string' }, lastName: { type: 'string' }, email: { type: 'string' }, avatarUrl: { type: 'string', nullable: true }, createdAt: { type: 'string', format: 'date-time' } } }, sharedPassports: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, addressLine1: { type: 'string' }, postcode: { type: 'string' }, address: { type: 'string' } } } } } } })
  getCollaborator(@Req() req: any, @Param('id') id: string) {
    return this.profileService.getCollaborator(req.user.id, id);
  }

  @Post('collaborators')
  @ApiOperation({ summary: 'Add a trusted contact', description: "Adds another user to the caller's trusted-contacts directory. Cosmetic only — does not itself grant that person access to any passport data." })
  @ApiResponse({ status: 201, description: 'The created trusted-contact row.', schema: { type: 'object', properties: { id: { type: 'string' }, userId: { type: 'string' }, collaboratorId: { type: 'string' }, role: { type: 'string', nullable: true }, permission: { type: 'string' }, propertyIds: { type: 'array', items: { type: 'string' }, nullable: true }, accessDuration: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time', nullable: true }, clientAccess: { type: 'string' }, allowComms: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' } } } })
  addCollaborator(@Req() req: any, @Body() dto: AddCollaboratorDto) {
    return this.profileService.addCollaborator(req.user.id, dto);
  }

  @Delete('collaborators/:id')
  @ApiOperation({ summary: 'Remove a trusted contact', description: "Removes a row from the caller's trusted-contacts directory." })
  @ApiParam({ name: 'id', description: 'UserCollaborator row id' })
  @ApiResponse({ status: 200, description: 'Confirmation message.', schema: { type: 'object', properties: { message: { type: 'string', example: 'Collaborator removed' } } } })
  removeCollaborator(@Req() req: any, @Param('id') id: string) {
    return this.profileService.removeCollaborator(req.user.id, id);
  }

  // ─── Preferences ─────────────────────────────────────────────────────────

  @Get('preferences')
  @ApiOperation({ summary: "Get the caller's preferences", description: 'Returns the authenticated user\'s saved UserPreference row, or null if never set.' })
  @ApiResponse({ status: 200, description: 'The preferences row, or null.', schema: { type: 'object', nullable: true, properties: { id: { type: 'string' }, purpose: { type: 'object', nullable: true }, buyingTimeline: { type: 'string', nullable: true }, budgetMin: { type: 'number', nullable: true }, budgetMax: { type: 'number', nullable: true }, propertyTypes: { type: 'object', nullable: true }, propertyStyles: { type: 'object', nullable: true }, importantFeatures: { type: 'object', nullable: true }, sellingTimeline: { type: 'string', nullable: true }, propertyValue: { type: 'number', nullable: true } } } })
  getPreferences(@Req() req: any) {
    return this.profileService.getPreferences(req.user.id);
  }

  @Post('preferences')
  @ApiOperation({ summary: 'Save or update preferences', description: "Upserts the authenticated user's preferences row." })
  @ApiResponse({ status: 201, description: 'The saved preferences row.', schema: { type: 'object', properties: { id: { type: 'string' }, userId: { type: 'string' }, purpose: { type: 'object', nullable: true }, buyingTimeline: { type: 'string', nullable: true }, budgetMin: { type: 'number', nullable: true }, budgetMax: { type: 'number', nullable: true }, propertyTypes: { type: 'object', nullable: true }, propertyStyles: { type: 'object', nullable: true }, importantFeatures: { type: 'object', nullable: true }, sellingTimeline: { type: 'string', nullable: true }, propertyValue: { type: 'number', nullable: true }, updatedAt: { type: 'string', format: 'date-time' } } } })
  upsertPreferences(@Req() req: any, @Body() dto: UpsertPreferencesDto) {
    return this.profileService.upsertPreferences(req.user.id, dto);
  }

  @Delete('me')
  @ApiOperation({ summary: 'Delete the caller\'s account', description: 'Permanently deletes the authenticated user\'s account. Cascades to delete all related data owned by them — passports, sections, tasks, questions, answers, collaborators, documents, preferences, addresses and more.' })
  @ApiResponse({ status: 200, description: 'Confirmation message.', schema: { type: 'object', properties: { message: { type: 'string', example: 'Account deleted' } } } })
  @HttpCode(HttpStatus.OK)
  deleteAccount(@Req() req: any) {
    return this.profileService.deleteAccount(req.user.id);
  }

  @Get('export')
  @ApiOperation({ summary: "Export the caller's data", description: "Returns a single JSON export of everything the authenticated user directly owns — profile, addresses, companies, solicitors, passports with full section/task/question/answer content, documents, reminders, buyer notes, buyer-passport accesses, buyer profile, and HomeScore results. Excludes the password hash and any other user's data." })
  @ApiResponse({ status: 200, description: 'The full data export.', schema: { type: 'object', properties: { exportedAt: { type: 'string', format: 'date-time' }, user: { type: 'object' }, buyerProfile: { type: 'object', nullable: true }, homeScores: { type: 'array', items: { type: 'object' } } } } })
  exportData(@Req() req: any) {
    return this.profileService.exportData(req.user.id);
  }
}
