import {
  Controller, Get, Patch, Post, Delete,
  Body, Request, UseGuards,
} from '@nestjs/common';
import { BuyerPassportService, UpdateBuyerPassportDto } from './buyer-passport.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('buyer-passport')
@UseGuards(JwtAuthGuard)
export class BuyerPassportController {
  constructor(private buyerPassportService: BuyerPassportService) {}

  // GET /buyer-passport — current user's buyer passport (may be null)
  @Get()
  async getMine(@Request() req) {
    return this.buyerPassportService.getMine(req.user.id);
  }

  // PATCH /buyer-passport — upsert partial fields as the user progresses through the build
  @Patch()
  async update(@Request() req, @Body() dto: UpdateBuyerPassportDto) {
    return this.buyerPassportService.upsert(req.user.id, dto);
  }

  // POST /buyer-passport/publish — marks the passport as published (requires all required steps)
  @Post('publish')
  async publish(@Request() req) {
    return this.buyerPassportService.publish(req.user.id);
  }

  // DELETE /buyer-passport — clear the user's buyer passport
  @Delete()
  async remove(@Request() req) {
    return this.buyerPassportService.remove(req.user.id);
  }
}
