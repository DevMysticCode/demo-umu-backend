import {
  Controller,
  Get,
  Query,
  Param,
  UseGuards,
  Request,
  NotFoundException,
} from '@nestjs/common';
import { PropertyService } from './property.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('property')
export class PropertyController {
  constructor(private propertyService: PropertyService) {}

  @Get('search')
  async searchProperties(@Query('q') query: string) {
    if (!query || query.trim().length < 2) {
      return [];
    }
    return this.propertyService.searchProperties(query.trim());
  }

  @Get(':id/passport-status')
  @UseGuards(JwtAuthGuard)
  async getPassportStatus(@Param('id') id: string, @Request() req: any) {
    const userId = req.user.id;
    return this.propertyService.getPassportStatus(id, userId);
  }

  @Get(':id')
  async getProperty(@Param('id') id: string) {
    const property = await this.propertyService.getPropertyById(id);
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }
}
