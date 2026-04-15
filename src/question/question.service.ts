import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3002';
import { PrismaService } from '../prisma/prisma.service';
import { AnswerQuestionDto } from './dto/answer-question.dto';
import { PassportService } from '../passport/passport.service';

@Injectable()
export class QuestionService {
  constructor(
    private prisma: PrismaService,
    private passportService: PassportService,
  ) {}

  async answerQuestion(
    questionId: string,
    userId: string,
    dto: AnswerQuestionDto,
  ) {
    const question = await this.prisma.passportQuestion.findUnique({
      where: { id: questionId },
      include: {
        passportSectionTask: {
          include: {
            passportSection: {
              include: {
                passport: {
                  select: { ownerId: true },
                },
              },
            },
          },
        },
      },
    });

    if (!question) {
      throw new NotFoundException('Question not found');
    }

    // Check if user has access (owner or collaborator)
    const passportId = question.passportSectionTask.passportSection.passportId;
    const hasAccess = await this.passportService.checkUserAccess(
      passportId,
      userId,
    );
    if (!hasAccess) {
      throw new ForbiddenException('You do not have access to this question');
    }

    let answerText: string | null = null;
    let answerJson: any = null;
    let fileUrl: string | null = null;

    if (typeof dto.value === "string") {
      if (
        dto.value.startsWith("http://") ||
        dto.value.startsWith("https://") ||
        dto.value.startsWith("s3://")
      ) {
        fileUrl = dto.value;
      } else {
        answerText = dto.value;
      }
    } else if (typeof dto.value === "object" && dto.value !== null) {
      answerJson = dto.value;
    } else {
      answerText = String(dto.value);
    }

    await this.prisma.questionAnswer.upsert({
      where: { passportQuestionId: questionId },
      update: {
        answerText,
        answerJson,
        fileUrl,
      },
      create: {
        passportQuestionId: questionId,
        answerText,
        answerJson,
        fileUrl,
      },
    });

    await this.prisma.passportQuestion.update({
      where: { id: questionId },
      data: { status: "COMPLETED" },
    });

    return { success: true };
  }

  async uploadQuestionFile(questionId: string, userId: string, file: any) {
    if (!file) throw new BadRequestException('No file provided');

    const question = await this.prisma.passportQuestion.findUnique({
      where: { id: questionId },
      include: {
        passportSectionTask: {
          include: { passportSection: { include: { passport: { select: { ownerId: true } } } } },
        },
      },
    });
    if (!question) throw new NotFoundException('Question not found');

    const passportId = question.passportSectionTask.passportSection.passportId;
    const hasAccess = await this.passportService.checkUserAccess(passportId, userId);
    if (!hasAccess) throw new ForbiddenException('You do not have access to this question');

    const fileUrl = `${BASE_URL}/uploads/passport-docs/${file.filename}`;
    return { url: fileUrl, name: file.originalname, mimeType: file.mimetype, size: file.size };
  }
}
