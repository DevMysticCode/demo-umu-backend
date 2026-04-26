import {
  Controller, Get, Patch, Post, Delete,
  Body, Request, UseGuards,
} from '@nestjs/common';
import { BuyerProfileService, UpdateBuyerProfileDto } from './buyer-profile.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('buyer-profile')
@UseGuards(JwtAuthGuard)
export class BuyerProfileController {
  constructor(private buyerProfileService: BuyerProfileService) {}

  // GET /buyer-profile — current user's buyer profile (may be null)
  @Get()
  async getMine(@Request() req) {
    return this.buyerProfileService.getMine(req.user.id);
  }

  // PATCH /buyer-profile — upsert partial fields as the user progresses through the build
  @Patch()
  async update(@Request() req, @Body() dto: UpdateBuyerProfileDto) {
    return this.buyerProfileService.upsert(req.user.id, dto);
  }

  // POST /buyer-profile/publish — marks the profile as published.
  // Optional body: same fields as PATCH, will be saved before publishing.
  // This makes publish self-healing if earlier per-step PATCHes silently failed.
  @Post('publish')
  async publish(@Request() req, @Body() dto: UpdateBuyerProfileDto) {
    if (dto && Object.keys(dto).length > 0) {
      await this.buyerProfileService.upsert(req.user.id, dto);
    }
    return this.buyerProfileService.publish(req.user.id);
  }

  // DELETE /buyer-profile — clear the user's buyer profile
  @Delete()
  async remove(@Request() req) {
    return this.buyerProfileService.remove(req.user.id);
  }
}
