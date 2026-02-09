import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { PassportService } from './passport.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

interface CreatePassportDto {
  addressLine1: string;
  postcode: string;
}

@Controller('passport')
export class PassportController {
  constructor(private passportService: PassportService) {}

  @Post('create')
  @UseGuards(JwtAuthGuard)
  async createPassport(@Body() dto: CreatePassportDto, @Request() req: any) {
    console.log('req.user:', req.user);
    const userId = req.user.id;
    return this.passportService.createPassport(
      userId,
      dto.addressLine1,
      dto.postcode,
    );
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getPassport(@Param('id') passportId: string, @Request() req: any) {
    const userId = req.user.id;
    const passport = await this.passportService.getPassport(passportId);

    if (!passport) {
      throw new ForbiddenException('Passport not found');
    }

    // Check if user is owner or collaborator
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
    const sections = await this.passportService.getPassportSections(
      passportId,
      userId,
    );

    return sections;
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
  async getCollaborators(
    @Param('id') passportId: string,
    @Request() req: any,
  ) {
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
}
