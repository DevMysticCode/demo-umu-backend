import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { LlcService } from './llc.service';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';

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
  @ApiOperation({ summary: 'Get Local Land Charges for a property', description: 'Returns the cached Local Land Charges search result for this property (30-day TTL). Any signed-in user may view it - not gated on ownership, since LLC data is licensed for approved-user display generally.' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'LLC search result.', schema: { type: 'object', properties: {
    id: { type: 'string' }, propertyId: { type: 'string' },
    status: { type: 'string', enum: ['OK_WITH_CHARGES', 'OK_EMPTY', 'NOT_MIGRATED', 'MULTI_GEOMETRY', 'ERROR'] },
    errorCode: { type: 'string', nullable: true, description: 'Raw HMLR error code (e.g. E435, E425) - null on success' },
    errorMessage: { type: 'string', nullable: true },
    searchAddress: { type: 'string', nullable: true, description: 'Address HMLR actually searched - may differ from the property record' },
    extentGeoJson: { type: 'object', nullable: true, description: 'GeoJSON GeometryCollection in BNG (EPSG:27700)' },
    extentAreaSqm: { type: 'number', nullable: true },
    warnings: { type: 'array', items: { type: 'string' } },
    charges: { type: 'array', items: { type: 'object' } },
    searchedAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
  } } })
  @SkipThrottle()
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Get()
  async get(@Param('id') id: string) {
    return this.llc.searchByProperty(id);
  }

  // Force-refresh: 3 per minute per IP is plenty for a user tapping
  // "Refresh" a couple of times; a script would trip the bucket long
  // before it burned through our HMLR quota.
  @ApiOperation({ summary: 'Force-refresh Local Land Charges', description: 'Bypasses the cache and re-queries HMLR for this property. Throttled to 3/min/IP to protect the HMLR quota.' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 201, description: 'Freshly fetched LLC search result - same shape as GET /property/:id/llc.', schema: { type: 'object', properties: {
    id: { type: 'string' }, propertyId: { type: 'string' },
    status: { type: 'string', enum: ['OK_WITH_CHARGES', 'OK_EMPTY', 'NOT_MIGRATED', 'MULTI_GEOMETRY', 'ERROR'] },
    errorCode: { type: 'string', nullable: true }, errorMessage: { type: 'string', nullable: true },
    searchAddress: { type: 'string', nullable: true }, extentAreaSqm: { type: 'number', nullable: true },
    warnings: { type: 'array', items: { type: 'string' } }, charges: { type: 'array', items: { type: 'object' } },
    searchedAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
  } } })
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Post('refresh')
  async refresh(@Param('id') id: string) {
    return this.llc.searchByProperty(id, { force: true });
  }
}
