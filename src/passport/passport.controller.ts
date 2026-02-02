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
    const userId = req.user.sub;
    return this.passportService.createPassport(
      userId,
      dto.addressLine1,
      dto.postcode,
    );
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getPassport(@Param('id') passportId: string, @Request() req: any) {
    const userId = req.user.sub;
    const passport = await this.passportService.getPassport(passportId);

    if (!passport) {
      throw new ForbiddenException('Passport not found');
    }

    if (passport.ownerId !== userId) {
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
    const userId = req.user.sub;
    const sections = await this.passportService.getPassportSections(
      passportId,
      userId,
    );

    return sections;
  }
}
