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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { JwtAuthGuard } from '../auth/jwt.guard';
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
} from './dto/update-profile.dto';

@Controller('profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadPath = join(process.cwd(), 'uploads', 'avatars');
          if (!existsSync(uploadPath)) mkdirSync(uploadPath, { recursive: true });
          cb(null, uploadPath);
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    }),
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
}
