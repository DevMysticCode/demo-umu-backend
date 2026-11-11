import {
  Controller,
  Post,
  Put,
  Patch,
  Get,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  UseGuards,
  Request,
  ForbiddenException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { PassportService } from './passport.service';
import { PassportEventsService } from './passport-events.service';
import { PassportActionsService } from './passport-actions.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { createUploadStorage, publicUrlFor, storedFilename, isS3Mode, IMAGE_MIME_TYPES } from '../common/storage';
import { CreatePassportDto } from './dto/create-passport.dto';
import { ConvertToSellerDto } from './dto/convert-to-seller.dto';
import { SetPassportTypeDto } from './dto/set-passport-type.dto';
import { CreateShareLinkDto, SharePassportWithBuyerDto } from './dto/share.dto';
import { SetLastVisitedDto, SetSectionVisibilityDto } from './dto/misc.dto';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3002';

// JWT-gated but was relying solely on the 300 req/min/IP global default —
// each call is a paid Groq LLM invocation (security review 2026-09-22,
// M8), mirroring the same fix on ChatController.
const AI_SUMMARY_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

// JWT-gated but otherwise relied on the generous global default — each call
// reveals whether an arbitrary email has an UMU account (+ first name),
// which is deliberate product UX for the add-collaborator flow but is also
// an email-enumeration oracle without a tighter per-user limit (data-leakage
// audit 2026-10-19).
const COLLABORATOR_EMAIL_CHECK_THROTTLE = { default: { limit: 15, ttl: 60_000 } };

/**
 * Build an absolute upload URL. Prefers a request-derived scheme+host
 * over the BASE_URL env var — this keeps images loadable on Railway
 * and preview deployments where BASE_URL is often either unset (falls
 * back to `http://localhost:3002` and every uploaded URL breaks on
 * real devices) or lags behind the current deploy's actual hostname.
 * S3-mode public URLs are already absolute and returned unchanged.
 */
function absoluteUploadUrl(req: any, relativeOrAbsolute: string): string {
  if (isS3Mode) return relativeOrAbsolute;
  // Trust request headers first — every reverse-proxied deploy (Railway,
  // Vercel, Cloudflare) sets x-forwarded-proto/x-forwarded-host, and Express
  // parses those when trust proxy is on. Fall back to req.protocol / host
  // for local dev, and finally the env var if req isn't available.
  const proto =
    req?.headers?.['x-forwarded-proto'] ??
    req?.protocol ??
    (BASE_URL.startsWith('https') ? 'https' : 'http');
  const host =
    req?.headers?.['x-forwarded-host'] ??
    req?.get?.('host') ??
    req?.headers?.host ??
    BASE_URL.replace(/^https?:\/\//, '');
  return `${proto}://${host}${relativeOrAbsolute}`;
}

@Controller('passport')
export class PassportController {
  constructor(
    private passportService: PassportService,
    private events: PassportEventsService,
    private actionsService: PassportActionsService,
  ) {}

  @Post('create')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create or resume a passport',
    description:
      'Starts a new Passport. For a manual passport or a landlord→seller convert, the type is applied immediately. For a property claim (propertyId set), the row comes back in PENDING_PAYMENT with no type yet — payment, KYC and HM Land Registry verification happen before set-type/activate below seed the sections.',
  })
  @ApiResponse({
    status: 201,
    description: 'The created (or resumed, if an untyped pending claim already existed) passport.',
    schema: { type: 'object', properties: { passportId: { type: 'string' }, status: { type: 'string' } } },
  })
  async createPassport(@Body() dto: CreatePassportDto, @Request() req: any) {
    const userId = req.user.id;
    // Manual passports / landlord→seller converts send a real type and get
    // it applied immediately. Property claims (dto.propertyId set) don't
    // send one anymore — createPassport() ignores it for that path and the
    // frontend calls set-type below once HMLR verifies ownership.
    const type =
      dto.type === 'landlord' ? 'LANDLORD' : dto.type === 'seller' ? 'SELLER' : undefined;
    return this.passportService.createPassport(
      userId,
      dto.addressLine1,
      dto.postcode,
      dto.propertyId,
      { type, isHmo: !!dto.isHmo },
    );
  }

  // Property owner-claims come back from createPassport in PENDING_PAYMENT
  // status with no type yet (KYC/HMLR cost real money — see PaymentService
  // pricing). Payment happens first (right after createPassport), then KYC
  // and HM Land Registry verification, then this sets the seller/landlord
  // choice once ownership is confirmed — call it right before :id/activate.
  @Post(':id/set-type')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Choose seller or landlord once ownership is verified',
    description:
      'Sets the passport type (and, for landlords, HMO flag) after HM Land Registry ownership verification has succeeded for a property-claim passport. Must be called before :id/activate.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({
    status: 200,
    description: 'The passport id and its current status (already-typed/activated calls are idempotent no-ops).',
    schema: { type: 'object', properties: { passportId: { type: 'string' }, status: { type: 'string' } } },
  })
  @ApiResponse({ status: 403, description: 'Caller is not this passport\'s owner.' })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async setPassportType(
    @Param('id') id: string,
    @Body() dto: SetPassportTypeDto,
    @Request() req: any,
  ) {
    const type = dto.type === 'landlord' ? 'LANDLORD' : 'SELLER';
    return this.passportService.setPassportType(id, req.user.id, type, !!dto.isHmo);
  }

  // Last call in the chain — requires all of: Stripe charge succeeded, KYC
  // approved, HMLR ownership VERIFIED, and a type already set via
  // :id/set-type — before it seeds the passport's sections.
  @Post(':id/activate')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Activate a verified passport claim',
    description:
      'Final step of the claim flow — requires payment succeeded, KYC approved, HM Land Registry ownership verified, and a type already set. Seeds the passport\'s sections/tasks/questions.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({
    status: 200,
    description: 'The passport id (idempotent - calling again on an already-active passport just returns the id).',
    schema: { type: 'object', properties: { passportId: { type: 'string' } } },
  })
  @ApiResponse({ status: 403, description: 'Caller is not this passport\'s owner, or a precondition (payment/KYC/HMLR verification/type) is not yet met.' })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async activatePassport(@Param('id') id: string, @Request() req: any) {
    return this.passportService.activatePassport(id, req.user.id);
  }

  @Post(':id/convert-to-seller')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Convert a landlord passport to a seller passport',
    description: 'Creates a linked SELLER passport for the same property, leaving the original LANDLORD passport unchanged (owner is moving from renting to selling).',
  })
  @ApiParam({ name: 'id', description: 'Landlord passport ID to convert from' })
  @ApiResponse({
    status: 201,
    description: 'The new (or already-existing) seller passport id, and which section keys were carried over.',
    schema: { type: 'object', properties: { passportId: { type: 'string' }, transferredSectionKeys: { type: 'array', items: { type: 'string' } } } },
  })
  @ApiResponse({ status: 403, description: 'Caller is not this landlord passport\'s owner.' })
  @ApiResponse({ status: 404, description: 'Landlord passport not found.' })
  async convertToSeller(
    @Param('id') passportId: string,
    @Body() _dto: ConvertToSellerDto,
    @Request() req: any,
  ) {
    return this.passportService.convertLandlordToSeller(passportId, req.user.id);
  }

  @Get('my')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "List the signed-in user's own and collaborated passports",
    description: 'Returns every passport this user owns, plus every passport they collaborate on. Draft claims never completed (status PENDING_PAYMENT) are excluded.',
  })
  @ApiResponse({
    status: 200,
    description: 'Array of passport summaries (owned and collaborated).',
    schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, addressLine1: { type: 'string' }, postcode: { type: 'string' }, status: { type: 'string' }, type: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } } } },
  })
  async getMyPassports(@Request() req: any) {
    return this.passportService.getUserPassports(req.user.id);
  }

  // Buyer's purchased "watching" list — published passports they've unlocked.
  // Returns array of records the Passport tab uses to render the Watching section.
  @Get('buyer-access')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'List passports this buyer has unlocked',
    description: 'Published passports the signed-in user has paid to unlock (BuyerPassportAccess) — powers the "Watching" section of the Passport tab.',
  })
  @ApiResponse({
    status: 200,
    description: 'Array of unlocked passports with their linked property summary.',
    schema: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, passportId: { type: 'string' }, type: { type: 'string', nullable: true, enum: ['SELLER', 'LANDLORD'] },
      propertyId: { type: 'string', nullable: true }, addressLine1: { type: 'string' }, postcode: { type: 'string' }, status: { type: 'string', nullable: true },
      property: { type: 'object', nullable: true, properties: {
        id: { type: 'string' }, imageUrl: { type: 'string', nullable: true }, addressLine1: { type: 'string' }, postcode: { type: 'string' },
        bedrooms: { type: 'number', nullable: true }, propertyType: { type: 'string', nullable: true }, epcRating: { type: 'string', nullable: true },
      } },
      purchasedAt: { type: 'string', format: 'date-time' },
    } } },
  })
  async getMyBuyerAccess(@Request() req: any) {
    return this.passportService.getBuyerAccessList(req.user.id);
  }

  @Get(':id')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get full passport detail',
    description: 'Returns the passport with its sections/tasks/questions/answers, linked property EPC summary, and any sibling passport created via convert-to-seller. Requires the caller to be the owner or a scoped collaborator.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({
    status: 200,
    description: 'Full passport record with nested sections/tasks/questions/answers, linked property EPC fields, and any sibling convert-to-seller passports. Answer file URLs are resolved to signed, viewer-scoped /files links and filtered to what this viewer is entitled to see.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        addressLine1: { type: 'string' },
        postcode: { type: 'string' },
        ownerId: { type: 'string' },
        propertyId: { type: 'string', nullable: true },
        type: { type: 'string', nullable: true, example: 'SELLER' },
        isHmo: { type: 'boolean' },
        status: { type: 'string' },
        publicVisibility: { type: 'boolean' },
        createdAt: { type: 'string', format: 'date-time' },
        convertedTo: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, type: { type: 'string' } } } },
        property: { type: 'object', nullable: true, properties: { epcRating: { type: 'string', nullable: true }, epcScore: { type: 'number', nullable: true }, lodgementDate: { type: 'string', format: 'date-time', nullable: true }, epcLmkKey: { type: 'string', nullable: true } } },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              key: { type: 'string' },
              title: { type: 'string' },
              order: { type: 'number' },
              tasks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    key: { type: 'string' },
                    title: { type: 'string' },
                    passportQuestions: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          questionTemplate: { type: 'object', properties: { id: { type: 'string' }, type: { type: 'string' }, title: { type: 'string' }, description: { type: 'string', nullable: true } } },
                          answer: { type: 'object', nullable: true, description: 'QuestionAnswer row, with fileUrl set to null when this viewer is not entitled to see it', properties: {
                            answerText: { type: 'string', nullable: true }, answerJson: { type: 'object', nullable: true, description: 'Free-form JSON, shape depends on the question type (multipart/scale/chips/etc.) - not enumerated' },
                            fileUrl: { type: 'string', nullable: true }, createdAt: { type: 'string', format: 'date-time' },
                          } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: "Passport not found, or caller isn't the owner/a scoped collaborator - deliberately returned as 403 rather than 404 so existence isn't leaked to an unauthorised caller." })
  async getPassport(@Param('id') passportId: string, @Request() req: any) {
    const userId = req.user.id;
    // getPassport() now enforces access itself (see its own comment) -
    // no separate checkUserAccess() call needed here any more.
    const passport = await this.passportService.getPassport(passportId, userId);

    if (!passport) {
      throw new ForbiddenException('Passport not found');
    }

    return passport;
  }

  // Jurisdiction guard (UMU_278 handoff, 2 Oct 2026) - lets the frontend
  // show a one-time notice when this property is in Scotland or Northern
  // Ireland, where the pack's guidance/pathways don't apply.
  @Get(':id/jurisdiction')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Get the property's UK jurisdiction",
    description: 'Resolves the nation (England/Wales/Scotland/Northern Ireland) for this passport\'s property, so the frontend can warn when the pack\'s guidance/pathways do not apply (Scotland/NI).',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({ status: 200, description: 'The resolved jurisdiction.', schema: { type: 'object', properties: { nation: { type: 'string', nullable: true } } } })
  @ApiResponse({ status: 403, description: "Caller isn't the owner or a scoped collaborator." })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async getJurisdiction(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.getJurisdiction(passportId, req.user.id);
  }

  @Get(':id/sections')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'List a passport\'s sections with task progress',
    description: 'Returns every section and its tasks for this passport, scoped to the caller\'s access (full for owner, section/task-scoped for a restricted collaborator).',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({ status: 200, description: 'Array of sections, each with its tasks and completion state.', schema: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, key: { type: 'string' }, title: { type: 'string' }, subtitle: { type: 'string', nullable: true }, description: { type: 'string', nullable: true },
    imageKey: { type: 'string', nullable: true }, status: { type: 'string' }, order: { type: 'number' },
    helpContent: { type: 'string', nullable: true }, helpVideoUrl: { type: 'string', nullable: true },
    tasks: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, key: { type: 'string' }, title: { type: 'string' }, description: { type: 'string', nullable: true }, order: { type: 'number' },
      totalQuestions: { type: 'number' }, answeredQuestions: { type: 'number' }, totalPoints: { type: 'number' }, earnedPoints: { type: 'number' },
      hasPublishRequired: { type: 'boolean', description: 'True if this task has at least one hard publication-blocking question' },
    } } },
  } } } })
  @ApiResponse({ status: 403, description: "Caller isn't the owner or a scoped collaborator." })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async getPassportSections(
    @Param('id') passportId: string,
    @Request() req: any,
  ) {
    const userId = req.user.id;
    return this.passportService.getPassportSections(passportId, userId);
  }

  // Lightweight ownership check for the seller passportview page: a
  // collaborator has legitimate view access to /sections (above) and sees
  // the same page as the owner, but owner-only actions on it (add/remove
  // collaborator, publish) silently reject them with no way to tell in
  // advance why. Client bug report, 2026-10-06 - a collaborator who'd
  // switched test accounts assumed they were the owner and read the
  // correct 403 as a bug. The frontend uses this to hide/disable those
  // actions instead of letting a collaborator hit a guaranteed rejection.
  @Get(':id/access')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Check whether the caller owns or collaborates on this passport',
    description: 'Lightweight "am I the owner?" check so the frontend can hide/disable owner-only actions (add/remove collaborator, publish) for a collaborator instead of letting them hit a guaranteed 403.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({
    status: 200,
    description: 'The caller\'s relationship to this passport.',
    schema: { type: 'object', properties: { isOwner: { type: 'boolean' }, isCollaborator: { type: 'boolean' }, permission: { type: 'string', nullable: true } } },
  })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async getPassportAccess(
    @Param('id') passportId: string,
    @Request() req: any,
  ) {
    return this.passportService.getPassportAccess(passportId, req.user.id);
  }

  // Address / UPRN / title number we already hold for this passport's
  // property — used to pre-fill the "address of the property" question
  // instead of asking the owner to re-type known facts.
  @Get(':id/property-facts')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get already-known property facts for pre-fill',
    description: 'Returns the address/UPRN/title number already held for this passport\'s property, so question forms can pre-fill known facts instead of asking the owner to re-type them.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({
    status: 200,
    description: 'Known property facts, falling back to the passport\'s own address columns when there is no linked Property.',
    schema: {
      type: 'object',
      properties: {
        addressLine1: { type: 'string', nullable: true },
        city: { type: 'string', nullable: true },
        postcode: { type: 'string', nullable: true },
        uprn: { type: 'string', nullable: true },
        titleNumber: { type: 'string', nullable: true },
        propertyType: { type: 'string', nullable: true },
      },
    },
  })
  @ApiResponse({ status: 403, description: "Caller isn't the owner or a scoped collaborator." })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async getPassportPropertyFacts(
    @Param('id') passportId: string,
    @Request() req: any,
  ) {
    return this.passportService.getPassportPropertyFacts(passportId, req.user.id);
  }

  // Step 1 of the interactive add-collaborator modal: check whether the
  // typed email has an account before asking for role/access.
  @Throttle(COLLABORATOR_EMAIL_CHECK_THROTTLE)
  @Post(':id/collaborators/check-email')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Check an email before adding a collaborator',
    description: 'Step 1 of the add-collaborator flow: reports whether the typed email belongs to the owner, an existing collaborator, or a known/unknown UMU account, before the modal asks for role/scope. Rate-limited separately — this is an email-enumeration-sensitive endpoint.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'The email address to check before showing the add-collaborator form' },
      },
      required: ['email'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Status of the email: is-owner, already-collaborator, known-user, or unknown-user (plus first name where applicable).',
    schema: { type: 'object', properties: { status: { type: 'string' } } },
  })
  @ApiResponse({ status: 403, description: "Caller isn't this passport's owner." })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async checkCollaboratorEmail(
    @Param('id') passportId: string,
    @Body('email') email: string,
    @Request() req: any,
  ) {
    return this.passportService.checkCollaboratorEmail(passportId, req.user.id, email);
  }

  // Step 2b: the typed email has no account yet - invite them to join
  // Umovingu; they're added as a collaborator automatically once they sign up.
  @Post(':id/collaborators/invite')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Invite a non-user to join and collaborate',
    description: 'For an email with no UMU account yet: sends a join invite. The scope/permission supplied here is applied automatically as a PassportCollaborator once they sign up.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'The email address to invite - this person has no UMU account yet' },
        role: { type: 'string', description: "A free-text label for display only, e.g. 'Solicitor', 'Family member' - carries no access implications itself" },
        sectionKeys: { type: 'array', items: { type: 'string' }, description: 'Which passport sections this collaborator can see once they join. Empty/omitted means unrestricted (every section).' },
        taskKeys: {
          type: 'object',
          additionalProperties: { type: 'array', items: { type: 'string' } },
          description: 'Per-section task-level scope (keyed by section key), narrowing sectionKeys further to specific tasks. Omit for full access within each allowed section.',
        },
        historyAccess: { type: 'boolean', description: "Whether this collaborator can view the passport's activity/history log" },
        permission: { type: 'string', description: "Write level once added: 'view', 'view_add', or 'view_add_update_own'" },
        accessDuration: { type: 'string', nullable: true, description: "How long access lasts, e.g. '30d', '90d' - omit for indefinite" },
        expiresAt: { type: 'string', nullable: true, format: 'date-time', description: 'Explicit expiry timestamp, as an alternative to accessDuration' },
      },
      required: ['email'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Confirmation that the join-invite email was sent.',
    schema: { type: 'object', properties: { message: { type: 'string', example: 'Invitation sent' }, invite: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' } } } } },
  })
  @ApiResponse({ status: 403, description: "Caller isn't this passport's owner." })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async inviteCollaborator(
    @Param('id') passportId: string,
    @Body('email') email: string,
    @Body('role') role: string | undefined,
    @Body('sectionKeys') sectionKeys: string[] | undefined,
    @Body('taskKeys') taskKeys: Record<string, string[]> | undefined,
    @Body('historyAccess') historyAccess: boolean | undefined,
    @Body('permission') permission: string | undefined,
    @Body('accessDuration') accessDuration: string | undefined,
    @Body('expiresAt') expiresAt: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Request() req: any,
  ) {
    return this.passportService.inviteCollaborator(
      passportId,
      req.user.id,
      email,
      { role, sectionKeys, taskKeys, historyAccess, permission, accessDuration, expiresAt },
      origin,
    );
  }

  @Post(':id/collaborators')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Add an existing user as a collaborator',
    description: 'Adds a PassportCollaborator row for an email that already has a UMU account, with the given role, section/task scope and permission level (view / view+add / view+add+update-own).',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'The email address to add - this person already has a UMU account' },
        role: { type: 'string', description: "A free-text label for display only, e.g. 'Solicitor', 'Family member' - carries no access implications itself" },
        sectionKeys: { type: 'array', items: { type: 'string' }, description: 'Which passport sections this collaborator can see. Empty/omitted means unrestricted (every section).' },
        taskKeys: {
          type: 'object',
          additionalProperties: { type: 'array', items: { type: 'string' } },
          description: 'Per-section task-level scope (keyed by section key), narrowing sectionKeys further to specific tasks. Omit for full access within each allowed section.',
        },
        historyAccess: { type: 'boolean', description: "Whether this collaborator can view the passport's activity/history log" },
        permission: { type: 'string', description: "Write level: 'view', 'view_add', or 'view_add_update_own'" },
        accessDuration: { type: 'string', nullable: true, description: "How long access lasts, e.g. '30d', '90d' - omit for indefinite" },
        expiresAt: { type: 'string', nullable: true, format: 'date-time', description: 'Explicit expiry timestamp, as an alternative to accessDuration' },
      },
      required: ['email'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'The created collaborator record.',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Collaborator added successfully' },
        collaborator: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            userId: { type: 'string' },
            email: { type: 'string' },
            firstName: { type: 'string', nullable: true },
            lastName: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            role: { type: 'string', nullable: true },
            permission: { type: 'string', nullable: true },
            accessDuration: { type: 'string', nullable: true },
            expiresAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: "Caller isn't this passport's owner." })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async addCollaborator(
    @Param('id') passportId: string,
    @Body('email') email: string,
    @Body('role') role: string | undefined,
    @Body('sectionKeys') sectionKeys: string[] | undefined,
    @Body('taskKeys') taskKeys: Record<string, string[]> | undefined,
    @Body('historyAccess') historyAccess: boolean | undefined,
    @Body('permission') permission: string | undefined,
    @Body('accessDuration') accessDuration: string | undefined,
    @Body('expiresAt') expiresAt: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Request() req: any,
  ) {
    const userId = req.user.id;
    return this.passportService.addCollaborator(
      passportId,
      userId,
      email,
      { role, sectionKeys, taskKeys, historyAccess, permission, accessDuration, expiresAt },
      origin,
    );
  }

  @Patch(':id/collaborators/:collaboratorId')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Update a collaborator's scope or permission",
    description: 'Changes an existing collaborator\'s role, section/task scope, permission level, or access duration/expiry. Owner only.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiParam({ name: 'collaboratorId', description: 'PassportCollaborator row ID to update' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'A free-text display label - carries no access implications itself' },
        sectionKeys: { type: 'array', items: { type: 'string' }, description: 'Replaces the existing scope entirely. Empty/omitted means unrestricted (every section).' },
        taskKeys: {
          type: 'object',
          additionalProperties: { type: 'array', items: { type: 'string' } },
          description: 'Replaces the existing task-level scope entirely (keyed by section key).',
        },
        historyAccess: { type: 'boolean', description: "Whether this collaborator can view the passport's activity/history log" },
        permission: { type: 'string', description: "Write level: 'view', 'view_add', or 'view_add_update_own'" },
        accessDuration: { type: 'string', nullable: true, description: "How long access lasts, e.g. '30d', '90d' - omit for indefinite" },
        expiresAt: { type: 'string', nullable: true, format: 'date-time', description: 'Explicit expiry timestamp, as an alternative to accessDuration' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'The updated collaborator record.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        role: { type: 'string', nullable: true },
        sectionKeys: { type: 'array', items: { type: 'string' }, nullable: true, description: 'null/empty means unrestricted (every section)' },
        taskKeys: { type: 'object', nullable: true, additionalProperties: { type: 'array', items: { type: 'string' } } },
        historyAccess: { type: 'boolean' },
        permission: { type: 'string', example: 'view', description: 'view | view_add | view_add_update_own' },
        accessDuration: { type: 'string', nullable: true },
        expiresAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  @ApiResponse({ status: 403, description: "Caller isn't this passport's owner." })
  @ApiResponse({ status: 404, description: 'Passport or collaborator not found.' })
  async updateCollaboratorScope(
    @Param('id') passportId: string,
    @Param('collaboratorId') collaboratorId: string,
    @Body('role') role: string | undefined,
    @Body('sectionKeys') sectionKeys: string[] | undefined,
    @Body('taskKeys') taskKeys: Record<string, string[]> | undefined,
    @Body('historyAccess') historyAccess: boolean | undefined,
    @Body('permission') permission: string | undefined,
    @Body('accessDuration') accessDuration: string | undefined,
    @Body('expiresAt') expiresAt: string | undefined,
    @Request() req: any,
  ) {
    return this.passportService.updateCollaboratorScope(
      passportId,
      req.user.id,
      collaboratorId,
      { role, sectionKeys, taskKeys, historyAccess, permission, accessDuration, expiresAt },
    );
  }

  @Get(':id/collaborators')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'List this passport\'s collaborators',
    description: 'Returns every PassportCollaborator on this passport with their basic user info (name/email), scope and permission.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({ status: 200, description: 'Array of collaborators.', schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, userId: { type: 'string' }, email: { type: 'string' } } } } })
  @ApiResponse({ status: 403, description: "Caller isn't the owner or a scoped collaborator." })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async getCollaborators(@Param('id') passportId: string, @Request() req: any) {
    const userId = req.user.id;
    return this.passportService.getCollaborators(passportId, userId);
  }

  @Post(':id/collaborators/:collaboratorId/remove')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Remove a collaborator',
    description: 'Deletes the PassportCollaborator row outright (not a soft flag) — the removed user loses access on their very next request, since access is re-checked live on every call. Owner only.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiParam({ name: 'collaboratorId', description: 'PassportCollaborator row ID to remove' })
  @ApiResponse({ status: 201, description: 'Confirmation of removal.', schema: { type: 'object', properties: { message: { type: 'string', example: 'Collaborator removed successfully' } } } })
  @ApiResponse({ status: 403, description: "Caller isn't this passport's owner." })
  @ApiResponse({ status: 404, description: 'Passport or collaborator not found.' })
  async removeCollaborator(
    @Param('id') passportId: string,
    @Param('collaboratorId') collaboratorId: string,
    @Request() req: any,
  ) {
    const userId = req.user.id;
    return this.passportService.removeCollaborator(
      passportId,
      userId,
      collaboratorId,
    );
  }

  @Post(':id/buyer-unlock')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Unlock a published passport as a buyer',
    description: 'Grants the caller BuyerPassportAccess to a PUBLISHED passport, after verifying a successful payment and passed KYC. The owner gets pass-through access with no payment check.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID to unlock' })
  @ApiResponse({ status: 201, description: 'Confirmation of access.', schema: { type: 'object', properties: { passportId: { type: 'string' } } } })
  @ApiResponse({ status: 403, description: 'No successful payment on file, the passport is not yet PUBLISHED, or (for a non-owner) KYC has not been verified - checked in that order.' })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async buyerUnlock(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.createBuyerAccess(passportId, req.user.id);
  }

  // Owner/collaborator shares the passport with a specific buyer —
  // opens (or reuses) a conversation between them and posts a
  // share_passport card. Does NOT grant BuyerPassportAccess; the buyer
  // still has to pay via /buyer-unlock. See sharePassportWithBuyer.
  @Post(':id/share-with-buyer')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Nudge a specific buyer toward this passport',
    description: 'Opens (or reuses) a conversation with the given buyer and posts a share-passport message card. Does NOT grant access — the buyer still has to pay via buyer-unlock.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({
    status: 201,
    description: 'The conversation this nudge was posted into, and whether the buyer already has paid access.',
    schema: { type: 'object', properties: { conversationId: { type: 'string' }, hasAccess: { type: 'boolean' } } },
  })
  @ApiResponse({ status: 403, description: "Caller isn't the owner or a scoped collaborator." })
  @ApiResponse({ status: 404, description: 'Passport or target buyer not found.' })
  async sharePassportWithBuyer(
    @Param('id') passportId: string,
    @Body() body: SharePassportWithBuyerDto,
    @Request() req: any,
  ) {
    return this.passportService.sharePassportWithBuyer(
      passportId,
      req.user.id,
      body.buyerUserId,
      body.note,
    );
  }

  @Get(':id/buyer-view')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get the passport as a buyer would see it',
    description: 'Returns the passport with property, owner summary, and sections/questions/answers filtered to what this buyer is entitled to see (requires published + unlocked, or owner/collaborator).',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({
    status: 200,
    description: 'Buyer-facing passport view: PRIVATE (Vault) sections and leasehold-irrelevant sections are filtered out, and answer files are limited to what this viewer is entitled to see.',
    schema: {
      type: 'object',
      properties: {
        passport: { type: 'object', properties: { id: { type: 'string' }, addressLine1: { type: 'string' }, postcode: { type: 'string' }, ownerName: { type: 'string' }, isOwner: { type: 'boolean', description: 'True if the caller is actually this passport\'s own owner, viewing their own buyer-facing page' } } },
        property: { type: 'object', description: 'The linked Property row, plus a derived isLeasehold flag - representative fields shown, not exhaustive', properties: {
          id: { type: 'string' }, addressLine1: { type: 'string' }, postcode: { type: 'string' }, propertyType: { type: 'string', nullable: true },
          bedrooms: { type: 'number', nullable: true }, bathrooms: { type: 'number', nullable: true }, sqft: { type: 'number', nullable: true },
          tenure: { type: 'string', nullable: true }, epcRating: { type: 'string', nullable: true }, isLeasehold: { type: 'boolean' },
        } },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              key: { type: 'string' },
              title: { type: 'string' },
              subtitle: { type: 'string', nullable: true },
              description: { type: 'string', nullable: true },
              order: { type: 'number' },
              helpContent: { type: 'string', nullable: true },
              helpVideoUrl: { type: 'string', nullable: true },
              tasks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    key: { type: 'string' },
                    title: { type: 'string' },
                    questions: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          type: { type: 'string' },
                          question: { type: 'string' },
                          answer: { type: 'object', nullable: true, properties: { answerText: { type: 'string', nullable: true }, answerJson: { type: 'object', nullable: true, description: 'Free-form JSON, shape depends on the question type - not enumerated' }, fileUrl: { type: 'string', nullable: true }, createdAt: { type: 'string', format: 'date-time' } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Not published and unlocked by this buyer, and not the owner/a scoped collaborator.' })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async getBuyerView(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.getBuyerView(passportId, req.user.id);
  }

  @Get(':id/readiness')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get publish-readiness for a seller passport',
    description: 'Computes whether every question marked as a hard or currently-triggered publication blocker has been answered, plus the milestone percentage and a tappable checklist of what remains.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({
    status: 200,
    description: 'Readiness result.',
    schema: { type: 'object', properties: {
      canPublish: { type: 'boolean', description: 'True once every applicable blocker is satisfied' },
      milestonePct: { type: 'number', description: 'Highest tier (20/40/60/80/100) fully satisfied' },
      readinessPct: { type: 'number', description: '% of currently-applicable blockers satisfied - drives the UI progress bar' },
      requiredTotal: { type: 'number' },
      requiredDone: { type: 'number' },
      missingBlockers: { type: 'array', description: 'One row per unanswered blocker', items: { type: 'object', properties: {
        section: { type: 'string' }, question: { type: 'string' }, questionId: { type: 'string', nullable: true, description: 'null for the two system checks (title number, EPC rating)' }, milestone: { type: 'number' },
      } } },
      checklist: { type: 'array', description: 'Every required item (satisfied and outstanding), one row per question, in passport order', items: { type: 'object', properties: {
        section: { type: 'string' }, sectionId: { type: 'string', nullable: true }, task: { type: 'string' }, taskId: { type: 'string', nullable: true },
        question: { type: 'string' }, questionId: { type: 'string', nullable: true }, milestone: { type: 'number' }, satisfied: { type: 'boolean' },
      } } },
      systemChecks: { type: 'array', items: { type: 'object', properties: {
        key: { type: 'string', enum: ['titleNumber', 'epcRating'] }, label: { type: 'string' }, satisfied: { type: 'boolean' }, blocksPublication: { type: 'boolean' },
      } } },
      requiredQuestionIds: { type: 'array', items: { type: 'string' }, description: 'Every question carrying at least one hard publication-blocker, for badging the question UI' },
    } },
  })
  @ApiResponse({ status: 403, description: "Caller isn't the owner or a scoped collaborator." })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async getReadiness(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.getReadiness(passportId, req.user.id);
  }

  @Put(':id/publish')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Publish the passport',
    description: 'Marks the passport PUBLISHED, making eligible sections/documents visible to buyers. Fails if publish-readiness has unmet blockers.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({ status: 200, description: 'The passport id and its new status (idempotent if already published).', schema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', example: 'PUBLISHED' } } } })
  @ApiResponse({ status: 403, description: 'Caller is not the owner, not yet activated, or publish-readiness still has unmet required disclosures (response includes the readiness detail).' })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async publishPassport(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.publishPassport(passportId, req.user.id);
  }

  @Put(':id/unpublish')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Unpublish the passport',
    description: 'Returns a published passport to a non-public state. Owner only.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({ status: 200, description: 'The passport id and its new status.', schema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', example: 'IN_PROGRESS' } } } })
  @ApiResponse({ status: 403, description: "Caller isn't this passport's owner." })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async unpublishPassport(
    @Param('id') passportId: string,
    @Request() req: any,
  ) {
    return this.passportService.unpublishPassport(passportId, req.user.id);
  }

  // Content-projection visibility ("Manage visibility") — a standalone
  // Private/Public switch, independent of publish/unpublish above. See the
  // service methods' comment for why apps with no buyer-marketplace concept
  // (umu-website-integration) need this separately.
  @Get(':id/visibility')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get the standalone public-visibility flag',
    description: 'A separate Private/Public switch from publish/unpublish, used by frontends with no buyer-marketplace concept.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({ status: 200, description: 'Current visibility flag.', schema: { type: 'object', properties: { id: { type: 'string' }, publicVisibility: { type: 'boolean' }, publicVisibilitySetAt: { type: 'string', format: 'date-time', nullable: true } } } })
  @ApiResponse({ status: 403, description: "Caller isn't the owner or a scoped collaborator." })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async getPublicVisibility(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.getPublicVisibility(passportId, req.user.id);
  }

  @Patch(':id/visibility')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Set the standalone public-visibility flag',
    description: 'Owner-only toggle of the separate Private/Public visibility flag (distinct from publish/unpublish).',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        isPublic: { type: 'boolean' },
      },
      required: ['isPublic'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'The updated visibility flag (idempotent no-op if already in the requested state).',
    schema: { type: 'object', properties: { id: { type: 'string' }, publicVisibility: { type: 'boolean' }, publicVisibilitySetAt: { type: 'string', format: 'date-time', nullable: true } } },
  })
  @ApiResponse({ status: 403, description: "Caller isn't this passport's owner." })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async setPublicVisibility(
    @Param('id') passportId: string,
    @Body('isPublic') isPublic: boolean,
    @Request() req: any,
  ) {
    return this.passportService.setPublicVisibility(passportId, req.user.id, !!isPublic);
  }

  // Timeline / activity ledger — feeds the (soon to be retired) Timeline
  // tab's sale-stage tracker. Left untouched so the three live frontends
  // keep working during the History rollout — see getHistory() below for
  // the replacement.
  @Get(':id/timeline')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get the sale-stage timeline (legacy)',
    description: 'Feeds the Timeline tab\'s sale-stage tracker. Being replaced by getHistory below, kept live for now so existing frontends keep working.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({ status: 200, description: 'The stage tracker plus the activity ledger it is computed from.', schema: { type: 'object', properties: {
    stages: { type: 'array', items: { type: 'string' }, example: ['Issued', 'Matched', 'Published', 'Offer', 'Exchange', 'Complete'] },
    stageIdx: { type: 'number', description: 'Index into stages - the furthest stage reached so far' },
    events: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, type: { type: 'string' }, title: { type: 'string' }, actor: { type: 'string' }, icon: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' },
    } } },
  } } })
  @ApiResponse({ status: 403, description: "Caller isn't the owner or a scoped collaborator." })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async getTimeline(
    @Param('id') passportId: string,
    @Request() req: any,
  ) {
    return this.passportService.getPassportTimeline(passportId, req.user.id);
  }

  // History — replaces the Timeline tab per the client handoff
  // (2026-09-25): paginated, filterable, permission-scoped event feed.
  // `category`: all | information | documents | actions | access.
  @Get(':id/history')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get the paginated, filterable activity history',
    description: 'Replaces the Timeline tab: a permission-scoped, cursor-paginated feed of PassportEvent rows, filterable by category/section/date range.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiQuery({ name: 'cursor', required: false, description: 'Pagination cursor from a previous page' })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size' })
  @ApiQuery({ name: 'category', required: false, description: "One of: all | information | documents | actions | access" })
  @ApiQuery({ name: 'sectionId', required: false, description: 'Filter to one section' })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'ISO date lower bound' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'ISO date upper bound' })
  @ApiResponse({
    status: 200,
    description: 'A page of history events (safe-summary shape - no before/after detail, see the event-detail endpoint for that) plus a cursor for the next page.',
    schema: {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              eventType: { type: 'string' },
              category: { type: 'string', example: 'documents', description: 'all | information | documents | actions | access' },
              actorType: { type: 'string' },
              actorId: { type: 'string', nullable: true },
              entityType: { type: 'string' },
              entityId: { type: 'string', nullable: true },
              sectionId: { type: 'string', nullable: true },
              sourceType: { type: 'string' },
              occurredAt: { type: 'string', format: 'date-time' },
              ruleId: { type: 'string', nullable: true },
              correlationId: { type: 'string', nullable: true },
            },
          },
        },
        nextCursor: { type: 'string', nullable: true },
      },
    },
  })
  @ApiResponse({ status: 403, description: "Caller isn't the owner or a scoped collaborator." })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async getHistory(
    @Param('id') passportId: string,
    @Request() req: any,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('category') category?: string,
    @Query('sectionId') sectionId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.events.getHistory(passportId, req.user.id, {
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
      category: (category as any) ?? 'all',
      sectionId,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
    });
  }

  @Get(':id/history/:eventId')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get one history event\'s full detail',
    description: 'Returns the full before/after detail of a single PassportEvent row from the history feed.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiParam({ name: 'eventId', description: 'PassportEvent ID' })
  @ApiResponse({
    status: 200,
    description: 'The full event detail, re-checking permissions independently of the list endpoint.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        eventType: { type: 'string' },
        category: { type: 'string' },
        actorType: { type: 'string' },
        actorId: { type: 'string', nullable: true },
        actingOnBehalfOf: { type: 'string', nullable: true },
        entityType: { type: 'string' },
        entityId: { type: 'string', nullable: true },
        sectionId: { type: 'string', nullable: true },
        sourceType: { type: 'string' },
        occurredAt: { type: 'string', format: 'date-time' },
        recordedAt: { type: 'string', format: 'date-time' },
        visibilityClass: { type: 'string' },
        beforeRef: { type: 'object', nullable: true, description: 'Free-form JSON snapshot of the relevant state before the change - shape depends on eventType (e.g. {fileUrl, fileName} for a document replace, {addressLine1, postcode, status} for a claim), not enumerated' },
        afterRef: { type: 'object', nullable: true, description: 'Free-form JSON snapshot after the change, same eventType-dependent shape as beforeRef' },
        ruleId: { type: 'string', nullable: true },
        ruleVersion: { type: 'number', nullable: true },
        metadata: { type: 'object', nullable: true, description: 'Free-form JSON, additional eventType-specific context - not enumerated' },
        linkedAction: { type: 'object', nullable: true, description: 'The PassportAction this event correlates to, if any', properties: {
          id: { type: 'string' }, ruleId: { type: 'string' }, ruleVersion: { type: 'number' }, subjectEntityId: { type: 'string' },
          status: { type: 'string', enum: ['OPEN', 'ADDRESSED', 'REOPENED', 'SUPERSEDED'] }, title: { type: 'string' }, explanation: { type: 'string' },
          suggestedSteps: { type: 'object', nullable: true, description: 'Free-form JSON' }, severity: { type: 'string', nullable: true },
          linkedQuestionId: { type: 'string', nullable: true },
        } },
      },
    },
  })
  @ApiResponse({ status: 403, description: "Caller isn't the owner or a scoped collaborator." })
  @ApiResponse({ status: 404, description: 'Passport or event not found.' })
  async getHistoryEventDetail(
    @Param('id') passportId: string,
    @Param('eventId') eventId: string,
    @Request() req: any,
  ) {
    return this.events.getEventDetail(passportId, eventId, req.user.id);
  }

  // Actions — the "Needs your attention" list, generated by the rule
  // engine (see PassportActionsService). Owner/collaborator can list;
  // only the owner can mark addressed/reopen.
  @Get(':id/actions')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'List "needs your attention" actions',
    description: 'Rule-engine-generated list of outstanding items for this passport. Owner and collaborators can list; only the owner can mark items addressed/reopen (see below).',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({
    status: 200,
    description: 'Array of actions, most recent first.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          passportId: { type: 'string' },
          ruleId: { type: 'string' },
          subjectEntityId: { type: 'string' },
          status: { type: 'string', example: 'OPEN', description: 'OPEN | ADDRESSED | REOPENED | SUPERSEDED' },
          title: { type: 'string' },
          explanation: { type: 'string' },
          suggestedSteps: { type: 'array', items: { type: 'string' }, nullable: true },
          severity: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: "Caller isn't the owner or a scoped collaborator." })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async listActions(@Param('id') passportId: string, @Request() req: any) {
    return this.actionsService.listActions(passportId, req.user.id);
  }

  @Patch(':id/actions/:actionId/addressed')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Mark an action addressed', description: 'Owner-only: marks one "needs your attention" item as resolved.' })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiParam({ name: 'actionId', description: 'Action ID' })
  @ApiResponse({
    status: 200,
    description: 'The updated action, status set to ADDRESSED.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        passportId: { type: 'string' },
        status: { type: 'string', example: 'ADDRESSED' },
        title: { type: 'string' },
        explanation: { type: 'string' },
        addressedAt: { type: 'string', format: 'date-time', nullable: true },
        addressedBy: { type: 'string', nullable: true },
      },
    },
  })
  @ApiResponse({ status: 403, description: "Caller isn't this passport's owner." })
  @ApiResponse({ status: 404, description: 'Passport or action not found.' })
  async markActionAddressed(
    @Param('id') passportId: string,
    @Param('actionId') actionId: string,
    @Request() req: any,
  ) {
    return this.actionsService.markAddressed(passportId, actionId, req.user.id);
  }

  @Patch(':id/actions/:actionId/reopen')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Reopen an action', description: 'Owner-only: reopens a previously addressed action item.' })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiParam({ name: 'actionId', description: 'Action ID' })
  @ApiResponse({
    status: 200,
    description: 'The updated action, status set to REOPENED.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        passportId: { type: 'string' },
        status: { type: 'string', example: 'REOPENED' },
        title: { type: 'string' },
        explanation: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 403, description: "Caller isn't this passport's owner." })
  @ApiResponse({ status: 404, description: 'Passport or action not found.' })
  async reopenAction(
    @Param('id') passportId: string,
    @Param('actionId') actionId: string,
    @Request() req: any,
  ) {
    return this.actionsService.reopen(passportId, actionId, req.user.id);
  }

  // Vault — read sections with their visibility (PUBLIC | PRIVATE).
  @Get(':id/vault')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Get the passport's sections with their visibility",
    description: 'Returns each section with its PUBLIC/PRIVATE visibility flag, scoped to a restricted collaborator\'s allowed sections where applicable.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({ status: 200, description: 'Sections with visibility.', schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, key: { type: 'string' }, title: { type: 'string' }, status: { type: 'string' }, visibility: { type: 'string' } } } } })
  @ApiResponse({ status: 403, description: "Caller isn't the owner or a scoped collaborator." })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async getVault(
    @Param('id') passportId: string,
    @Request() req: any,
  ) {
    return this.passportService.getPassportVault(passportId, req.user.id);
  }

  // Toggle a section's visibility (drives whether it's included when the
  // Passport is published).
  @Patch('section/:sectionId/visibility')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Toggle a section's visibility",
    description: 'Sets a single section to PUBLIC or PRIVATE — determines whether it\'s included when the passport is published.',
  })
  @ApiParam({ name: 'sectionId', description: 'PassportSection ID' })
  @ApiResponse({
    status: 200,
    description: 'The updated section.',
    schema: { type: 'object', properties: { id: { type: 'string' }, key: { type: 'string' }, title: { type: 'string' }, visibility: { type: 'string', example: 'PUBLIC', description: 'PUBLIC | PRIVATE' } } },
  })
  @ApiResponse({ status: 403, description: "Caller isn't this passport's owner." })
  @ApiResponse({ status: 404, description: 'Section not found.' })
  async setSectionVisibility(
    @Param('sectionId') sectionId: string,
    @Request() req: any,
    @Body() body: SetSectionVisibilityDto,
  ) {
    return this.passportService.setSectionVisibility(
      sectionId,
      req.user.id,
      body.visibility,
    );
  }

  @Delete(':id')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Delete a passport', description: 'Owner-only, permanent deletion of the passport and its content.' })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({ status: 200, description: 'Confirmation of deletion.', schema: { type: 'object', properties: { message: { type: 'string', example: 'Passport deleted successfully' } } } })
  @ApiResponse({ status: 403, description: "Caller isn't this passport's owner." })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async deletePassport(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.deletePassport(passportId, req.user.id);
  }

  // ── Resume tracking ──────────────────────────────────────────
  // Frontend pings this whenever the user opens or answers a task, so we
  // know where to drop them on next visit.
  @Put(':id/last-visited')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Record the last task visited',
    description: 'Pinged by the frontend whenever the user opens or answers a task, so getResumeTarget below knows where to drop them next time.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({ status: 200, description: 'Confirmation.', schema: { type: 'object', properties: { ok: { type: 'boolean', example: true } } } })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async setLastVisited(
    @Param('id') passportId: string,
    @Body() body: SetLastVisitedDto,
    @Request() req: any,
  ) {
    return this.passportService.setLastVisited(
      passportId,
      req.user.id,
      body?.taskId,
    );
  }

  // Resolves to the smartest "pick up where you left off" target. Returns
  // null when nothing remains incomplete.
  @Get(':id/resume')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get the "pick up where you left off" target',
    description: 'Resolves the smartest next task to resume into, based on the last-visited task and overall completion state. Returns a null target when nothing remains incomplete.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({ status: 200, description: 'The resume target, or null.', schema: { type: 'object', properties: { target: { type: 'object', nullable: true, properties: {
    sectionId: { type: 'string' }, taskId: { type: 'string' },
    reason: { type: 'string', enum: ['last-visited', 'next-in-section', 'next-section', 'first-task'] },
  } } } } })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async getResumeTarget(
    @Param('id') passportId: string,
    @Request() req: any,
  ) {
    return this.passportService.getResumeTarget(passportId, req.user.id);
  }

  @Post(':id/upload-image')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a property image',
    description: 'Uploads one image file to this passport\'s property-images bucket and returns its URL. Requires owner/collaborator access.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'The uploaded image\'s URL and file metadata.',
    schema: { type: 'object', properties: { url: { type: 'string' }, name: { type: 'string' }, mimeType: { type: 'string' }, size: { type: 'number' } } },
  })
  @ApiResponse({ status: 403, description: "Caller isn't the owner or a scoped collaborator (\"Access denied\")." })
  @UseInterceptors(
    FileInterceptor(
      'file',
      createUploadStorage({
        bucket: 'property-images',
        maxMb: 20,
        // Not mimePrefix: ['image/'] any more - that also matched
        // image/svg+xml (security review 2026-09-22, finding H1).
        mimeAllowList: IMAGE_MIME_TYPES,
      }),
    ),
  )
  async uploadPropertyImage(
    @Param('id') passportId: string,
    @UploadedFile() file: any,
    @Request() req: any,
  ) {
    const hasAccess = await this.passportService.checkUserAccess(
      passportId,
      req.user.id,
    );
    if (!hasAccess) throw new ForbiddenException('Access denied');
    const relativeOrAbsolute = publicUrlFor('property-images', storedFilename(file));
    // S3 mode returns an absolute URL; disk mode returns a relative
    // path which we resolve against the incoming request so URLs work
    // on whatever host the app is actually being served from.
    const url = absoluteUploadUrl(req, relativeOrAbsolute);
    return {
      url,
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };
  }

  @Get(':id/property-images')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List this passport\'s property images', description: 'Returns the ordered list of property image URLs attached to this passport.' })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({ status: 200, description: 'Array of image URLs.', schema: { type: 'object', properties: { images: { type: 'array', items: { type: 'string' } } } } })
  @ApiResponse({ status: 403, description: "Caller isn't the owner or a scoped collaborator." })
  @ApiResponse({ status: 404, description: 'Passport not found.' })
  async getPropertyImages(
    @Param('id') passportId: string,
    @Request() req: any,
  ) {
    return this.passportService.getPropertyImages(passportId, req.user.id);
  }

  @Put(':id/property-images')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Replace the property image list/order', description: 'Replaces the full ordered list of property image URLs for this passport (e.g. after reordering or removing one in the gallery editor).' })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        images: { type: 'array', items: { type: 'string' } },
      },
      required: ['images'],
    },
  })
  @ApiResponse({ status: 200, description: 'The updated image list.', schema: { type: 'object', properties: { images: { type: 'array', items: { type: 'string' } } } } })
  async updatePropertyImages(
    @Param('id') passportId: string,
    @Body('images') images: string[],
    @Request() req: any,
  ) {
    return this.passportService.updatePropertyImages(
      passportId,
      req.user.id,
      images,
    );
  }

  // ── Comparables ─────────────────────────────────────────────────────────

  @Get(':id/comparables')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get nearby comparable sold prices',
    description: 'Returns up to 6 recent Land Registry price-paid transactions in the same postcode sector, for owner, collaborator, or an unlocked buyer.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({ status: 200, description: 'Array of comparable transactions.', schema: { type: 'array', items: { type: 'object', properties: { price: { type: 'number' }, transactionDate: { type: 'string', format: 'date-time' }, postcode: { type: 'string' }, propertyType: { type: 'string' } } } } })
  async getComparables(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.getComparables(passportId, req.user.id);
  }

  // ── Share Link ───────────────────────────────────────────────────────────

  @Post(':id/share')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create a time-limited shared link',
    description: 'Generates a token-based share link (buyer or tenant scope) covering the given document IDs, expiring after a fixed window — usable by someone with no UMU account.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['buyer', 'tenant'] },
        documentIds: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'The created share link.', schema: { type: 'object', properties: { token: { type: 'string' }, url: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' } } } })
  async createShareLink(
    @Param('id') passportId: string,
    // `| undefined` dropped: TS's emitDecoratorMetadata erases a union
    // type to generic Object, which is why this never showed a body in
    // Swagger despite CreateShareLinkDto being fully decorated — every
    // field in it is already @IsOptional(), and the handler only ever
    // reads `body?.x`, so an absent/empty body still behaves exactly
    // the same (ValidationPipe validates {} against an all-optional DTO
    // without complaint either way).
    @Body() body: CreateShareLinkDto,
    @Headers('origin') origin: string | undefined,
    @Request() req: any,
  ) {
    const scope = body?.scope === 'tenant' ? 'tenant' : 'buyer';
    return this.passportService.createShareLink(
      passportId,
      req.user.id,
      scope,
      body?.documentIds,
      origin,
    );
  }

  @Get('shared/:token')
  @ApiOperation({
    summary: 'Resolve a shared passport link (public)',
    description: 'No authentication required — resolves a share token to the passport\'s shared content. Expired tokens are deleted and rejected with 403.',
  })
  @ApiParam({ name: 'token', description: 'Share link token' })
  @ApiResponse({
    status: 200,
    description: 'The shared passport content, filtered to this link\'s scope (buyer/tenant), visible sections, and the document manifest snapshotted when the link was created.',
    schema: {
      type: 'object',
      properties: {
        passport: { type: 'object', properties: { id: { type: 'string' }, addressLine1: { type: 'string' }, postcode: { type: 'string' } } },
        property: { type: 'object', description: 'The linked Property row, plus a derived isLeasehold flag - representative fields shown, not exhaustive', properties: {
          id: { type: 'string' }, addressLine1: { type: 'string' }, postcode: { type: 'string' }, propertyType: { type: 'string', nullable: true },
          bedrooms: { type: 'number', nullable: true }, bathrooms: { type: 'number', nullable: true }, sqft: { type: 'number', nullable: true },
          tenure: { type: 'string', nullable: true }, epcRating: { type: 'string', nullable: true }, isLeasehold: { type: 'boolean' },
        } },
        expiresAt: { type: 'string', format: 'date-time' },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              key: { type: 'string' },
              title: { type: 'string' },
              tasks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    key: { type: 'string' },
                    title: { type: 'string' },
                    questions: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          type: { type: 'string' },
                          question: { type: 'string' },
                          answer: { type: 'object', nullable: true, properties: { answerText: { type: 'string', nullable: true }, fileUrl: { type: 'string', nullable: true } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Link has expired (and is deleted on this attempt).' })
  @ApiResponse({ status: 404, description: 'Unknown token.' })
  async getSharedPassport(@Param('token') token: string) {
    return this.passportService.getSharedPassport(token);
  }

  // ── AI Summary ───────────────────────────────────────────────────────────

  @Throttle(AI_SUMMARY_THROTTLE)
  @Post(':id/ai-summary/:sectionKey')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Generate an AI summary of a section',
    description: 'Calls the LLM (Groq) to summarise the answers in one section for a quick read. Rate-limited — each call is a paid model invocation.',
  })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiParam({ name: 'sectionKey', description: 'Section key to summarise' })
  @ApiResponse({ status: 201, description: 'The generated summary text.', schema: { type: 'object', properties: { summary: { type: 'string' } } } })
  async getSectionAiSummary(
    @Param('id') passportId: string,
    @Param('sectionKey') sectionKey: string,
    @Request() req: any,
  ) {
    return this.passportService.getSectionAiSummary(passportId, sectionKey, req.user.id);
  }

  // ── Buyer Notes ───────────────────────────────────────────────────────────

  @Post(':id/notes')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Add a private buyer note', description: 'Lets a buyer with access leave a private note against this passport (optionally scoped to a section) — visible only to that buyer.' })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        sectionKey: { type: 'string' },
      },
      required: ['text'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'The created note.',
    schema: { type: 'object', properties: { id: { type: 'string' }, passportId: { type: 'string' }, sectionKey: { type: 'string', nullable: true }, text: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } } },
  })
  async createBuyerNote(
    @Param('id') passportId: string,
    @Body('text') text: string,
    @Body('sectionKey') sectionKey: string | undefined,
    @Request() req: any,
  ) {
    return this.passportService.createBuyerNote(passportId, req.user.id, text, sectionKey);
  }

  @Get(':id/notes')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "List the caller's private notes", description: 'Returns this buyer\'s own private notes on this passport.' })
  @ApiParam({ name: 'id', description: 'Passport ID' })
  @ApiResponse({ status: 200, description: 'Array of notes.', schema: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, passportId: { type: 'string' }, sectionKey: { type: 'string', nullable: true }, text: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' },
  } } } })
  async getBuyerNotes(@Param('id') passportId: string, @Request() req: any) {
    return this.passportService.getBuyerNotes(passportId, req.user.id);
  }

  @Delete('notes/:noteId')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Delete a private note', description: 'Deletes one of the caller\'s own buyer notes.' })
  @ApiParam({ name: 'noteId', description: 'Note ID' })
  @ApiResponse({ status: 200, description: 'Confirmation of deletion.', schema: { type: 'object', properties: { deleted: { type: 'boolean', example: true } } } })
  async deleteBuyerNote(@Param('noteId') noteId: string, @Request() req: any) {
    return this.passportService.deleteBuyerNote(noteId, req.user.id);
  }
}
