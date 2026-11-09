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
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { timingSafeStringEqual } from '../common/timing-safe-equal';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiParam, ApiHeader, ApiBody } from '@nestjs/swagger';

// Relied solely on the 300 req/min/IP global default — clientId/clientSecret
// here is a long-lived B2B credential (not a per-request JWT), so an
// unthrottled create/poll pair is both a brute-force surface against that
// secret and, for createRequest specifically, an email-bombing vector
// against the buyer being asked to consent (same class of gap as the
// OTP/email endpoints already throttled elsewhere — data-leakage audit
// 2026-10-19).
const VERIFIER_API_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

// ── Buyer-facing routes (JWT) ───────────────────────────────────────────────

@Controller('buyer-profile/access-requests')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class BuyerProfileAccessController {
  constructor(private svc: VerifierApiService) {}

  @ApiOperation({ summary: "List the buyer's own access requests", description: "Standard user JWT auth. Returns up to the 50 most recent external-organisation access requests made against this buyer's profile, each with the requesting org and any resulting grant." })
  @ApiResponse({ status: 200, description: 'Access-request rows for this buyer.', schema: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, status: { type: 'string', example: 'PENDING' }, requestedScopes: { type: 'array', items: { type: 'string' } },
    approvedScopes: { type: 'array', items: { type: 'string' } }, reason: { type: 'string', nullable: true },
    expiresAt: { type: 'string', format: 'date-time' }, createdAt: { type: 'string', format: 'date-time' }, decidedAt: { type: 'string', format: 'date-time', nullable: true },
    org: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, legalName: { type: 'string', nullable: true }, logoEmoji: { type: 'string', nullable: true }, description: { type: 'string', nullable: true }, fcaNumber: { type: 'string', nullable: true }, websiteUrl: { type: 'string', nullable: true } } },
    grant: { type: 'object', nullable: true, properties: { id: { type: 'string' }, scopes: { type: 'array', items: { type: 'string' } }, expiresAt: { type: 'string', format: 'date-time' }, revokedAt: { type: 'string', format: 'date-time', nullable: true }, lastUsedAt: { type: 'string', format: 'date-time', nullable: true } } },
  } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @Get()
  async list(@Request() req: any) {
    return this.svc.listForBuyer(req.user.id);
  }

  @ApiOperation({ summary: 'Get one access request', description: "Returns a single access request belonging to the signed-in buyer; 404s if it doesn't exist or belongs to someone else." })
  @ApiParam({ name: 'id', description: 'AccessRequest ID' })
  @ApiResponse({ status: 200, description: 'The access request, with its org and any grant.', schema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', example: 'PENDING' }, requestedScopes: { type: 'array', items: { type: 'string' } }, approvedScopes: { type: 'array', items: { type: 'string' } }, reason: { type: 'string', nullable: true }, expiresAt: { type: 'string', format: 'date-time' }, createdAt: { type: 'string', format: 'date-time' }, decidedAt: { type: 'string', format: 'date-time', nullable: true }, org: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, legalName: { type: 'string', nullable: true }, logoEmoji: { type: 'string', nullable: true }, description: { type: 'string', nullable: true }, fcaNumber: { type: 'string', nullable: true }, websiteUrl: { type: 'string', nullable: true } } }, grant: { type: 'object', nullable: true, properties: { id: { type: 'string' }, scopes: { type: 'array', items: { type: 'string' } }, expiresAt: { type: 'string', format: 'date-time' }, revokedAt: { type: 'string', format: 'date-time', nullable: true }, lastUsedAt: { type: 'string', format: 'date-time', nullable: true } } } } } })
  @ApiResponse({ status: 404, description: "Not found, or belongs to a different buyer." })
  @Get(':id')
  async getOne(@Request() req: any, @Param('id') id: string) {
    return this.svc.getRequestForBuyer(req.user.id, id);
  }

  @ApiOperation({ summary: 'Approve an access request', description: 'Buyer approves a pending external-organisation access request, scoped to the categories they choose, creating an AccessGrant. Only valid while the request is still PENDING.' })
  @ApiParam({ name: 'id', description: 'AccessRequest ID' })
  @ApiBody({ schema: { type: 'object', required: ['scopes'], properties: {
    scopes: { type: 'array', items: { type: 'string' }, description: 'Categories the buyer is choosing to approve - may be a subset of what was requested' },
    expiresInDays: { type: 'integer', nullable: true },
  } } })
  @ApiResponse({ status: 201, description: 'The created access grant.', schema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', example: 'APPROVED' }, requestedScopes: { type: 'array', items: { type: 'string' } }, approvedScopes: { type: 'array', items: { type: 'string' } }, reason: { type: 'string', nullable: true }, expiresAt: { type: 'string', format: 'date-time' }, createdAt: { type: 'string', format: 'date-time' }, decidedAt: { type: 'string', format: 'date-time', nullable: true }, org: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, legalName: { type: 'string', nullable: true }, logoEmoji: { type: 'string', nullable: true }, description: { type: 'string', nullable: true }, fcaNumber: { type: 'string', nullable: true }, websiteUrl: { type: 'string', nullable: true } } }, grant: { type: 'object', properties: { id: { type: 'string' }, scopes: { type: 'array', items: { type: 'string' } }, expiresAt: { type: 'string', format: 'date-time' }, revokedAt: { type: 'string', format: 'date-time', nullable: true }, lastUsedAt: { type: 'string', format: 'date-time', nullable: true } } } } } })
  @ApiResponse({ status: 404, description: 'Not found, or belongs to a different buyer.' })
  @ApiResponse({ status: 400, description: 'Request is no longer PENDING, or none of the chosen scopes were actually requested.' })
  @ApiResponse({ status: 410, description: 'Request has expired (auto-marked EXPIRED on this attempt).' })
  @Post(':id/approve')
  async approve(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: ApproveAccessDto,
  ) {
    return this.svc.approve(req.user.id, id, dto);
  }

  @ApiOperation({ summary: 'Decline an access request', description: 'Buyer declines a pending external-organisation access request. Only valid while the request is still PENDING.' })
  @ApiParam({ name: 'id', description: 'AccessRequest ID' })
  @ApiResponse({ status: 201, description: 'The updated (declined) request.', schema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', example: 'DECLINED' }, requestedScopes: { type: 'array', items: { type: 'string' } }, approvedScopes: { type: 'array', items: { type: 'string' } }, reason: { type: 'string', nullable: true }, expiresAt: { type: 'string', format: 'date-time' }, createdAt: { type: 'string', format: 'date-time' }, decidedAt: { type: 'string', format: 'date-time', nullable: true }, org: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } }, grant: { type: 'object', nullable: true, description: 'Always null for a decline - no grant is ever created on this path', properties: { id: { type: 'string' }, scopes: { type: 'array', items: { type: 'string' } }, expiresAt: { type: 'string', format: 'date-time' }, revokedAt: { type: 'string', format: 'date-time', nullable: true }, lastUsedAt: { type: 'string', format: 'date-time', nullable: true } } } } } })
  @ApiResponse({ status: 404, description: 'Not found, or belongs to a different buyer.' })
  @ApiResponse({ status: 400, description: 'Request is no longer PENDING.' })
  @Post(':id/decline')
  async decline(@Request() req: any, @Param('id') id: string) {
    return this.svc.decline(req.user.id, id);
  }
}

// Separate controller — JWT-guarded — for buyer-revokes-grant.
@Controller('buyer-profile/access-grants')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class BuyerProfileGrantController {
  constructor(private svc: VerifierApiService) {}

  @ApiOperation({ summary: 'Revoke a previously granted access', description: "Buyer revokes an AccessGrant they previously approved for an external organisation, immediately invalidating that org's access token. Idempotent if already revoked." })
  @ApiParam({ name: 'id', description: 'AccessGrant ID' })
  @ApiResponse({ status: 201, description: 'The revoked grant. Note: returned as the raw stored row, including accessTokenHash/accessTokenEncrypted — unlike the access-requests endpoints above, this response is not passed through a sanitized view.', schema: { type: 'object', properties: { id: { type: 'string' }, requestId: { type: 'string' }, accessTokenHash: { type: 'string' }, accessTokenEncrypted: { type: 'string' }, refreshToken: { type: 'string', nullable: true }, scopes: { type: 'array', items: { type: 'string' } }, expiresAt: { type: 'string', format: 'date-time' }, revokedAt: { type: 'string', format: 'date-time' }, createdAt: { type: 'string', format: 'date-time' } } } })
  @ApiResponse({ status: 404, description: 'Grant not found, or belongs to a different buyer.' })
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
@Throttle(VERIFIER_API_THROTTLE)
export class VerifierPublicController {
  constructor(private svc: VerifierApiService) {}

  @ApiOperation({ summary: 'Create an access request to a buyer profile', description: "Called server-to-server by a registered verifier organisation. Authenticates with X-Client-Id/X-Client-Secret headers (not a user JWT), then creates a PENDING AccessRequest the buyer must approve or decline. Throttled (20/min) against both credential brute-forcing and email-bombing the buyer." })
  @ApiHeader({ name: 'X-Client-Id', description: "The verifier organisation's client ID" })
  @ApiHeader({ name: 'X-Client-Secret', description: "The verifier organisation's client secret" })
  @ApiResponse({
    status: 201,
    description: 'The created, PENDING access request.',
    schema: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        status: { type: 'string', example: 'PENDING' },
        expiresAt: { type: 'string', format: 'date-time' },
        pollUrl: { type: 'string', description: 'Relative URL to poll for status, e.g. /api/v1/access-requests/<id>' },
      },
    },
  })
  @ApiHeader({ name: 'x-client-id', description: "The external organisation's client ID, issued via POST /admin/verifier/orgs." })
  @ApiHeader({ name: 'x-client-secret', description: "The external organisation's client secret." })
  @ApiBody({ schema: { type: 'object', required: ['scopes'], properties: {
    scopes: { type: 'array', items: { type: 'string' }, description: 'Requested categories' },
    buyerRef: { type: 'string', nullable: true, description: "The buyer's public reference code - preferred lookup" },
    buyerEmail: { type: 'string', nullable: true, format: 'email', description: 'Fallback lookup if buyerRef is not known' },
    reason: { type: 'string', nullable: true },
  } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid client credentials.' })
  @ApiResponse({ status: 403, description: 'Org is suspended, or requested a scope outside its allowedScopes.' })
  @ApiResponse({ status: 400, description: 'At least one scope is required.' })
  @ApiResponse({ status: 404, description: 'No buyer found for the given buyerRef/buyerEmail.' })
  @Post('access-requests')
  async createRequest(
    @Headers('x-client-id') clientId: string,
    @Headers('x-client-secret') clientSecret: string,
    @Body() dto: CreateAccessRequestDto,
  ) {
    return this.svc.createRequest(clientId, clientSecret, dto);
  }

  @ApiOperation({ summary: 'Poll an access request status', description: 'Called server-to-server by the requesting organisation to check whether the buyer has approved, declined, or not yet actioned their access request. Same client credential headers as creating the request.' })
  @ApiHeader({ name: 'X-Client-Id', description: "The verifier organisation's client ID" })
  @ApiHeader({ name: 'X-Client-Secret', description: "The verifier organisation's client secret" })
  @ApiParam({ name: 'id', description: 'AccessRequest ID' })
  @ApiResponse({
    status: 200,
    description: 'The request status; an `access` block is present only once status is APPROVED.',
    schema: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        status: { type: 'string', example: 'PENDING', description: "'PENDING' | 'APPROVED' | 'DECLINED' | 'EXPIRED'" },
        requestedScopes: { type: 'array', items: { type: 'string' } },
        approvedScopes: { type: 'array', items: { type: 'string' }, nullable: true },
        expiresAt: { type: 'string', format: 'date-time' },
        decidedAt: { type: 'string', format: 'date-time', nullable: true },
        access: {
          type: 'object',
          nullable: true,
          description: 'Present only when status is APPROVED',
          properties: {
            accessToken: { type: 'string' },
            scopes: { type: 'array', items: { type: 'string' } },
            tokenExpiresAt: { type: 'string', format: 'date-time' },
            fetchUrl: { type: 'string', example: '/api/v1/buyer-profile' },
          },
        },
      },
    },
  })
  @ApiHeader({ name: 'x-client-id', description: "The external organisation's client ID." })
  @ApiHeader({ name: 'x-client-secret', description: "The external organisation's client secret." })
  @ApiResponse({ status: 401, description: 'Missing or invalid client credentials.' })
  @ApiResponse({ status: 404, description: 'Access request not found.' })
  @Get('access-requests/:id')
  async pollRequest(
    @Headers('x-client-id') clientId: string,
    @Headers('x-client-secret') clientSecret: string,
    @Param('id') id: string,
  ) {
    return this.svc.getRequestStatus(clientId, clientSecret, id);
  }

  @ApiOperation({ summary: 'Fetch the authorised buyer profile data', description: "Called server-to-server using the scoped bearer access token issued once a buyer approves an organisation's request (Authorization: Bearer <token>, not a normal user JWT). Returns only the categories the buyer approved, and records the access in AccessLog with the caller's IP/user-agent." })
  @ApiHeader({ name: 'Authorization', description: 'Bearer <scoped access token from an approved AccessGrant>' })
  @ApiResponse({
    status: 200,
    description: 'PDTF (Property Data Trust Framework)-formatted buyer data. Base fields are always present; each named block (identity, proof_of_deposit, source_of_funds, affordability, credit_file) is included only if the grant was approved for that scope.',
    schema: {
      type: 'object',
      properties: {
        schema_version: { type: 'string', example: '1.0' },
        pdtf_conformant: { type: 'boolean' },
        passport_id: { type: 'string' },
        buyer_ref: { type: 'string' },
        consent_scope: { type: 'array', items: { type: 'string' } },
        issued_to: { type: 'object', properties: { name: { type: 'string' }, fca_number: { type: 'string', nullable: true } } },
        issued_at: { type: 'string', format: 'date-time' },
        token_expires: { type: 'string', format: 'date-time' },
        identity: {
          type: 'object', nullable: true,
          properties: { id_document_type: { type: 'string', nullable: true }, id_verified: { type: 'boolean' }, verified_by: { type: 'string', nullable: true }, verified_at: { type: 'string', format: 'date-time', nullable: true }, aml_status: { type: 'string' } },
        },
        proof_of_deposit: {
          type: 'object', nullable: true,
          properties: { amount_gbp: { type: 'number', nullable: true }, verified_by: { type: 'string', nullable: true }, verified_at: { type: 'string', format: 'date-time', nullable: true }, aml_status: { type: 'string' } },
        },
        source_of_funds: {
          type: 'object', nullable: true,
          properties: { breakdown: { type: 'object', nullable: true, description: 'Raw sourceOfFundsJson as the buyer entered it - free-form, no fixed schema (user-authored key/value breakdown of where their funds come from)' }, aml_status: { type: 'string' }, verified_by: { type: 'string' } },
        },
        affordability: {
          type: 'object', nullable: true,
          properties: { score: { type: 'number', nullable: true }, band: { type: 'string', nullable: true, description: "'low_risk' | 'medium_risk' | 'high_risk'" }, verified_by: { type: 'string' } },
        },
        credit_file: {
          type: 'object', nullable: true,
          description: 'Not yet connected to a real bureau - always returns nulls/false today.',
          properties: {
            experian: { type: 'object', nullable: true, description: 'Reserved for a future Experian integration - always null today, not yet wired to a real bureau' },
            equifax: { type: 'object', nullable: true, description: 'Reserved for a future Equifax integration - always null today, not yet wired to a real bureau' },
            verified: { type: 'boolean' },
          },
        },
      },
    },
  })
  @ApiHeader({ name: 'authorization', description: "Bearer <accessToken> - the scoped access token returned once the access request was approved (see access.accessToken from GET /api/v1/access-requests/:id)." })
  @ApiHeader({ name: 'user-agent', description: 'Recorded against the AccessLog entry for this fetch; not otherwise validated.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @ApiResponse({ status: 410, description: 'Access token was revoked by the buyer, or has expired.' })
  @ApiResponse({ status: 404, description: 'Buyer profile not found.' })
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

  @ApiOperation({ summary: 'Register a new verifier organisation', description: 'Admin-secret-gated (temporary stand-in until a real admin portal exists). Onboards a new external organisation allowed to request buyer-profile access, issuing it a client ID/secret pair and an allowed-scopes list.' })
  @ApiHeader({ name: 'x-admin-secret', description: 'Shared admin secret' })
  @ApiResponse({
    status: 201,
    description: "The created org plus a one-time-visible client secret. The secret cannot be retrieved again after this response - store it now.",
    schema: {
      type: 'object',
      properties: {
        org: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            legalName: { type: 'string', nullable: true },
            logoEmoji: { type: 'string', nullable: true },
            description: { type: 'string', nullable: true },
            fcaNumber: { type: 'string', nullable: true },
            contactEmail: { type: 'string' },
            websiteUrl: { type: 'string', nullable: true },
            status: { type: 'string', example: 'ACTIVE' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        client: {
          type: 'object',
          properties: {
            clientId: { type: 'string' },
            clientSecret: { type: 'string', description: 'Shown only in this response - not retrievable later' },
          },
        },
        message: { type: 'string' },
      },
    },
  })
  @ApiBody({ schema: { type: 'object', required: ['name', 'contactEmail', 'allowedScopes'], properties: {
    name: { type: 'string' },
    legalName: { type: 'string', nullable: true },
    logoEmoji: { type: 'string', nullable: true },
    description: { type: 'string', nullable: true },
    fcaNumber: { type: 'string', nullable: true },
    contactEmail: { type: 'string', format: 'email' },
    websiteUrl: { type: 'string', nullable: true },
    allowedScopes: { type: 'array', items: { type: 'string' }, description: 'The categories this org is permitted to ever request' },
  } } })
  @ApiResponse({ status: 403, description: 'Missing or invalid x-admin-secret.' })
  @ApiResponse({ status: 400, description: 'name and contactEmail are required.' })
  @Post('orgs')
  async registerOrg(
    @Headers('x-admin-secret') adminSecret: string,
    @Body() dto: CreateVerifierOrgDto,
  ) {
    const expected = process.env.ADMIN_SECRET;
    if (!expected) {
      throw new ForbiddenException('ADMIN_SECRET not configured');
    }
    if (!timingSafeStringEqual(adminSecret, expected)) {
      throw new ForbiddenException('Invalid admin secret');
    }
    if (!dto?.name || !dto?.contactEmail) {
      throw new BadRequestException('name and contactEmail required');
    }
    return this.svc.registerOrg(dto);
  }
}
