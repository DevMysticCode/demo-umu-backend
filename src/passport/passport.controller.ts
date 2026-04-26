import {
  Controller,
  Post,
  Put,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  ForbiddenException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { PassportService } from './passport.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3002';

interface CreatePassportDto {
  addressLine1: string;
  postcode: string;
  propertyId?: string;
}

@Controller('passport')
export class PassportController {
  constructor(private passportService: PassportService) {}

  @Post('create')
  @UseGuards(JwtAuthGuard)
  async createPassport(@Body() dto: CreatePassportDto, @Request() req: any) {
    const userId = req.user.id;
    return this.passportService.createPassport(
      userId,
      dto.addressLine1,
      dto.postcode,
      dto.propertyId,
    );
  }

  @Get('my')
  @UseGuards(JwtAuthGuard)
  async getMyPassports(@Request() req: any) {
    return this.passportService.getUserPassports(req.user.id);
  }

  // Buyer's purchased "watching" list — published passports they've unlocked.
  // Returns array of records the Passport tab uses to render the Watching section.
  @Get('buyer-access')
  @UseGuards(JwtAuthGuard)
  async getMyBuyerAccess(@Request() req: any) {
    return this.passportService.getBuyerAccessList(req.user.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getPassport(@Param('id') passportId: string, @Request() req: any) {
    const userId = req.user.id;
    const passport = await this.passportService.getPassport(passportId);

    if (!passport) {
      throw new ForbiddenException('Passport not found');
    }

    const hasAccess = await this.passportService.checkUserAccess(
      passportId,
      userId,
    );
    if (!hasAccess) {
      throw new ForbiddenException('You do not have access to this passport');
    }

    return passport;
  }

  @Get(':id/sections')
  @UseGuards(JwtAuthGuard)
  async getPassportSections(
    @Param('id') passportId: string,
    @Request() req: any,
  ) {
    const userId = req.user.id;
    return this.passportService.getPassportSections(passportId, userId);
  }

  @Post(':id/collaborators')
  @UseGuards(JwtAuthGuard)
  async addCollaborator(
    @Param('id') passportId: string,
    @Body('email') email: string,
    @Request() req: any,
  ) {
    const userId = req.user.id;
    return this.passportService.addCollaborator(passportId, userId, email);
  }

  @Get(':id/collaborators')
  @UseGuards(JwtAuthGuard)
  async getCollaborators(@Param('id') passportId: string, @Request() req: any) {
    const userId = req.user.id;
    return this.passportService.getCollaborators(passportId, userId);
  }

  @Post(':id/collaborators/:collaboratorId/remove')
  @UseGuards(JwtAuthGuard)
  async removeCollaborator(
    @Param('id') passportId: string,
    @Param('collaboratorId') collaboratorId: string,
    @Request() req: any,
  ) {
    const userId = req.user.id;
    return this.passportService.removeCollaborator(
      passportId,
      userId,
      collaboratorId,
    );
  }

  @Post(':id/buyer-unlock')
  @UseGuards(JwtAuthGuard)
  async buyerUnlock(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.createBuyerAccess(passportId, req.user.id);
  }

  @Get(':id/buyer-view')
  @UseGuards(JwtAuthGuard)
  async getBuyerView(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.getBuyerView(passportId, req.user.id);
  }

  @Put(':id/publish')
  @UseGuards(JwtAuthGuard)
  async publishPassport(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.publishPassport(passportId, req.user.id);
  }

  @Put(':id/unpublish')
  @UseGuards(JwtAuthGuard)
  async unpublishPassport(
    @Param('id') passportId: string,
    @Request() req: any,
  ) {
    return this.passportService.unpublishPassport(passportId, req.user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async deletePassport(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.deletePassport(passportId, req.user.id);
  }

  @Post(':id/upload-image')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadPath = join(process.cwd(), 'uploads', 'property-images');
          if (!existsSync(uploadPath))
            mkdirSync(uploadPath, { recursive: true });
          cb(null, uploadPath);
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 20 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(new Error('Only image files are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadPropertyImage(
    @Param('id') passportId: string,
    @UploadedFile() file: any,
    @Request() req: any,
  ) {
    const hasAccess = await this.passportService.checkUserAccess(
      passportId,
      req.user.id,
    );
    if (!hasAccess) throw new ForbiddenException('Access denied');
    const url = `${BASE_URL}/uploads/property-images/${file.filename}`;
    return {
      url,
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };
  }

  @Get(':id/property-images')
  @UseGuards(JwtAuthGuard)
  async getPropertyImages(
    @Param('id') passportId: string,
    @Request() req: any,
  ) {
    return this.passportService.getPropertyImages(passportId, req.user.id);
  }

  @Put(':id/property-images')
  @UseGuards(JwtAuthGuard)
  async updatePropertyImages(
    @Param('id') passportId: string,
    @Body('images') images: string[],
    @Request() req: any,
  ) {
    return this.passportService.updatePropertyImages(
      passportId,
      req.user.id,
      images,
    );
  }

  // ── Comparables ─────────────────────────────────────────────────────────

  @Get(':id/comparables')
  @UseGuards(JwtAuthGuard)
  async getComparables(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.getComparables(passportId, req.user.id);
  }

  // ── Share Link ───────────────────────────────────────────────────────────

  @Post(':id/share')
  @UseGuards(JwtAuthGuard)
  async createShareLink(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.createShareLink(passportId, req.user.id);
  }

  @Get('shared/:token')
  async getSharedPassport(@Param('token') token: string) {
    return this.passportService.getSharedPassport(token);
  }

  // ── AI Summary ───────────────────────────────────────────────────────────

  @Post(':id/ai-summary/:sectionKey')
  @UseGuards(JwtAuthGuard)
  async getSectionAiSummary(
    @Param('id') passportId: string,
    @Param('sectionKey') sectionKey: string,
    @Request() req: any,
  ) {
    return this.passportService.getSectionAiSummary(passportId, sectionKey, req.user.id);
  }

  // ── Buyer Notes ───────────────────────────────────────────────────────────

  @Post(':id/notes')
  @UseGuards(JwtAuthGuard)
  async createBuyerNote(
    @Param('id') passportId: string,
    @Body('text') text: string,
    @Body('sectionKey') sectionKey: string | undefined,
    @Request() req: any,
  ) {
    return this.passportService.createBuyerNote(passportId, req.user.id, text, sectionKey);
  }

  @Get(':id/notes')
  @UseGuards(JwtAuthGuard)
  async getBuyerNotes(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.getBuyerNotes(passportId, req.user.id);
  }

  @Delete('notes/:noteId')
  @UseGuards(JwtAuthGuard)
  async deleteBuyerNote(@Param('noteId') noteId: string, @Request() req: any) {
    return this.passportService.deleteBuyerNote(noteId, req.user.id);
  }
}
