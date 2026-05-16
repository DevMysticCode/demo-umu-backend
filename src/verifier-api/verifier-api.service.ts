// ────────────────────────────────────────────────────────────────────────────
//  Verifier-API service (OPDA / PDTF Sprint 1)
//
//  Implements the buyer-side approval flow + the public OpenProperty API a
//  registered verifier organisation calls to read a buyer's verified record.
//
//  Two boundaries here:
//    • Buyer-facing methods (listPendingForBuyer, approve, decline, revoke).
//      Always require a buyer JWT — guarded at the controller.
//    • Verifier-facing methods (registerOrg helpers, createRequest from a
//      client, fetchBuyerProfile by bearer token). Authenticated by
//      client_id + secret OR by the access_token issued post-approval.
//
//  Response shape follows the PDTF / OPDA conventions seen in the prototype:
//  snake_case, ISO-8601 timestamps, `verified_by` provenance on every
//  verified field, currency as `..._gbp` integers.
// ────────────────────────────────────────────────────────────────────────────

import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import {
  IsArray,
  IsOptional,
  IsString,
  IsInt,
  IsEmail,
  Min,
} from 'class-validator';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { PrismaService } from '../prisma/prisma.service';

const scrypt = promisify(scryptCb) as (
  pwd: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

// All scope names align with the PDTF vocabulary used in the prototype's
// sample API response. Anything outside this set is rejected at request time.
export const ALL_SCOPES = [
  'identity',
  'proof_of_deposit',
  'source_of_funds',
  'affordability',
  'credit_file',
  'purchase_profile',
  'story',
] as const;
export type Scope = (typeof ALL_SCOPES)[number];

// Default expiry for the AccessRequest itself ("approve me in 48h"). Distinct
// from the AccessGrant TTL (max 30 days).
const REQUEST_TTL_MS = 48 * 60 * 60 * 1000;
const MAX_GRANT_DAYS = 30;

export class CreateVerifierOrgDto {
  @IsString() name!: string;
  @IsOptional() @IsString() legalName?: string;
  @IsOptional() @IsString() logoEmoji?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() fcaNumber?: string;
  @IsEmail() contactEmail!: string;
  @IsOptional() @IsString() websiteUrl?: string;
  @IsArray() allowedScopes!: string[];
}

export class CreateAccessRequestDto {
  @IsArray() scopes!: string[];
  @IsOptional() @IsString() buyerRef?: string;       // public ref preferred
  @IsOptional() @IsEmail() buyerEmail?: string;       // fallback lookup
  @IsOptional() @IsString() reason?: string;
}

export class ApproveAccessDto {
  @IsArray() scopes!: string[];
  @IsOptional() @IsInt() @Min(1) expiresInDays?: number;
}

@Injectable()
export class VerifierApiService {
  constructor(private prisma: PrismaService) {}

  // ── Admin / dev helpers ─────────────────────────────────────────────────

  /** Register a verifier org + a default client. Returns the plaintext
   *  client secret ONCE — store it on the org's side. */
  async registerOrg(dto: CreateVerifierOrgDto) {
    const scopes = sanitiseScopes(dto.allowedScopes);
    const org = await this.prisma.verifierOrg.create({
      data: {
        name: dto.name,
        legalName: dto.legalName ?? null,
        logoEmoji: dto.logoEmoji ?? null,
        description: dto.description ?? null,
        fcaNumber: dto.fcaNumber ?? null,
        contactEmail: dto.contactEmail,
        websiteUrl: dto.websiteUrl ?? null,
      },
    });
    const { clientId, secret, hash } = await mintClientCredentials();
    await this.prisma.verifierClient.create({
      data: {
        orgId: org.id,
        clientId,
        clientSecretHash: hash,
        allowedScopes: scopes,
      },
    });
    return {
      org,
      client: { clientId, clientSecret: secret },
      message:
        'Store the clientSecret now — it cannot be retrieved later. Use it as the Authorization Bearer for /api/v1/access-requests.',
    };
  }

  /** Look up a verifier client by credentials. Throws 401 if mismatch. */
  private async authenticateClient(clientId: string, secret: string) {
    if (!clientId || !secret) {
      throw new UnauthorizedException('Missing client credentials');
    }
    const client = await this.prisma.verifierClient.findUnique({
      where: { clientId },
      include: { org: true },
    });
    if (!client || client.revokedAt) {
      throw new UnauthorizedException('Invalid client');
    }
    if (client.org.status !== 'ACTIVE') {
      throw new ForbiddenException('Verifier org is suspended');
    }
    const ok = await verifySecret(secret, client.clientSecretHash);
    if (!ok) throw new UnauthorizedException('Invalid client');
    return client;
  }

  // ── Verifier-facing: create an access request ───────────────────────────

  async createRequest(
    clientId: string,
    secret: string,
    dto: CreateAccessRequestDto,
  ) {
    const client = await this.authenticateClient(clientId, secret);
    const scopes = sanitiseScopes(dto.scopes);
    if (scopes.length === 0) {
      throw new BadRequestException('At least one scope required');
    }
    // Don't let a client ask for scopes outside its allowed set.
    const disallowed = scopes.filter(
      (s) => !(client.allowedScopes as string[]).includes(s),
    );
    if (disallowed.length > 0) {
      throw new ForbiddenException(
        `Client not permitted to request: ${disallowed.join(', ')}`,
      );
    }
    // Look up the buyer by publicRef (preferred) or email.
    let buyerUserId: string | null = null;
    if (dto.buyerRef) {
      const profile = await this.prisma.buyerProfile.findUnique({
        where: { publicRef: dto.buyerRef },
      });
      buyerUserId = profile?.userId ?? null;
    }
    if (!buyerUserId && dto.buyerEmail) {
      const user = await this.prisma.user.findUnique({
        where: { email: dto.buyerEmail.toLowerCase() },
      });
      buyerUserId = user?.id ?? null;
    }
    if (!buyerUserId) {
      throw new NotFoundException(
        'Buyer not found — provide buyerRef or buyerEmail of an existing UMU buyer',
      );
    }

    const expiresAt = new Date(Date.now() + REQUEST_TTL_MS);
    const request = await this.prisma.accessRequest.create({
      data: {
        orgId: client.orgId,
        clientId: client.id,
        buyerUserId,
        requestedScopes: scopes,
        reason: (dto.reason || '').slice(0, 500) || null,
        expiresAt,
        status: 'PENDING',
      },
    });
    return {
      requestId: request.id,
      status: request.status,
      expiresAt: request.expiresAt.toISOString(),
      pollUrl: `/api/v1/access-requests/${request.id}`,
    };
  }

  /** Verifier polls request status (and gets the access token once approved). */
  async getRequestStatus(
    clientId: string,
    secret: string,
    requestId: string,
  ) {
    const client = await this.authenticateClient(clientId, secret);
    const request = await this.prisma.accessRequest.findUnique({
      where: { id: requestId },
      include: { grant: true },
    });
    if (!request || request.clientId !== client.id) {
      throw new NotFoundException('Request not found');
    }
    if (request.expiresAt.getTime() < Date.now() && request.status === 'PENDING') {
      await this.prisma.accessRequest.update({
        where: { id: requestId },
        data: { status: 'EXPIRED' },
      });
      request.status = 'EXPIRED';
    }
    const out: any = {
      requestId: request.id,
      status: request.status,
      requestedScopes: request.requestedScopes,
      approvedScopes: request.approvedScopes,
      expiresAt: request.expiresAt.toISOString(),
      decidedAt: request.decidedAt?.toISOString() ?? null,
    };
    if (request.status === 'APPROVED' && request.grant) {
      out.access = {
        accessToken: request.grant.accessToken,
        scopes: request.grant.scopes,
        tokenExpiresAt: request.grant.expiresAt.toISOString(),
        fetchUrl: '/api/v1/buyer-profile',
      };
    }
    return out;
  }

  // ── Buyer-facing: list / approve / decline / revoke ─────────────────────

  async listForBuyer(buyerUserId: string) {
    const reqs = await this.prisma.accessRequest.findMany({
      where: { buyerUserId },
      include: { org: true, grant: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return reqs.map((r) => this.buyerRequestView(r));
  }

  async getRequestForBuyer(buyerUserId: string, requestId: string) {
    const r = await this.prisma.accessRequest.findUnique({
      where: { id: requestId },
      include: { org: true, grant: true },
    });
    if (!r || r.buyerUserId !== buyerUserId) {
      throw new NotFoundException('Request not found');
    }
    return this.buyerRequestView(r);
  }

  async approve(buyerUserId: string, requestId: string, dto: ApproveAccessDto) {
    const r = await this.prisma.accessRequest.findUnique({
      where: { id: requestId },
    });
    if (!r || r.buyerUserId !== buyerUserId) {
      throw new NotFoundException('Request not found');
    }
    if (r.status !== 'PENDING') {
      throw new BadRequestException(
        `Cannot approve — request is ${r.status.toLowerCase()}`,
      );
    }
    if (r.expiresAt.getTime() < Date.now()) {
      await this.prisma.accessRequest.update({
        where: { id: requestId },
        data: { status: 'EXPIRED' },
      });
      throw new GoneException('Request has expired');
    }
    // Only allow scopes that were originally requested.
    const requestedSet = new Set(r.requestedScopes);
    const approvedScopes = sanitiseScopes(dto.scopes).filter((s) =>
      requestedSet.has(s),
    );
    if (approvedScopes.length === 0) {
      throw new BadRequestException(
        'Approve at least one scope, or decline the request',
      );
    }
    const days = Math.min(
      MAX_GRANT_DAYS,
      Math.max(1, dto.expiresInDays ?? 30),
    );
    const grantExpiresAt = new Date(Date.now() + days * 86_400_000);
    const accessToken = mintAccessToken();

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.accessRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          approvedScopes,
          decidedAt: new Date(),
        },
      });
      await tx.accessGrant.create({
        data: {
          requestId,
          accessToken,
          scopes: approvedScopes,
          expiresAt: grantExpiresAt,
        },
      });
      return tx.accessRequest.findUnique({
        where: { id: requestId },
        include: { org: true, grant: true },
      });
    });
    return this.buyerRequestView(updated!);
  }

  async decline(buyerUserId: string, requestId: string) {
    const r = await this.prisma.accessRequest.findUnique({
      where: { id: requestId },
    });
    if (!r || r.buyerUserId !== buyerUserId) {
      throw new NotFoundException('Request not found');
    }
    if (r.status !== 'PENDING') {
      throw new BadRequestException(
        `Cannot decline — request is ${r.status.toLowerCase()}`,
      );
    }
    const updated = await this.prisma.accessRequest.update({
      where: { id: requestId },
      data: { status: 'DECLINED', decidedAt: new Date() },
      include: { org: true, grant: true },
    });
    return this.buyerRequestView(updated);
  }

  async revokeGrant(buyerUserId: string, grantId: string) {
    const grant = await this.prisma.accessGrant.findUnique({
      where: { id: grantId },
      include: { request: true },
    });
    if (!grant || grant.request.buyerUserId !== buyerUserId) {
      throw new NotFoundException('Grant not found');
    }
    if (grant.revokedAt) return grant;
    return this.prisma.accessGrant.update({
      where: { id: grantId },
      data: { revokedAt: new Date() },
    });
  }

  // ── Verifier-facing fetch — the actual data read ────────────────────────

  async fetchBuyerProfile(
    accessToken: string,
    meta: { ip?: string; userAgent?: string },
  ) {
    if (!accessToken) throw new UnauthorizedException('Missing access token');
    const grant = await this.prisma.accessGrant.findUnique({
      where: { accessToken },
      include: { request: { include: { org: true, client: true, buyer: true } } },
    });
    if (!grant) throw new UnauthorizedException('Invalid access token');
    if (grant.revokedAt) {
      throw new GoneException('Access token revoked by buyer');
    }
    if (grant.expiresAt.getTime() < Date.now()) {
      throw new GoneException('Access token expired');
    }
    const buyerUserId = grant.request.buyerUserId;
    const profile: any = await this.prisma.buyerProfile.findUnique({
      where: { userId: buyerUserId },
    });
    if (!profile) {
      throw new NotFoundException('Buyer profile not found');
    }
    const scopes = grant.scopes as Scope[];

    // Side-effect: bump counters + write audit log. Awaited because OPDA
    // expects a usable audit trail per fetch.
    await this.prisma.$transaction([
      this.prisma.accessGrant.update({
        where: { id: grant.id },
        data: {
          useCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
      }),
      this.prisma.accessLog.create({
        data: {
          grantId: grant.id,
          scopesReturned: scopes,
          ip: meta.ip ?? null,
          userAgent: meta.userAgent?.slice(0, 200) ?? null,
          endpoint: 'GET /api/v1/buyer-profile',
        },
      }),
    ]);
    return buildPdtfResponse({
      profile,
      scopes,
      org: grant.request.org,
      grantExpiresAt: grant.expiresAt,
    });
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private buyerRequestView(r: any) {
    return {
      id: r.id,
      status: r.status,
      requestedScopes: r.requestedScopes,
      approvedScopes: r.approvedScopes,
      reason: r.reason,
      expiresAt: r.expiresAt?.toISOString(),
      createdAt: r.createdAt?.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      org: {
        id: r.org.id,
        name: r.org.name,
        legalName: r.org.legalName,
        logoEmoji: r.org.logoEmoji,
        description: r.org.description,
        fcaNumber: r.org.fcaNumber,
        websiteUrl: r.org.websiteUrl,
      },
      grant: r.grant
        ? {
            id: r.grant.id,
            scopes: r.grant.scopes,
            expiresAt: r.grant.expiresAt.toISOString(),
            revokedAt: r.grant.revokedAt?.toISOString() ?? null,
            lastUsedAt: r.grant.lastUsedAt?.toISOString() ?? null,
            useCount: r.grant.useCount,
          }
        : null,
    };
  }
}

// ── PDTF / OPDA response builder ─────────────────────────────────────────────

function buildPdtfResponse({
  profile,
  scopes,
  org,
  grantExpiresAt,
}: {
  profile: any;
  scopes: Scope[];
  org: any;
  grantExpiresAt: Date;
}) {
  const inScope = (s: Scope) => scopes.includes(s);
  const out: any = {
    schema_version: '1.0',
    pdtf_conformant: true,
    passport_id: profile.id,
    buyer_ref: profile.publicRef,
    consent_scope: scopes,
    issued_to: { name: org.name, fca_number: org.fcaNumber },
    issued_at: new Date().toISOString(),
    token_expires: grantExpiresAt.toISOString(),
  };

  if (inScope('identity')) {
    out.identity = {
      id_document_type: profile.idDocumentType,           // "passport" | "drivingLicence" | "nationalId"
      id_verified: !!profile.idVerified,
      verified_by: profile.idVerificationProvider || (profile.idVerified ? 'persona' : null),
      verified_at: profile.idVerifiedAt?.toISOString() ?? null,
      aml_status: profile.amlStatus || 'unknown',
    };
  }
  if (inScope('proof_of_deposit')) {
    out.proof_of_deposit = {
      amount_gbp: profile.fundsAmountVerified ?? profile.fundsAmount ?? null,
      verified_by: profile.fundsProvider || (profile.fundsVerified ? 'armalytix' : 'self_declared'),
      verified_at: profile.fundsVerifiedAt?.toISOString() ?? null,
      aml_status: profile.amlStatus || (profile.fundsVerified ? 'clear' : 'unknown'),
    };
  }
  if (inScope('source_of_funds')) {
    out.source_of_funds = {
      breakdown: profile.sourceOfFundsJson || null,
      aml_status: profile.amlStatus || 'unknown',
      verified_by: profile.fundsProvider || 'self_declared',
    };
  }
  if (inScope('affordability')) {
    out.affordability = {
      score: profile.affordabilityScore ?? null,
      band: profile.affordabilityScore
        ? profile.affordabilityScore >= 70
          ? 'low_risk'
          : profile.affordabilityScore >= 40
            ? 'medium_risk'
            : 'high_risk'
        : null,
      verified_by: profile.fundsProvider || 'self_declared',
    };
  }
  if (inScope('credit_file')) {
    // Until Premium's real Experian/Equifax integration ships we expose only
    // what the schema persists. Returning null + verified=false is correct
    // PDTF behaviour and matches the prototype's "Equifax cross-check: not
    // yet connected" affordance.
    out.credit_file = {
      experian: null,                                     // populated in Phase 5
      equifax: null,
      verified: false,
    };
  }
  if (inScope('purchase_profile')) {
    out.purchase_profile = {
      chain_position: profile.chainPosition,              // ftb | selling | sold
      timeline: profile.timeline,                          // asap | 3m | 6m | flex
      property_type: profile.propertyType,                 // house | flat | newBuild | any
      solicitor_status: profile.solicitorStatus,           // yes | looking | notsure
    };
  }
  if (inScope('story') && profile.statement) {
    out.story = profile.statement;
  }
  return out;
}

// ── Crypto helpers ──────────────────────────────────────────────────────────

function sanitiseScopes(input: string[]): string[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>();
  for (const s of input) {
    if (typeof s === 'string' && (ALL_SCOPES as readonly string[]).includes(s)) {
      set.add(s);
    }
  }
  return Array.from(set);
}

async function mintClientCredentials() {
  const clientId = `umu_${randomBytes(8).toString('hex')}`;
  const secret = `sk_${randomBytes(24).toString('base64url')}`;
  const hash = await hashSecret(secret);
  return { clientId, secret, hash };
}

async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const buf = await scrypt(secret, salt, 64);
  return `${salt}:${buf.toString('hex')}`;
}

async function verifySecret(secret: string, hashed: string): Promise<boolean> {
  try {
    const [salt, expected] = hashed.split(':');
    if (!salt || !expected) return false;
    const buf = await scrypt(secret, salt, 64);
    const expectedBuf = Buffer.from(expected, 'hex');
    return (
      expectedBuf.length === buf.length &&
      timingSafeEqual(buf, expectedBuf)
    );
  } catch {
    return false;
  }
}

function mintAccessToken(): string {
  // Long random — 256-bit. Bearer-style; we never re-derive it from anywhere
  // else, so opacity is fine for Sprint 1 (JWTs come in Sprint 2 with OAuth).
  return `umu_tok_${randomBytes(32).toString('base64url')}`;
}
