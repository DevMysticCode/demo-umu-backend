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
import { FileInterceptor } from '@nestjs/platform-express';
import { createUploadStorage } from '../common/storage';
import { TrueValueService } from './truevalue.service';
import type { SaveValuationDto } from './truevalue.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller()
export class TrueValueController {
  constructor(private trueValueService: TrueValueService) {}

  private guardAdmin(secret: string | undefined) {
    const expected = process.env.ADMIN_SECRET;
    if (!expected || secret !== expected) {
      throw new ForbiddenException('Invalid or missing admin secret');
    }
  }

  // GET /property/:id/truevalue/work-types — public catalogue
  @Get('property/:id/truevalue/work-types')
  async getWorkTypes() {
    return this.trueValueService.getWorkTypes();
  }

  // POST /property/:id/truevalue/preview — no guard. body: { works: [{workTypeCode, verificationState?}], epcStatus }
  // Stateless live estimate for the quiz's pre-sign-in steps — nothing is persisted.
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
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
  @Delete('truevalue/works/:workId')
  async removeWork(@Param('workId') workId: string, @Request() req: any) {
    return this.trueValueService.removeWork(workId, req.user.id);
  }

  // POST /truevalue/works/:workId/evidence — multipart 'file'
  @UseGuards(JwtAuthGuard)
  @Post('truevalue/works/:workId/evidence')
  @UseInterceptors(
    FileInterceptor('file', createUploadStorage({ bucket: 'truevalue-evidence', maxMb: 20 })),
  )
  async uploadEvidence(
    @Param('workId') workId: string,
    @Request() req: any,
    @UploadedFile() file: any,
  ) {
    return this.trueValueService.uploadEvidence(workId, req.user.id, file);
  }

  // POST /property/:id/truevalue — final save (persists a ValuationSnapshot)
  @UseGuards(JwtAuthGuard)
  @Post('property/:id/truevalue')
  async saveValuation(
    @Param('id') propertyId: string,
    @Request() req: any,
    @Body() dto: SaveValuationDto,
  ) {
    return this.trueValueService.saveValuation(propertyId, req.user.id, dto);
  }

  // GET /property/:id/truevalue — caller's own snapshot + works
  @UseGuards(JwtAuthGuard)
  @Get('property/:id/truevalue')
  async getValuation(@Param('id') propertyId: string, @Request() req: any) {
    return this.trueValueService.getValuation(propertyId, req.user.id);
  }

  // GET /property/:id/truevalue/public — no guard, canonical (owner) snapshot only
  @Get('property/:id/truevalue/public')
  async getPublicValuation(@Param('id') propertyId: string) {
    return this.trueValueService.getPublicValuation(propertyId);
  }

  // ── Admin review queue (x-admin-secret, same pattern as /buyer-profile/admin/*) ──

  @Get('truevalue/admin/review-queue')
  async listReviewQueue(@Headers('x-admin-secret') secret: string) {
    this.guardAdmin(secret);
    return this.trueValueService.listPendingWorkEvidence();
  }

  // POST /truevalue/admin/review/:workId  body: { decision: "approve"|"reject" }
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
