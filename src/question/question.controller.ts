import {
  Controller,
  Post,
  Param,
  Body,
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
}
