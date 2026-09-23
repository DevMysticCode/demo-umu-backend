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
} from './dto/update-profile.dto';

@Controller('profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('file', createUploadStorage({ bucket: 'avatars', maxMb: 5, mimeAllowList: IMAGE_MIME_TYPES })),
  )
  uploadAvatar(@Req() req: any, @UploadedFile() file: any) {
    return this.profileService.uploadAvatar(req.user.id, file, req.hostname);
  }

  @Get('me')
  getProfile(@Req() req: any) {
    return this.profileService.getProfile(req.user.id);
  }

  @Patch('me')
  updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    return this.profileService.updateProfile(req.user.id, dto);
  }

  // ─── Addresses ────────────────────────────────────────────────────────────

  @Post('address')
  createAddress(@Req() req: any, @Body() dto: CreateAddressDto) {
    return this.profileService.createAddress(req.user.id, dto);
  }

  @Patch('address/:id')
  updateAddress(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateAddressDto) {
    return this.profileService.updateAddress(req.user.id, id, dto);
  }

  @Delete('address/:id')
  deleteAddress(@Req() req: any, @Param('id') id: string) {
    return this.profileService.deleteAddress(req.user.id, id);
  }

  // ─── Companies ────────────────────────────────────────────────────────────

  @Post('company')
  createCompany(@Req() req: any, @Body() dto: CreateCompanyDto) {
    return this.profileService.createCompany(req.user.id, dto);
  }

  @Patch('company/:id')
  updateCompany(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateCompanyDto) {
    return this.profileService.updateCompany(req.user.id, id, dto);
  }

  @Post('company/:id/verify')
  verifyCompany(@Req() req: any, @Param('id') id: string) {
    return this.profileService.verifyCompany(req.user.id, id);
  }

  @Delete('company/:id')
  deleteCompany(@Req() req: any, @Param('id') id: string) {
    return this.profileService.deleteCompany(req.user.id, id);
  }

  // ─── Solicitors ───────────────────────────────────────────────────────────

  @Post('solicitor')
  createSolicitor(@Req() req: any, @Body() dto: CreateSolicitorDto) {
    return this.profileService.createSolicitor(req.user.id, dto);
  }

  @Patch('solicitor/:id')
  updateSolicitor(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateSolicitorDto) {
    return this.profileService.updateSolicitor(req.user.id, id, dto);
  }

  @Delete('solicitor/:id')
  deleteSolicitor(@Req() req: any, @Param('id') id: string) {
    return this.profileService.deleteSolicitor(req.user.id, id);
  }

  // ─── Collaborators ────────────────────────────────────────────────────────

  @Get('passports')
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
  @HttpCode(HttpStatus.OK)
  emailFounderCertificate(@Req() req: any, @Body() body: { imageBase64?: string }) {
    return this.profileService.emailFounderCertificate(req.user.id, body?.imageBase64 ?? '');
  }

  // Authenticated-only, but had no rate limit and returned full,
  // unmasked email addresses - any logged-in user could brute-force
  // short prefixes to enumerate other users' email addresses at scale
  // (security review 2026-09-22, L2). Throttled here; the email itself
  // is now partially masked in the service response.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('users/search')
  searchUsers(@Req() req: any, @Query('q') q: string) {
    return this.profileService.searchUsers(q, req.user.id);
  }

  @Get('collaborators')
  getCollaborators(@Req() req: any) {
    return this.profileService.getCollaborators(req.user.id);
  }

  @Get('collaborators/:id')
  getCollaborator(@Req() req: any, @Param('id') id: string) {
    return this.profileService.getCollaborator(req.user.id, id);
  }

  @Post('collaborators')
  addCollaborator(@Req() req: any, @Body() dto: AddCollaboratorDto) {
    return this.profileService.addCollaborator(req.user.id, dto);
  }

  @Delete('collaborators/:id')
  removeCollaborator(@Req() req: any, @Param('id') id: string) {
    return this.profileService.removeCollaborator(req.user.id, id);
  }

  // ─── Preferences ─────────────────────────────────────────────────────────

  @Get('preferences')
  getPreferences(@Req() req: any) {
    return this.profileService.getPreferences(req.user.id);
  }

  @Post('preferences')
  upsertPreferences(@Req() req: any, @Body() dto: UpsertPreferencesDto) {
    return this.profileService.upsertPreferences(req.user.id, dto);
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  deleteAccount(@Req() req: any) {
    return this.profileService.deleteAccount(req.user.id);
  }

  @Get('export')
  exportData(@Req() req: any) {
    return this.profileService.exportData(req.user.id);
  }
}
