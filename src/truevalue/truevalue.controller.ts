import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Request,
  Headers,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ForbiddenException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiParam, ApiHeader } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { createUploadStorage, DOCUMENT_MIME_TYPES } from '../common/storage';
import { TrueValueService } from './truevalue.service';
import type { SaveValuationDto } from './truevalue.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { timingSafeStringEqual } from '../common/timing-safe-equal';
import { PreviewValuationDto } from './dto/preview-valuation.dto';
import { DeclareWorkDto } from './dto/declare-work.dto';
import { ReviewWorkEvidenceDto } from './dto/review-work-evidence.dto';

@Controller()
export class TrueValueController {
  constructor(private trueValueService: TrueValueService) {}

  private guardAdmin(secret: string | undefined) {
    const expected = process.env.ADMIN_SECRET;
    if (!expected || !timingSafeStringEqual(secret, expected)) {
      throw new ForbiddenException('Invalid or missing admin secret');
    }
  }

  // GET /property/:id/truevalue/work-types — public catalogue
  @ApiOperation({ summary: 'List TrueValue work types', description: 'Public catalogue of all active home-improvement work types the TrueValue quiz can present, cached in memory after the first call.' })
  @ApiResponse({ status: 200, description: 'Active work types, sorted for display.', schema: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, active: { type: 'boolean' }, sortOrder: { type: 'number' } } } } })
  @Get('property/:id/truevalue/work-types')
  async getWorkTypes() {
    return this.trueValueService.getWorkTypes();
  }

  // POST /property/:id/truevalue/preview — no guard. body: { works: [{workTypeCode, verificationState?}], epcStatus }
  // Stateless live estimate for the quiz's pre-sign-in steps — nothing is persisted.
  @ApiOperation({ summary: 'Live, unsaved valuation estimate', description: 'Stateless preview for the TrueValue quiz pre-sign-in steps — computes a live estimate from client-supplied work selections and EPC status without touching PropertyWork/ValuationSnapshot or requiring auth.' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiBody({ type: PreviewValuationDto })
  @ApiResponse({ status: 201, description: 'The computed live valuation estimate.', schema: { type: 'object', properties: {
    estimateLow: { type: 'number' }, estimateHigh: { type: 'number' }, estimatePoint: { type: 'number' }, confidence: { type: 'number' },
    provedCount: { type: 'number' }, scoringCount: { type: 'number' }, derisked: { type: 'number' }, recorded: { type: 'number' }, flagged: { type: 'number' },
    epcSuppressed: { type: 'boolean' }, hasWorks: { type: 'boolean' },
    contributions: { type: 'object', properties: {
      capital: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
      condition: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
      consent: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
      epc: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
    } },
    engineVersion: { type: 'string' }, inputsHash: { type: 'string' },
  } } })
  @Post('property/:id/truevalue/preview')
  async previewValuation(
    @Param('id') propertyId: string,
    @Body('works') works: any[],
    @Body('epcStatus') epcStatus: string,
  ) {
    return this.trueValueService.previewValuation(
      propertyId,
      Array.isArray(works) ? works : [],
      (epcStatus as any) || 'current',
    );
  }

  // POST /property/:id/truevalue/works  body: { workTypeCode, installDate? }
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Declare a completed work item', description: 'Records (upserts) that the signed-in user carried out a given work type on this property, optionally with an install date, feeding the TrueValue engine for this user/property pair.' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiBody({ type: DeclareWorkDto })
  @ApiResponse({ status: 201, description: 'Recomputed works list after the upsert (not just the single upserted row).', schema: { type: 'object', properties: {
    works: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, workTypeCode: { type: 'string' }, installDate: { type: 'string', format: 'date-time', nullable: true }, verificationState: { type: 'string' }, evidenceUrl: { type: 'string', nullable: true }, workType: { type: 'object', description: 'The WorkType catalogue row', properties: {
      code: { type: 'string' }, label: { type: 'string' }, category: { type: 'string' }, tier: { type: 'number' },
      upliftLow: { type: 'number', nullable: true }, upliftHigh: { type: 'number', nullable: true },
      isMinor: { type: 'boolean' }, epcAssessed: { type: 'boolean' }, docRequired: { type: 'string', nullable: true }, warningText: { type: 'string', nullable: true },
    } } } } },
    live: { type: 'object', description: 'Same ValuationResult shape as POST .../truevalue/preview (estimateLow/estimateHigh/estimatePoint/confidence/contributions/etc.)' },
    epcStatus: { type: 'string', nullable: true, enum: ['current', 'stale', 'none'] },
  } } })
  @Post('property/:id/truevalue/works')
  async declareWork(
    @Param('id') propertyId: string,
    @Request() req: any,
    @Body('workTypeCode') workTypeCode: string,
    @Body('installDate') installDate?: string,
  ) {
    return this.trueValueService.declareWork(propertyId, req.user.id, workTypeCode, installDate);
  }

  // DELETE /truevalue/works/:workId
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Remove a declared work item', description: "Deletes the caller's own declared work item (rejects if it belongs to someone else) and returns the recomputed live work list for that property." })
  @ApiParam({ name: 'workId', description: 'PropertyWork row ID' })
  @ApiResponse({ status: 200, description: 'Recomputed works list after removal - same shape as POST .../truevalue/works.', schema: { type: 'object', properties: {
    works: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, workTypeCode: { type: 'string' }, installDate: { type: 'string', format: 'date-time', nullable: true }, verificationState: { type: 'string' }, evidenceUrl: { type: 'string', nullable: true }, workType: { type: 'object', description: 'The WorkType catalogue row', properties: {
      code: { type: 'string' }, label: { type: 'string' }, category: { type: 'string' }, tier: { type: 'number' },
      upliftLow: { type: 'number', nullable: true }, upliftHigh: { type: 'number', nullable: true },
      isMinor: { type: 'boolean' }, epcAssessed: { type: 'boolean' }, docRequired: { type: 'string', nullable: true }, warningText: { type: 'string', nullable: true },
    } } } } },
    live: { type: 'object', description: 'Same ValuationResult shape as POST .../truevalue/preview (estimateLow/estimateHigh/estimatePoint/confidence/contributions/etc.)' },
    epcStatus: { type: 'string', nullable: true, enum: ['current', 'stale', 'none'] },
  } } })
  @Delete('truevalue/works/:workId')
  async removeWork(@Param('workId') workId: string, @Request() req: any) {
    return this.trueValueService.removeWork(workId, req.user.id);
  }

  // POST /truevalue/works/:workId/evidence — multipart 'file'
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Post('truevalue/works/:workId/evidence')
  @UseInterceptors(
    FileInterceptor('file', createUploadStorage({ bucket: 'truevalue-evidence', maxMb: 20, mimeAllowList: DOCUMENT_MIME_TYPES })),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Upload evidence for a declared work item', description: "Uploads a supporting file for the caller's own declared work and sets its verificationState to 'pending' for admin review; returns the recomputed live work list." })
  @ApiParam({ name: 'workId', description: 'PropertyWork row ID' })
  @ApiResponse({ status: 201, description: 'Recomputed works list including the pending evidence - same shape as POST .../truevalue/works.', schema: { type: 'object', properties: {
    works: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, workTypeCode: { type: 'string' }, installDate: { type: 'string', format: 'date-time', nullable: true }, verificationState: { type: 'string' }, evidenceUrl: { type: 'string', nullable: true }, workType: { type: 'object', description: 'The WorkType catalogue row', properties: {
      code: { type: 'string' }, label: { type: 'string' }, category: { type: 'string' }, tier: { type: 'number' },
      upliftLow: { type: 'number', nullable: true }, upliftHigh: { type: 'number', nullable: true },
      isMinor: { type: 'boolean' }, epcAssessed: { type: 'boolean' }, docRequired: { type: 'string', nullable: true }, warningText: { type: 'string', nullable: true },
    } } } } },
    live: { type: 'object', description: 'Same ValuationResult shape as POST .../truevalue/preview (estimateLow/estimateHigh/estimatePoint/confidence/contributions/etc.)' },
    epcStatus: { type: 'string', nullable: true, enum: ['current', 'stale', 'none'] },
  } } })
  async uploadEvidence(
    @Param('workId') workId: string,
    @Request() req: any,
    @UploadedFile() file: any,
  ) {
    return this.trueValueService.uploadEvidence(workId, req.user.id, file);
  }

  // POST /property/:id/truevalue — final save (persists a ValuationSnapshot)
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Save a final TrueValue snapshot', description: "Recomputes the valuation from the caller's declared works and persists it as a ValuationSnapshot (upsert) for this property/user pair — the quiz's final 'finish' step." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiBody({ schema: { type: 'object', properties: { epcStatus: { type: 'string', nullable: true } } } })
  @ApiResponse({ status: 201, description: 'The persisted ValuationSnapshot row.', schema: { type: 'object', properties: {
    id: { type: 'string' }, propertyId: { type: 'string' }, userId: { type: 'string' }, baseline: { type: 'number' },
    estimateLow: { type: 'number' }, estimateHigh: { type: 'number' }, estimatePoint: { type: 'number' },
    provedCount: { type: 'number' }, scoringCount: { type: 'number' }, derisked: { type: 'number' }, recorded: { type: 'number' }, flagged: { type: 'number' },
    epcSuppressed: { type: 'boolean' },
    contributions: { type: 'object', properties: {
      capital: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
      condition: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
      consent: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
      epc: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
    } },
    engineVersion: { type: 'string' }, inputsHash: { type: 'string' },
    isHomeowner: { type: 'boolean', nullable: true }, isLandlord: { type: 'boolean', nullable: true }, purpose: { type: 'string', nullable: true }, foundNextHome: { type: 'boolean', nullable: true },
  } } })
  @Post('property/:id/truevalue')
  async saveValuation(
    @Param('id') propertyId: string,
    @Request() req: any,
    @Body() dto: SaveValuationDto,
  ) {
    return this.trueValueService.saveValuation(propertyId, req.user.id, dto);
  }

  // GET /property/:id/truevalue — caller's own snapshot + works
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get the caller's own TrueValue snapshot", description: "Returns the signed-in user's saved valuation snapshot for this property plus their full declared-works list (each with its work type), or a null snapshot if none has been saved yet." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'The snapshot and works list.', schema: { type: 'object', properties: {
    snapshot: { type: 'object', nullable: true, description: 'Same ValuationSnapshot shape as POST property/:id/truevalue, or null if none saved yet' },
    works: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, workTypeCode: { type: 'string' }, installDate: { type: 'string', format: 'date-time', nullable: true }, verificationState: { type: 'string' }, evidenceUrl: { type: 'string', nullable: true }, workType: { type: 'object', properties: {
      code: { type: 'string' }, label: { type: 'string' }, category: { type: 'string' }, tier: { type: 'number' },
    } } } } },
  } } })
  @Get('property/:id/truevalue')
  async getValuation(@Param('id') propertyId: string, @Request() req: any) {
    return this.trueValueService.getValuation(propertyId, req.user.id);
  }

  // GET /property/:id/truevalue/public — no guard, canonical (owner) snapshot only
  @ApiOperation({ summary: "Get the property's canonical public valuation", description: "No auth required. Returns the seller passport owner's saved valuation snapshot for this property (the canonical figure shown on the property page), or null if the owner hasn't saved one." })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'The owner valuation snapshot, or null - same shape as POST property/:id/truevalue\'s response.', schema: { type: 'object', nullable: true, properties: {
    id: { type: 'string' }, propertyId: { type: 'string' }, userId: { type: 'string' }, baseline: { type: 'number' },
    estimateLow: { type: 'number' }, estimateHigh: { type: 'number' }, estimatePoint: { type: 'number' },
  } } })
  @Get('property/:id/truevalue/public')
  async getPublicValuation(@Param('id') propertyId: string) {
    return this.trueValueService.getPublicValuation(propertyId);
  }

  // ── Admin review queue (x-admin-secret, same pattern as /buyer-profile/admin/*) ──

  @ApiOperation({ summary: 'List work-evidence items pending admin review', description: 'Admin-secret-gated. Returns every declared work item whose evidence is awaiting verification, along with resolved property and user details for display.' })
  @ApiResponse({ status: 200, description: 'Pending work-evidence rows.', schema: { type: 'array', items: { type: 'object', properties: {
    workId: { type: 'string' }, propertyId: { type: 'string' }, address: { type: 'string', nullable: true }, postcode: { type: 'string', nullable: true },
    workLabel: { type: 'string' }, evidenceUrl: { type: 'string', nullable: true },
    declaredBy: { type: 'object', nullable: true, properties: { id: { type: 'string' }, firstName: { type: 'string', nullable: true }, lastName: { type: 'string', nullable: true }, email: { type: 'string' } } },
    createdAt: { type: 'string', format: 'date-time' },
  } } } })
  @ApiHeader({ name: 'x-admin-secret', description: 'Shared admin secret required to access this endpoint.' })
  @Get('truevalue/admin/review-queue')
  async listReviewQueue(@Headers('x-admin-secret') secret: string) {
    this.guardAdmin(secret);
    return this.trueValueService.listPendingWorkEvidence();
  }

  // POST /truevalue/admin/review/:workId  body: { decision: "approve"|"reject" }
  @ApiOperation({ summary: 'Approve or reject declared work evidence', description: "Admin-secret-gated. Sets the work item's verificationState to verified or rejected, and recomputes the declarer's saved valuation snapshot immediately if one already exists." })
  @ApiParam({ name: 'workId', description: 'PropertyWork row ID' })
  @ApiBody({ type: ReviewWorkEvidenceDto })
  @ApiResponse({ status: 201, description: 'The updated PropertyWork record.', schema: { type: 'object', properties: {
    id: { type: 'string' }, propertyId: { type: 'string' }, userId: { type: 'string' }, workTypeCode: { type: 'string' },
    verificationState: { type: 'string', enum: ['self', 'pending', 'verified', 'rejected'] },
    evidenceUrl: { type: 'string', nullable: true }, installDate: { type: 'string', format: 'date-time', nullable: true },
  } } })
  @ApiHeader({ name: 'x-admin-secret', description: 'Shared admin secret required to access this endpoint.' })
  @Post('truevalue/admin/review/:workId')
  async reviewWorkEvidence(
    @Headers('x-admin-secret') secret: string,
    @Param('workId') workId: string,
    @Body('decision') decision: string,
  ) {
    this.guardAdmin(secret);
    return this.trueValueService.reviewWorkEvidence(workId, decision);
  }
}
