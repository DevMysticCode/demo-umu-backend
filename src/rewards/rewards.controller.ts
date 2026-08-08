import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
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

  // GET /rewards/stamps — this user's earned Passport Stamps.
  @Get('stamps')
  async getStamps(@Request() req: any) {
    return this.rewardsService.getStamps(req.user.id);
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
