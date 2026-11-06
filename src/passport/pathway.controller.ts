import { Body, Controller, Get, Param, Post, Request, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiProperty, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
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
@ApiParam({ name: 'passportId', description: 'The Passport these journeys belong to' })
@UseGuards(JwtAuthGuard)
export class PathwayController {
  constructor(private pathways: PathwayService) {}

  @ApiOperation({ summary: 'List every pathway journey on a passport', description: 'Returns every journey (in-progress and resolved), each annotated with a severity derived from its outcome status (null while still in progress).' })
  @ApiResponse({ status: 200, description: 'Journeys, most recently started first.', schema: { type: 'array', items: { type: 'object' } } })
  @Get()
  listJourneys(@Param('passportId') passportId: string, @Request() req: any) {
    return this.pathways.listJourneys(passportId, req.user.id);
  }

  @ApiOperation({ summary: 'List unresolved flags across all pathway journeys', description: 'Every journey whose outcome hasn\'t reached a fully-resolved tier (CHECK/FLAG/ESCALATE severity, or one of the fine-grained outcome codes) - in-progress journeys are excluded since they have no outcome yet. Sorted by severity, most recently updated first.' })
  @ApiResponse({ status: 200, description: 'Flagged journeys.', schema: { type: 'array', items: { type: 'object' } } })
  @Get('flags')
  listFlags(@Param('passportId') passportId: string, @Request() req: any) {
    return this.pathways.listFlags(passportId, req.user.id);
  }

  @ApiOperation({ summary: 'Get a pathway\'s static step content', description: 'Returns the resolution pathway\'s own definition (its steps, options, and branching) - not a specific journey\'s progress through it.' })
  @ApiParam({ name: 'pathwayId', description: 'The ResolutionPathway id (e.g. "P09")' })
  @ApiResponse({
    status: 200,
    description: 'The pathway definition.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'P09' },
        name: { type: 'string' },
        issue: { type: 'string' },
        whyItMatters: { type: 'string' },
        timeNow: { type: 'string' },
        timeAtSale: { type: 'string' },
        checkFirst: { type: 'string' },
        startStep: { type: 'string' },
        steps: {
          type: 'array',
          description: 'Step[]: {id, kind, title, body, time, cost, warning, options:[{label,next,requiresUpload}]}',
          items: { type: 'object' },
        },
        handover: {
          type: 'array',
          nullable: true,
          description: 'Option[]: {name, what, time, notes}',
          items: { type: 'object' },
        },
        stopPoint: { type: 'string', nullable: true },
        toValidate: { type: 'string', nullable: true },
        status: { type: 'string', example: 'live', description: 'draft | conveyancer_reviewed | live' },
        contentVersion: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Pathway not found.' })
  @Get(':pathwayId/content')
  getPathwayContent(@Param('pathwayId') pathwayId: string) {
    return this.pathways.getPathway(pathwayId);
  }

  // Manual start - normally a journey opens automatically from
  // QuestionService.answerQuestion when a trigger answer is detected; this
  // lets the frontend also offer "see the guided steps" from a flag or a
  // question that's already been answered.
  @ApiOperation({
    summary: 'Manually start a pathway journey',
    description: 'Normally a journey opens automatically when QuestionService.answerQuestion detects a trigger answer - this lets the frontend also offer "see the guided steps" from a flag or an already-answered question.',
  })
  @ApiParam({ name: 'pathwayId', description: 'The ResolutionPathway id to start' })
  @ApiResponse({
    status: 201,
    description: 'Journey created and started (or the already-in-progress journey for this pathway, if one exists).',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        passportId: { type: 'string' },
        pathwayId: { type: 'string' },
        triggerQuestionTemplateId: { type: 'string', nullable: true },
        contentVersion: { type: 'number' },
        currentStepId: { type: 'string' },
        stepAnswers: { type: 'array', items: { type: 'object' }, description: '[{stepId, answerLabel, evidenceFileUrls, notes, timestamp}]' },
        status: { type: 'string', example: 'IN_PROGRESS', description: 'IN_PROGRESS | RESOLVED | CHECK | FLAG | ESCALATE' },
        startedAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        completedAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  @Post(':pathwayId/start')
  startJourney(
    @Param('passportId') passportId: string,
    @Param('pathwayId') pathwayId: string,
    @Request() req: any,
  ) {
    return this.pathways.startPathwayJourney(passportId, pathwayId, null, req.user.id);
  }

  @ApiOperation({ summary: 'Get one journey\'s current progress', description: 'Returns the journey\'s state (current step, prior answers) plus the pathway content it\'s following.' })
  @ApiParam({ name: 'journeyId', description: 'The PathwayJourney id' })
  @ApiResponse({ status: 200, description: 'Journey and its pathway content.', schema: { type: 'object', properties: { journey: { type: 'object' }, pathway: { type: 'object' } } } })
  @ApiResponse({ status: 404, description: 'Journey not found on this passport.' })
  @Get('journeys/:journeyId')
  getJourney(
    @Param('passportId') passportId: string,
    @Param('journeyId') journeyId: string,
    @Request() req: any,
  ) {
    return this.pathways.getJourney(passportId, journeyId, req.user.id);
  }

  @ApiOperation({
    summary: 'Answer the current step of a journey and advance it',
    description:
      'Validates the answer against the step\'s defined options (rejecting one that requires uploaded evidence if none was supplied), then either moves to the next step, resolves the journey to a terminal outcome, or - for a cross-pathway link - resolves this journey and starts a new one. Editing an already-answered earlier step supersedes every step answered after it. Logs a PATHWAY_STEP_ANSWERED or PATHWAY_OUTCOME_REACHED audit event.',
  })
  @ApiParam({ name: 'journeyId', description: 'The PathwayJourney id' })
  @ApiResponse({
    status: 201,
    description: 'Journey advanced (or resolved to an outcome).',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        passportId: { type: 'string' },
        pathwayId: { type: 'string' },
        triggerQuestionTemplateId: { type: 'string', nullable: true },
        contentVersion: { type: 'number' },
        currentStepId: { type: 'string' },
        stepAnswers: { type: 'array', items: { type: 'object' }, description: '[{stepId, answerLabel, evidenceFileUrls, notes, timestamp}]' },
        status: { type: 'string', example: 'IN_PROGRESS', description: 'IN_PROGRESS | RESOLVED | CHECK | FLAG | ESCALATE' },
        startedAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        completedAt: { type: 'string', format: 'date-time', nullable: true },
        severity: { type: 'string', nullable: true, enum: ['ESCALATE', 'FLAG', 'CHECK', 'RESOLVED'], description: 'Set only when this call resolved the journey to a terminal outcome; null otherwise.' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid answer for this step, missing required evidence, or the step hasn\'t been reached yet.' })
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
  @ApiOperation({
    summary: 'Upload a piece of pathway-step evidence',
    description: 'Stores the file in the private pathway-evidence bucket and hands back its URL - the caller then includes that URL in the advanceJourney call for the step it\'s evidence for.',
  })
  @ApiResponse({ status: 201, description: 'File stored.', schema: { type: 'object', properties: { fileUrl: { type: 'string' }, fileName: { type: 'string' } } } })
  uploadEvidence(
    @Param('passportId') passportId: string,
    @UploadedFile() file: any,
    @Request() req: any,
  ) {
    return this.pathways.uploadEvidence(passportId, req.user.id, file);
  }

  @ApiOperation({
    summary: 'Defer a journey ("I\'ll do this later")',
    description: 'Saves current progress and sets the journey\'s status to CHECK, so it returns to the same step next time rather than losing progress. A no-op if the journey is already past the in-progress stage.',
  })
  @ApiParam({ name: 'journeyId', description: 'The PathwayJourney id' })
  @ApiResponse({
    status: 201,
    description: 'Journey deferred (status set to CHECK), or returned unchanged if it was not IN_PROGRESS.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        passportId: { type: 'string' },
        pathwayId: { type: 'string' },
        triggerQuestionTemplateId: { type: 'string', nullable: true },
        contentVersion: { type: 'number' },
        currentStepId: { type: 'string' },
        stepAnswers: { type: 'array', items: { type: 'object' } },
        status: { type: 'string', example: 'CHECK', description: 'IN_PROGRESS | RESOLVED | CHECK | FLAG | ESCALATE' },
        startedAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        completedAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  @Post('journeys/:journeyId/defer')
  deferJourney(
    @Param('passportId') passportId: string,
    @Param('journeyId') journeyId: string,
    @Request() req: any,
  ) {
    return this.pathways.deferJourney(passportId, journeyId, req.user.id);
  }
}
