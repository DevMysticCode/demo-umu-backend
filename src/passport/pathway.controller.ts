import { Body, Controller, Get, Param, Post, Request, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiProperty } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { createUploadStorage, DOCUMENT_MIME_TYPES } from '../common/storage';
import { PathwayService } from './pathway.service';

class AdvanceJourneyDto {
  @ApiProperty()
  @IsString()
  stepId: string;

  @ApiProperty()
  @IsString()
  answerLabel: string;

  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceFileUrls?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

// Resolution-pathways endpoints (client handoff, 2026-09-29). Nested under
// /passport/:passportId/pathways since a journey only ever exists in the
// context of one passport - see PathwayService for the engine itself.
@Controller('passport/:passportId/pathways')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class PathwayController {
  constructor(private pathways: PathwayService) {}

  @Get()
  listJourneys(@Param('passportId') passportId: string, @Request() req: any) {
    return this.pathways.listJourneys(passportId, req.user.id);
  }

  @Get('flags')
  listFlags(@Param('passportId') passportId: string, @Request() req: any) {
    return this.pathways.listFlags(passportId, req.user.id);
  }

  @Get(':pathwayId/content')
  getPathwayContent(@Param('pathwayId') pathwayId: string) {
    return this.pathways.getPathway(pathwayId);
  }

  // Manual start - normally a journey opens automatically from
  // QuestionService.answerQuestion when a trigger answer is detected; this
  // lets the frontend also offer "see the guided steps" from a flag or a
  // question that's already been answered.
  @Post(':pathwayId/start')
  startJourney(
    @Param('passportId') passportId: string,
    @Param('pathwayId') pathwayId: string,
    @Request() req: any,
  ) {
    return this.pathways.startPathwayJourney(passportId, pathwayId, null, req.user.id);
  }

  @Get('journeys/:journeyId')
  getJourney(
    @Param('passportId') passportId: string,
    @Param('journeyId') journeyId: string,
    @Request() req: any,
  ) {
    return this.pathways.getJourney(passportId, journeyId, req.user.id);
  }

  @Post('journeys/:journeyId/answer')
  advanceJourney(
    @Param('passportId') passportId: string,
    @Param('journeyId') journeyId: string,
    @Body() dto: AdvanceJourneyDto,
    @Request() req: any,
  ) {
    return this.pathways.advanceJourney(
      passportId,
      journeyId,
      dto.stepId,
      dto.answerLabel,
      req.user.id,
      dto.evidenceFileUrls,
      dto.notes,
    );
  }

  @Post('evidence')
  @UseInterceptors(
    FileInterceptor('file', createUploadStorage({ bucket: 'pathway-evidence', maxMb: 20, mimeAllowList: DOCUMENT_MIME_TYPES })),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  uploadEvidence(
    @Param('passportId') passportId: string,
    @UploadedFile() file: any,
    @Request() req: any,
  ) {
    return this.pathways.uploadEvidence(passportId, req.user.id, file);
  }

  @Post('journeys/:journeyId/defer')
  deferJourney(
    @Param('passportId') passportId: string,
    @Param('journeyId') journeyId: string,
    @Request() req: any,
  ) {
    return this.pathways.deferJourney(passportId, journeyId, req.user.id);
  }
}
