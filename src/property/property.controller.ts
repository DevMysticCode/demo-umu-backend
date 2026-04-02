import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  UseGuards,
  Request,
  NotFoundException,
  Delete,
  Body,
} from '@nestjs/common';
import { PropertyService } from './property.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('property')
export class PropertyController {
  constructor(private propertyService: PropertyService) {}

  @Get('search')
  async searchProperties(
    @Query('q') query: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    if (!query || query.trim().length < 2) {
      return { items: [], total: 0 };
    }
    const off = parseInt(offset ?? '0') || 0;
    const lim = Math.min(parseInt(limit ?? '10') || 10, 50);
    return this.propertyService.searchProperties(query.trim(), off, lim);
  }

  @Get(':id/passport-status')
  @UseGuards(JwtAuthGuard)
  async getPassportStatus(@Param('id') id: string, @Request() req: any) {
    const userId = req.user.id;
    return this.propertyService.getPassportStatus(id, userId);
  }

  @Post(':id/start-verification')
  @UseGuards(JwtAuthGuard)
  async startVerification(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.startVerification(id, req.user.id);
  }

  @Get(':id/verification-status')
  @UseGuards(JwtAuthGuard)
  async getVerificationStatus(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.getVerificationStatus(id, req.user.id);
  }

  @Post(':id/complete-verification')
  @UseGuards(JwtAuthGuard)
  async completeVerification(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.completeVerification(id, req.user.id);
  }

  // These must stay above @Get(':id') to avoid route conflict
  @Get('wishlist')
  @UseGuards(JwtAuthGuard)
  async getWishlist(@Request() req: any) {
    return this.propertyService.getWishlist(req.user.id);
  }

  @Get('saved')
  @UseGuards(JwtAuthGuard)
  async getSaved(@Request() req: any) {
    return this.propertyService.getSavedProperties(req.user.id);
  }

  @Get(':id/actions')
  @UseGuards(JwtAuthGuard)
  async getPropertyActions(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.getPropertyActions(req.user.id, id);
  }

  @Post(':id/wishlist')
  @UseGuards(JwtAuthGuard)
  async toggleWishlist(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.toggleWishlist(req.user.id, id);
  }

  @Post(':id/save')
  @UseGuards(JwtAuthGuard)
  async toggleSave(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.toggleSave(req.user.id, id);
  }

  @Get(':id/enrichment')
  async getEnrichment(@Param('id') id: string) {
    const data = await this.propertyService.getPropertyEnrichment(id);
    if (!data) throw new NotFoundException('Property not found');
    return data;
  }

  @Post(':id/homescore')
  @UseGuards(JwtAuthGuard)
  async saveHomeScore(@Param('id') id: string, @Request() req: any, @Body() body: any) {
    return this.propertyService.saveHomeScore(id, req.user.id, body);
  }

  @Get(':id/homescore')
  @UseGuards(JwtAuthGuard)
  async getHomeScore(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.getHomeScore(id, req.user.id);
  }

  @Get(':id')
  async getProperty(@Param('id') id: string) {
    const property = await this.propertyService.getPropertyById(id);
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }
}
