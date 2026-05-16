import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  BuyerProfileService,
  UpdateBuyerProfileDto,
  CreateShareDto,
  SignProfileDto,
} from './buyer-profile.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('buyer-profile')
export class BuyerProfileController {
  constructor(private buyerProfileService: BuyerProfileService) {}

  // GET /buyer-profile — current user's buyer profile (may be null)
  @UseGuards(JwtAuthGuard)
  @Get()
  async getMine(@Request() req) {
    return this.buyerProfileService.getMine(req.user.id);
  }

  // PATCH /buyer-profile — upsert partial fields as the user progresses through the build
  @UseGuards(JwtAuthGuard)
  @Patch()
  async update(@Request() req, @Body() dto: UpdateBuyerProfileDto) {
    return this.buyerProfileService.upsert(req.user.id, dto);
  }

  // POST /buyer-profile/publish — marks the profile as published.
  @UseGuards(JwtAuthGuard)
  @Post('publish')
  async publish(@Request() req, @Body() dto: UpdateBuyerProfileDto) {
    if (dto && Object.keys(dto).length > 0) {
      await this.buyerProfileService.upsert(req.user.id, dto);
    }
    return this.buyerProfileService.publish(req.user.id);
  }

  // DELETE /buyer-profile
  @UseGuards(JwtAuthGuard)
  @Delete()
  async remove(@Request() req) {
    return this.buyerProfileService.remove(req.user.id);
  }

  // ── Digital signature ────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Post('sign')
  async sign(@Request() req, @Body() dto: SignProfileDto) {
    return this.buyerProfileService.signProfile(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sign/clear')
  async clearSign(@Request() req) {
    return this.buyerProfileService.clearSignature(req.user.id);
  }

  // ── Tier upgrade (Stripe) ─────────────────────────────────────────────────
  // POST /buyer-profile/tier/checkout  body: { tier: "VERIFIED" | "PREMIUM" }
  @UseGuards(JwtAuthGuard)
  @Post('tier/checkout')
  async createTierCheckout(
    @Request() req,
    @Body() body: { tier?: string },
  ) {
    if (!body?.tier) throw new BadRequestException('tier is required');
    return this.buyerProfileService.createTierPaymentIntent(
      req.user.id,
      body.tier,
    );
  }

  // POST /buyer-profile/tier/confirm  body: { paymentIntentId }
  @UseGuards(JwtAuthGuard)
  @Post('tier/confirm')
  async confirmTier(
    @Request() req,
    @Body() body: { paymentIntentId?: string },
  ) {
    if (!body?.paymentIntentId)
      throw new BadRequestException('paymentIntentId is required');
    return this.buyerProfileService.confirmTierPayment(
      req.user.id,
      body.paymentIntentId,
    );
  }

  // ── Activity ticker (public — no auth) ────────────────────────────────────
  // GET /buyer-profile/stats/activity
  @Get('stats/activity')
  async getActivity() {
    return this.buyerProfileService.getActivityStats();
  }

  // ── Sharing ───────────────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('shares')
  async listShares(@Request() req) {
    return this.buyerProfileService.listShares(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('shares')
  async createShare(@Request() req, @Body() dto: CreateShareDto) {
    return this.buyerProfileService.createShare(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('shares/:id/revoke')
  async revokeShare(@Request() req, @Param('id') id: string) {
    return this.buyerProfileService.revokeShare(req.user.id, id);
  }

  // GET /buyer-profile/public/:token — used by the read-only /shared-buyer
  // route on the frontend. No auth; scope-filtered; 410 on revoke/expiry.
  @Get('public/:token')
  async getPublicShare(@Param('token') token: string) {
    return this.buyerProfileService.getPublicShare(token);
  }
}
