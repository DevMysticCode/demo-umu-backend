import { Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { RewardsService } from './rewards.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('rewards')
@UseGuards(JwtAuthGuard)
export class RewardsController {
  constructor(private rewardsService: RewardsService) {}

  // GET /rewards/balance
  @Get('balance')
  async getBalance(@Request() req: any) {
    return this.rewardsService.getBalance(req.user.id);
  }

  // GET /rewards/progress — balance + level + streak, for the
  // section-screen summary card.
  @Get('progress')
  async getProgress(@Request() req: any) {
    return this.rewardsService.getProgress(req.user.id);
  }

  // GET /rewards/history?limit=20&cursor=<entryId>
  @Get('history')
  async getHistory(
    @Request() req: any,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.rewardsService.getHistory(req.user.id, {
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
    });
  }

  @Get('stamps/uncelebrated')
  async getUncelebratedStamps(@Request() req: any) {
    return this.rewardsService.getUncelebratedStamps(req.user.id);
  }

  @Get('stamps/catalogue')
  async getStampsCatalogue() {
    return this.rewardsService.getStampsCatalogue();
  }

  // GET /rewards/stamps — this user's earned Passport Stamps.
  @Get('stamps')
  async getStamps(@Request() req: any) {
    return this.rewardsService.getStamps(req.user.id);
  }

  // POST /rewards/stamps/:id/celebrate — ack a PassportAchievement
  // celebration so it never replays. Idempotent.
  @Post('stamps/:id/celebrate')
  async celebrateStamp(@Request() req: any, @Param('id') id: string) {
    return this.rewardsService.markStampCelebrated(req.user.id, id);
  }

  // GET /rewards/catalogue — display-only reward tiles. Nothing here is
  // redeemable yet; the frontend derives "N rewards ready" / "points to
  // next reward" from this list against the balance it already fetches
  // separately, rather than duplicating that logic server-side.
  @Get('catalogue')
  async getCatalogue() {
    return this.rewardsService.getCatalogue();
  }
}
