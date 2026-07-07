import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { LlcService } from './llc.service';

/**
 * GET  /property/:id/llc          — cached read-through (30-day TTL)
 * POST /property/:id/llc/refresh  — force refresh, rate-limited
 *
 * Both routes require a JWT because LLC data is licensed for approved-
 * user display. We don't gate on ownership — anyone signed in and
 * looking at a property page (buyer viewing a listing, seller managing
 * their passport) can pull the cached LLC. The refresh action is
 * rate-limited so a hot page can't hammer HMLR.
 */
@Controller('property/:id/llc')
export class LlcController {
  constructor(private llc: LlcService) {}

  // The GET should not be throttled by the default bucket — property
  // pages fan out to a dozen endpoints on mount and would trip the
  // 300/min bucket in prod on a shared IP.
  @SkipThrottle()
  @UseGuards(JwtAuthGuard)
  @Get()
  async get(@Param('id') id: string) {
    return this.llc.searchByProperty(id);
  }

  // Force-refresh: 3 per minute per IP is plenty for a user tapping
  // "Refresh" a couple of times; a script would trip the bucket long
  // before it burned through our HMLR quota.
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @UseGuards(JwtAuthGuard)
  @Post('refresh')
  async refresh(@Param('id') id: string) {
    return this.llc.searchByProperty(id, { force: true });
  }
}
