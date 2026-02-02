import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { QuestionService } from './question.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

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
    const userId = req.user.sub;
    return this.questionService.answerQuestion(questionId, userId, dto);
  }
}
