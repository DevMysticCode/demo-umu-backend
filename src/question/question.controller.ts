import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  Ip,
  Headers,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { QuestionService } from './question.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { createUploadStorage, DOCUMENT_MIME_TYPES } from '../common/storage';
import { AnswerQuestionDto } from './dto/answer-question.dto';
import { SubmitTenantSignatureDto } from './dto/submit-tenant-signature.dto';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3002';

@Controller('questions')
export class QuestionController {
  constructor(private questionService: QuestionService) {}

  @ApiOperation({
    summary: 'Save the answer to a passport question',
    description:
      'Upserts the answer (text, structured JSON, or a URL treated as a file reference), marks the question completed, and awards any points attached to the question template. Enforces collaborator write-level permission: a view-only collaborator is rejected, and (unless their scope allows editing others\' entries) so is editing an answer someone else originally added.',
  })
  @ApiParam({ name: 'questionId', description: 'The PassportQuestion id being answered' })
  @ApiResponse({ status: 201, description: 'Answer saved.', schema: { type: 'object', properties: { success: { type: 'boolean' }, pointsAwarded: { type: 'number' } } } })
  @ApiResponse({ status: 403, description: 'No access to this question, or a collaborator permission level that does not allow this edit.' })
  @Post(':questionId/answer')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async answerQuestion(
    @Param('questionId') questionId: string,
    @Body() dto: AnswerQuestionDto,
    @Request() req: any,
  ) {
    const userId = req.user.id;
    return this.questionService.answerQuestion(questionId, userId, dto);
  }

  // Combined guidance + pathway-journey lookup, meant to be called right
  // after POST :questionId/answer with the same answer value, so the
  // question screen can show both the inline explanation and any guided
  // pathway that answer just opened in a single round trip.
  @ApiOperation({
    summary: 'Get inline guidance and any guided pathway for an answer',
    description:
      'Meant to be called right after POST :questionId/answer with the same answer value, so the question screen can show both the explanatory guidance text and any guided pathway that answer just opened, in one round trip.',
  })
  @ApiParam({ name: 'questionId', description: 'The PassportQuestion id' })
  @ApiQuery({ name: 'answer', required: false, description: 'The answer value just submitted, used to resolve conditional guidance/pathway content' })
  @ApiResponse({
    status: 200,
    description: 'Guidance text plus any triggered journey/pathway.',
    schema: { type: 'object', properties: { guidance: { type: 'object', nullable: true }, journey: { type: 'object', nullable: true }, pathway: { type: 'object', nullable: true } } },
  })
  @Get(':questionId/guidance')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async getGuidance(
    @Param('questionId') questionId: string,
    @Query('answer') answer: string,
    @Request() req: any,
  ) {
    return this.questionService.getGuidanceAndPathway(questionId, answer, req.user.id);
  }

  @Post(':questionId/upload')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor(
      'file',
      createUploadStorage({
        bucket: 'passport-docs',
        maxMb: 20,
        mimeAllowList: DOCUMENT_MIME_TYPES,
      }),
    ),
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
    summary: 'Upload a file as the answer to an UPLOAD-type question',
    description:
      'Stores the file in the private passport-docs bucket, upserts it as the question\'s single answer slot, marks the question completed, and writes a DOCUMENT_UPLOADED or DOCUMENT_REPLACED audit event (with a before/after snapshot) depending on whether a file was already attached.',
  })
  @ApiParam({ name: 'questionId', description: 'The PassportQuestion id this file answers' })
  @ApiResponse({
    status: 201,
    description: 'File stored and linked to the question.',
    schema: { type: 'object', properties: { url: { type: 'string' }, name: { type: 'string' }, mimeType: { type: 'string' }, size: { type: 'number' } } },
  })
  async uploadFile(
    @Param('questionId') questionId: string,
    @UploadedFile() file: any,
    @Request() req: any,
  ) {
    const userId = req.user.id;
    return this.questionService.uploadQuestionFile(questionId, userId, file);
  }

  // See QuestionService.uploadPartFile — for a file that belongs to one
  // part of a MULTIPART question, not a whole question's answer.
  @Post(':questionId/upload-part')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor(
      'file',
      createUploadStorage({
        bucket: 'passport-docs',
        maxMb: 20,
        mimeAllowList: DOCUMENT_MIME_TYPES,
      }),
    ),
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
    summary: 'Upload a file for one part of a MULTIPART question',
    description:
      'Unlike upload (above), this does not upsert the whole QuestionAnswer or force-complete the question - it only verifies access, stores the file, and returns its URL. The caller merges that URL into the specific part\'s own answer and saves the whole multipart answer through the normal answer flow.',
  })
  @ApiParam({ name: 'questionId', description: 'The MULTIPART PassportQuestion id' })
  @ApiResponse({
    status: 201,
    description: 'File stored; not yet linked to any answer.',
    schema: { type: 'object', properties: { url: { type: 'string' }, name: { type: 'string' }, mimeType: { type: 'string' }, size: { type: 'number' } } },
  })
  async uploadPartFile(
    @Param('questionId') questionId: string,
    @UploadedFile() file: any,
    @Request() req: any,
  ) {
    const userId = req.user.id;
    return this.questionService.uploadPartFile(questionId, userId, file);
  }

  // Multi-copy certificate retention (client feedback items 1a/3) — see
  // QuestionService.listQuestionCopies. Kept separate from
  // :questionId/upload (the single-slot answer flow every other section
  // still uses) rather than changing that endpoint's behaviour.
  @ApiOperation({
    summary: 'List multi-copy certificates attached to a question',
    description:
      'Returns every document tagged against this question (via the shared general-vault UserDocument store, not the single-slot QuestionAnswer.fileUrl) - used where a question can hold more than one certificate/copy, kept separate from the single-slot upload endpoint above.',
  })
  @ApiParam({ name: 'questionId', description: 'The PassportQuestion id' })
  @ApiQuery({ name: 'kind', required: false, description: 'Narrows to one sub-kind for a question that tracks more than one type of certificate' })
  @ApiResponse({ status: 200, description: 'Matching documents.', schema: { type: 'array', items: { type: 'object' } } })
  @Get(':questionId/copies')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async listCopies(
    @Param('questionId') questionId: string,
    @Query('kind') kind: string,
    @Request() req: any,
  ) {
    return this.questionService.listQuestionCopies(questionId, req.user.id, kind);
  }

  @Post(':questionId/copies')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', createUploadStorage({ bucket: 'documents', maxMb: 20, mimeAllowList: DOCUMENT_MIME_TYPES })),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        name: { type: 'string' },
        kind: { type: 'string' },
      },
      required: ['file'],
    },
  })
  @ApiOperation({
    summary: 'Add another copy/certificate to a multi-copy question',
    description:
      'Uploads to the general document vault tagged against this question, and marks the question completed if it was not already - multi-copy uploads never touch QuestionAnswer directly, so without this the question would stay pending even with real certificates on file.',
  })
  @ApiParam({ name: 'questionId', description: 'The PassportQuestion id' })
  @ApiResponse({
    status: 201,
    description: 'The created UserDocument row.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        userId: { type: 'string' },
        name: { type: 'string' },
        fileUrl: { type: 'string' },
        fileSize: { type: 'number', nullable: true },
        mimeType: { type: 'string', nullable: true },
        tags: { type: 'array', items: { type: 'string' } },
        category: { type: 'string', nullable: true },
        passportId: { type: 'string', nullable: true },
        expiresAt: { type: 'string', format: 'date-time', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  async uploadCopy(
    @Param('questionId') questionId: string,
    @UploadedFile() file: any,
    @Body('name') name: string,
    @Body('kind') kind: string,
    @Request() req: any,
  ) {
    return this.questionService.uploadQuestionCopy(questionId, req.user.id, file, name, kind);
  }

  @ApiOperation({
    summary: 'Delete one multi-copy certificate',
    description:
      'Deletes the document and, if it was the last remaining copy for its question (and no legacy single-slot file exists), reverts that question\'s status from completed back to pending.',
  })
  @ApiParam({ name: 'docId', description: 'The UserDocument id to delete' })
  @ApiResponse({ status: 200, description: 'Document deleted.', schema: { type: 'object', properties: { message: { type: 'string' } } } })
  @ApiResponse({ status: 403, description: 'The document belongs to a different user.' })
  @Delete('copies/:docId')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async deleteCopy(@Param('docId') docId: string, @Request() req: any) {
    return this.questionService.deleteQuestionCopy(req.user.id, docId);
  }

  // E-signature (Tenancy Agreement + Inventory) — the landlord (authed)
  // generates a magic link; the tenant (no account) opens
  // tenancy-sign/:token / inventory-sign/:token to review + sign, no
  // JWT guard on either. One shared link mechanism (kind distinguishes
  // which document is being signed), see question.service.ts.
  @ApiOperation({
    summary: 'Generate a no-account signing link for a tenant',
    description:
      'Landlord-only (authenticated). Creates a random-token link, valid 30 days, that a tenant can open without any account to review and sign either the tenancy agreement or the inventory - kind distinguishes which document the link is for.',
  })
  @ApiParam({ name: 'questionId', description: 'The PassportQuestion the signature belongs to' })
  @ApiResponse({ status: 201, description: 'Signing link created.', schema: { type: 'object', properties: { token: { type: 'string' }, url: { type: 'string', description: 'Full shareable sign link' } } } })
  @Post(':questionId/tenancy-sign-link')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['tenancy', 'inventory'] },
      },
    },
  })
  async createTenancySignLink(
    @Param('questionId') questionId: string,
    @Body('kind') kind: 'tenancy' | 'inventory',
    @Headers('origin') origin: string | undefined,
    @Request() req: any,
  ) {
    return this.questionService.createTenancySignLink(
      questionId,
      req.user.id,
      kind || 'tenancy',
      origin,
    );
  }

  @ApiOperation({
    summary: 'Load the document and signing status for a sign link',
    description:
      'Unauthenticated - the token itself is the credential (expires after 30 days). Returns either the tenancy agreement text or the inventory\'s evidence photos depending on the link\'s kind, plus whether the landlord and/or tenant have already signed.',
  })
  @ApiParam({ name: 'token', description: 'The sign-link token' })
  @ApiResponse({
    status: 200,
    description: 'Document content plus signing status.',
    schema: { type: 'object', properties: { kind: { type: 'string', enum: ['tenancy', 'inventory'] }, propertyAddress: { type: 'string' }, landlordSigned: { type: 'boolean' }, tenantSigned: { type: 'boolean' } } },
  })
  @ApiResponse({ status: 404, description: 'Link or underlying document not found.' })
  @ApiResponse({ status: 403, description: 'Link has expired.' })
  @Get('tenancy-sign/:token')
  async getTenancySignData(@Param('token') token: string) {
    return this.questionService.getTenancySignData(token);
  }

  @ApiOperation({
    summary: 'Submit the tenant\'s signature',
    description:
      'Unauthenticated - the token is the credential. Records the tenant\'s name, signature image, timestamp and submitting IP against the question\'s answer, and marks the link used (single use for the tenant\'s side).',
  })
  @ApiParam({ name: 'token', description: 'The sign-link token' })
  @ApiResponse({ status: 201, description: 'Signature recorded.', schema: { type: 'object', properties: { success: { type: 'boolean' } } } })
  @Post('tenancy-sign/:token')
  async submitTenantSignature(
    @Param('token') token: string,
    @Body() dto: SubmitTenantSignatureDto,
    @Ip() ip: string,
  ) {
    return this.questionService.submitTenantSignature(token, dto, ip);
  }
}
