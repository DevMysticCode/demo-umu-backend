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
  Res,
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

  @Get('for-you')
  @UseGuards(JwtAuthGuard)
  async getForYou(@Request() req: any) {
    return this.propertyService.getForYou(req.user.id);
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

  @Get(':id/sold-history')
  async getSoldHistory(@Param('id') id: string) {
    return this.propertyService.getLiveSoldHistory(id);
  }

  @Get(':id/enrichment')
  async getEnrichment(@Param('id') id: string): Promise<any> {
    const data = await this.propertyService.getPropertyEnrichment(id);
    if (!data) throw new NotFoundException('Property not found');
    return data;
  }

  @Post(':id/homescore')
  @UseGuards(JwtAuthGuard)
  async saveHomeScore(@Param('id') id: string, @Request() req: any, @Body() body: any) {
    return this.propertyService.saveHomeScore(id, req.user.id, body);
  }

  @Get(':id/homescore/public')
  async getPublicHomeScore(@Param('id') id: string) {
    return this.propertyService.getPublicHomeScore(id);
  }

  @Get(':id/homescore')
  @UseGuards(JwtAuthGuard)
  async getHomeScore(@Param('id') id: string, @Request() req: any) {
    return this.propertyService.getHomeScore(id, req.user.id);
  }

  @Get(':id/neighbourhood')
  async getNeighbourhood(@Param('id') id: string) {
    return this.propertyService.getNeighbourhoodStats(id);
  }

  @Get(':id/street')
  async getStreetProperties(@Param('id') id: string) {
    return this.propertyService.getStreetProperties(id);
  }

  @Get(':id/matched-buyers')
  async getMatchedBuyers(@Param('id') id: string) {
    return this.propertyService.getMatchedBuyers(id);
  }

  @Get(':id')
  async getProperty(@Param('id') id: string) {
    const property = await this.propertyService.getPropertyById(id);
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }

  @Post(':id/register-interest')
  @UseGuards(JwtAuthGuard)
  async registerInterest(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { interestLevel: string; name?: string; userEmail?: string },
  ) {
    return this.propertyService.registerInterest(id, req.user.id, body);
  }

  @Post(':id/tap-owner')
  @UseGuards(JwtAuthGuard)
  async tapOwner(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { message: string; sharePhone?: boolean },
  ) {
    return this.propertyService.tapOwner(id, req.user.id, body);
  }

  @Get(':id/epc-download')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async downloadEpc(@Param('id') id: string, @Res() res: any) {
    const info = await this.propertyService.getEpcDownloadInfo(id);
    if (!info) throw new NotFoundException('EPC certificate not available for this property');

    const email = process.env.EPC_EMAIL ?? '';
    const key = process.env.EPC_API_KEY ?? '';
    const authHeader = `Basic ${Buffer.from(`${email}:${key}`).toString('base64')}`;

    const certRes = await fetch(info.certUrl, {
      headers: { Authorization: authHeader },
    });
    if (!certRes.ok) throw new NotFoundException('EPC certificate could not be retrieved');

    res.setHeader('Content-Disposition', `attachment; filename="epc-certificate.pdf"`);
    res.setHeader('Content-Type', 'application/pdf');
    const buffer = Buffer.from(await certRes.arrayBuffer());
    res.send(buffer);
  }
}
