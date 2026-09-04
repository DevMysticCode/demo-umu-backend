import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  Ip,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { QuestionService } from './question.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { createUploadStorage } from '../common/storage';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3002';

interface AnswerQuestionDto {
  value: any;
}

@Controller('questions')
export class QuestionController {
  constructor(private questionService: QuestionService) {}

  @Post(':questionId/answer')
  @UseGuards(JwtAuthGuard)
  async answerQuestion(
    @Param('questionId') questionId: string,
    @Body() dto: AnswerQuestionDto,
    @Request() req: any,
  ) {
    const userId = req.user.id;
    return this.questionService.answerQuestion(questionId, userId, dto);
  }

  @Post(':questionId/upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadPath = join(process.cwd(), 'uploads', 'passport-docs');
          if (!existsSync(uploadPath)) mkdirSync(uploadPath, { recursive: true });
          cb(null, uploadPath);
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
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
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadPath = join(process.cwd(), 'uploads', 'passport-docs');
          if (!existsSync(uploadPath)) mkdirSync(uploadPath, { recursive: true });
          cb(null, uploadPath);
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
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
  @Get(':questionId/copies')
  @UseGuards(JwtAuthGuard)
  async listCopies(
    @Param('questionId') questionId: string,
    @Query('kind') kind: string,
    @Request() req: any,
  ) {
    return this.questionService.listQuestionCopies(questionId, req.user.id, kind);
  }

  @Post(':questionId/copies')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', createUploadStorage({ bucket: 'documents', maxMb: 20 })),
  )
  async uploadCopy(
    @Param('questionId') questionId: string,
    @UploadedFile() file: any,
    @Body('name') name: string,
    @Body('kind') kind: string,
    @Request() req: any,
  ) {
    return this.questionService.uploadQuestionCopy(questionId, req.user.id, file, name, kind);
  }

  @Delete('copies/:docId')
  @UseGuards(JwtAuthGuard)
  async deleteCopy(@Param('docId') docId: string, @Request() req: any) {
    return this.questionService.deleteQuestionCopy(req.user.id, docId);
  }

  // Tenancy Agreement e-signature — the landlord (authed) generates a
  // magic link; the tenant (no account) opens tenancy-sign/:token and
  // tenancy-sign POST to review + sign, no JWT guard on either.
  @Post(':questionId/tenancy-sign-link')
  @UseGuards(JwtAuthGuard)
  async createTenancySignLink(@Param('questionId') questionId: string, @Request() req: any) {
    return this.questionService.createTenancySignLink(questionId, req.user.id);
  }

  @Get('tenancy-sign/:token')
  async getTenancySignData(@Param('token') token: string) {
    return this.questionService.getTenancySignData(token);
  }

  @Post('tenancy-sign/:token')
  async submitTenantSignature(
    @Param('token') token: string,
    @Body() dto: { signerName: string; signatureDataUrl: string },
    @Ip() ip: string,
  ) {
    return this.questionService.submitTenantSignature(token, dto, ip);
  }
}
