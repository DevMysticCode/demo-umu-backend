// ────────────────────────────────────────────────────────────────────────────
//  Verifier-API controllers
//
//  Three routing concerns, split into two controllers:
//
//   • `/buyer-profile/access-requests` (BuyerProfileAccessController) — what
//     the buyer hits from the app. JWT-guarded.
//   • `/api/v1/...` (VerifierPublicController) — what a registered org calls
//     server-to-server. Bearer or client_id+secret in headers.
//   • `/admin/verifier/...` (VerifierAdminController) — gated by the existing
//     ADMIN_SECRET header pattern (same as the maintenance module). Used to
//     onboard new verifier orgs while the admin portal is unbuilt.
// ────────────────────────────────────────────────────────────────────────────

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Request,
  Headers,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  Ip,
} from '@nestjs/common';
import {
  VerifierApiService,
  CreateVerifierOrgDto,
  CreateAccessRequestDto,
  ApproveAccessDto,
} from './verifier-api.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

// ── Buyer-facing routes (JWT) ───────────────────────────────────────────────

@Controller('buyer-profile/access-requests')
@UseGuards(JwtAuthGuard)
export class BuyerProfileAccessController {
  constructor(private svc: VerifierApiService) {}

  @Get()
  async list(@Request() req: any) {
    return this.svc.listForBuyer(req.user.id);
  }

  @Get(':id')
  async getOne(@Request() req: any, @Param('id') id: string) {
    return this.svc.getRequestForBuyer(req.user.id, id);
  }

  @Post(':id/approve')
  async approve(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: ApproveAccessDto,
  ) {
    return this.svc.approve(req.user.id, id, dto);
  }

  @Post(':id/decline')
  async decline(@Request() req: any, @Param('id') id: string) {
    return this.svc.decline(req.user.id, id);
  }
}

// Separate controller — JWT-guarded — for buyer-revokes-grant.
@Controller('buyer-profile/access-grants')
@UseGuards(JwtAuthGuard)
export class BuyerProfileGrantController {
  constructor(private svc: VerifierApiService) {}

  @Post(':id/revoke')
  async revoke(@Request() req: any, @Param('id') id: string) {
    return this.svc.revokeGrant(req.user.id, id);
  }
}

// ── Public verifier API ─────────────────────────────────────────────────────
// Servers belonging to registered verifier orgs call these endpoints. Two
// auth schemes:
//   • For /access-requests and /access-requests/:id: send `X-Client-Id` +
//     `X-Client-Secret` headers.
//   • For /buyer-profile: send `Authorization: Bearer <access_token>` issued
//     after the buyer's approval.

@Controller('api/v1')
export class VerifierPublicController {
  constructor(private svc: VerifierApiService) {}

  @Post('access-requests')
  async createRequest(
    @Headers('x-client-id') clientId: string,
    @Headers('x-client-secret') clientSecret: string,
    @Body() dto: CreateAccessRequestDto,
  ) {
    return this.svc.createRequest(clientId, clientSecret, dto);
  }

  @Get('access-requests/:id')
  async pollRequest(
    @Headers('x-client-id') clientId: string,
    @Headers('x-client-secret') clientSecret: string,
    @Param('id') id: string,
  ) {
    return this.svc.getRequestStatus(clientId, clientSecret, id);
  }

  @Get('buyer-profile')
  async fetchBuyerProfile(
    @Headers('authorization') authHeader: string,
    @Headers('user-agent') ua: string,
    @Ip() ip: string,
  ) {
    const token = (authHeader || '').replace(/^Bearer\s+/i, '').trim();
    return this.svc.fetchBuyerProfile(token, { ip, userAgent: ua });
  }
}

// ── Admin: onboard a verifier org ───────────────────────────────────────────
// Until a real admin portal exists, we re-use the x-admin-secret header
// pattern that the maintenance module already trusts.

@Controller('admin/verifier')
export class VerifierAdminController {
  constructor(private svc: VerifierApiService) {}

  @Post('orgs')
  async registerOrg(
    @Headers('x-admin-secret') adminSecret: string,
    @Body() dto: CreateVerifierOrgDto,
  ) {
    const expected = process.env.ADMIN_SECRET;
    if (!expected) {
      throw new ForbiddenException('ADMIN_SECRET not configured');
    }
    if (!adminSecret || adminSecret !== expected) {
      throw new ForbiddenException('Invalid admin secret');
    }
    if (!dto?.name || !dto?.contactEmail) {
      throw new BadRequestException('name and contactEmail required');
    }
    return this.svc.registerOrg(dto);
  }
}
