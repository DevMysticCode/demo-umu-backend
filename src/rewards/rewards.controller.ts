import { Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { RewardsService } from './rewards.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';

@Controller('rewards')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class RewardsController {
  constructor(private rewardsService: RewardsService) {}

  @ApiOperation({ summary: 'Get the current points balance', description: 'Just the balance, used in several places expecting this minimal shape - see /progress for balance plus level and streak.' })
  @ApiResponse({ status: 200, description: 'Current balance.', schema: { type: 'object', properties: { balance: { type: 'number' } } } })
  @Get('balance')
  async getBalance(@Request() req: any) {
    return this.rewardsService.getBalance(req.user.id);
  }

  // GET /rewards/progress — balance + level + streak, for the
  // section-screen summary card.
  @ApiOperation({ summary: 'Get balance, level and daily streak', description: 'Combined summary for the section-screen progress card: points balance, computed level progress, and the user\'s current/longest daily-activity streak.' })
  @ApiResponse({ status: 200, description: 'Progress summary.', schema: { type: 'object', properties: { balance: { type: 'number' }, level: { type: 'object' }, streak: { type: 'object', properties: { current: { type: 'number' }, longest: { type: 'number' } } } } } })
  @Get('progress')
  async getProgress(@Request() req: any) {
    return this.rewardsService.getProgress(req.user.id);
  }

  // GET /rewards/history?limit=20&cursor=<entryId>
  @ApiOperation({ summary: 'Get a page of the points ledger', description: 'Cursor-paginated history of every points award, newest first. limit is clamped to 1-100 (default 20).' })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size, 1-100 (default 20)' })
  @ApiQuery({ name: 'cursor', required: false, description: 'Entry id to continue after, from a previous page\'s nextCursor' })
  @ApiResponse({ status: 200, description: 'One page of ledger entries.', schema: { type: 'object', properties: { entries: { type: 'array', items: { type: 'object' } }, nextCursor: { type: 'string', nullable: true } } } })
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

  @ApiOperation({ summary: 'List stamps earned but not yet celebrated', description: 'Stamps minted but whose celebration animation hasn\'t been acknowledged yet - the frontend polls this since award() is always fire-and-forget from the triggering request\'s own response. Oldest first, so queued achievements celebrate in order.' })
  @ApiResponse({ status: 200, description: 'Uncelebrated stamps, oldest first.', schema: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, userId: { type: 'string' }, stampDefinitionId: { type: 'string' },
    passportId: { type: 'string', nullable: true }, propertyId: { type: 'string', nullable: true },
    awardedAt: { type: 'string', format: 'date-time' }, pointsAwarded: { type: 'number', nullable: true },
    celebratedAt: { type: 'string', format: 'date-time', nullable: true, description: 'Always null in this response - that is the filter' },
    verificationStatus: { type: 'string', enum: ['EARNED', 'VERIFIED'] },
    triggerEvent: { type: 'string', nullable: true },
    stampDefinition: { type: 'object', properties: {
      id: { type: 'string' }, key: { type: 'string' }, journeyType: { type: 'string' }, title: { type: 'string' },
      subtitle: { type: 'string', nullable: true }, description: { type: 'string', nullable: true },
      checklistItems: { type: 'array', nullable: true, items: { type: 'string' } },
      iconAsset: { type: 'string', nullable: true }, tier: { type: 'number', nullable: true }, category: { type: 'string', nullable: true },
    } },
  } } } })
  @Get('stamps/uncelebrated')
  async getUncelebratedStamps(@Request() req: any) {
    return this.rewardsService.getUncelebratedStamps(req.user.id);
  }

  // GET /rewards/stamps/catalogue?passportId=... — passportId is optional
  // but needed for per-property applicability (see getStampsCatalogue).
  @ApiOperation({
    summary: 'List every active stamp, earned or not',
    description:
      'Full catalogue (earned + locked) for the Passport Stamps collection view. If passportId is given, each stamp is annotated with applicable based on that property\'s actual section/question answers (e.g. a leasehold-only stamp is marked not applicable for a freehold property) - the caller must have access to that passport.',
  })
  @ApiQuery({ name: 'passportId', required: false, description: 'Annotate stamps with per-property applicability for this passport' })
  @ApiResponse({ status: 200, description: 'Full stamp catalogue with an applicable flag on each.', schema: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, key: { type: 'string' }, journeyType: { type: 'string' }, title: { type: 'string' },
    subtitle: { type: 'string', nullable: true }, description: { type: 'string', nullable: true },
    checklistItems: { type: 'array', nullable: true, items: { type: 'string' } },
    iconAsset: { type: 'string', nullable: true }, tier: { type: 'number', nullable: true }, category: { type: 'string', nullable: true },
    active: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' },
    applicable: { type: 'boolean', description: 'True unless passportId was given and this stamp is gated out for that property (e.g. a leasehold-only stamp on a freehold passport)' },
  } } } })
  @ApiResponse({ status: 403, description: 'passportId given but the caller has no access to it.' })
  @Get('stamps/catalogue')
  async getStampsCatalogue(
    @Request() req: any,
    @Query('passportId') passportId?: string,
  ) {
    return this.rewardsService.getStampsCatalogue(req.user.id, passportId);
  }

  // GET /rewards/stamps — this user's earned Passport Stamps.
  @ApiOperation({ summary: 'List this user\'s earned Passport Stamps', description: 'Every stamp actually awarded to the signed-in user, most recently awarded first.' })
  @ApiResponse({ status: 200, description: 'Earned stamps.', schema: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, userId: { type: 'string' }, stampDefinitionId: { type: 'string' },
    passportId: { type: 'string', nullable: true }, propertyId: { type: 'string', nullable: true },
    awardedAt: { type: 'string', format: 'date-time' }, pointsAwarded: { type: 'number', nullable: true },
    celebratedAt: { type: 'string', format: 'date-time', nullable: true },
    verificationStatus: { type: 'string', enum: ['EARNED', 'VERIFIED'] },
    triggerEvent: { type: 'string', nullable: true },
    stampDefinition: { type: 'object', properties: {
      id: { type: 'string' }, key: { type: 'string' }, journeyType: { type: 'string' }, title: { type: 'string' },
      subtitle: { type: 'string', nullable: true }, iconAsset: { type: 'string', nullable: true }, category: { type: 'string', nullable: true },
    } },
  } } } })
  @Get('stamps')
  async getStamps(@Request() req: any) {
    return this.rewardsService.getStamps(req.user.id);
  }

  // POST /rewards/stamps/:id/celebrate — ack a PassportAchievement
  // celebration so it never replays. Idempotent.
  @ApiOperation({ summary: 'Acknowledge a stamp\'s celebration', description: 'Marks the stamp as celebrated so it never shows the celebration animation again. Idempotent - acknowledging an already-celebrated or someone else\'s stamp id is a harmless no-op.' })
  @ApiParam({ name: 'id', description: 'The UserStamp id being acknowledged' })
  @ApiResponse({ status: 201, description: 'Acknowledgement result.', schema: { type: 'object', properties: { acknowledged: { type: 'boolean', description: 'False if the stamp did not exist, belonged to someone else, or was already acknowledged' } } } })
  @Post('stamps/:id/celebrate')
  async celebrateStamp(@Request() req: any, @Param('id') id: string) {
    return this.rewardsService.markStampCelebrated(req.user.id, id);
  }

  // GET /rewards/catalogue — display-only reward tiles. Nothing here is
  // redeemable yet; the frontend derives "N rewards ready" / "points to
  // next reward" from this list against the balance it already fetches
  // separately, rather than duplicating that logic server-side.
  @ApiOperation({ summary: 'List display-only reward tiles', description: 'Active reward catalogue items, in display order. Nothing here is redeemable yet - the frontend derives things like "points to next reward" by comparing this list against the balance fetched separately.' })
  @ApiResponse({ status: 200, description: 'Active reward tiles.', schema: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, partner: { type: 'string' }, title: { type: 'string' }, description: { type: 'string', nullable: true },
    pointsRequired: { type: 'number' }, iconAsset: { type: 'string', nullable: true }, active: { type: 'boolean' },
    sortOrder: { type: 'number' }, createdAt: { type: 'string', format: 'date-time' },
  } } } })
  @Get('catalogue')
  async getCatalogue() {
    return this.rewardsService.getCatalogue();
  }
}
