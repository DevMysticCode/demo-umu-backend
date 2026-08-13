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
import { RewardsService } from '../rewards/rewards.service';
import { publicUrlFor, storedFilename, isS3Mode } from '../common/storage';

@Injectable()
export class QuestionService {
  constructor(
    private prisma: PrismaService,
    private passportService: PassportService,
    private rewardsService: RewardsService,
  ) {}

  async answerQuestion(
    questionId: string,
    userId: string,
    dto: AnswerQuestionDto,
  ) {
    const question = await this.prisma.passportQuestion.findUnique({
      where: { id: questionId },
      include: {
        questionTemplate: { select: { points: true, title: true } },
        passportSectionTask: {
          include: {
            passportSection: {
              select: { key: true, passportId: true },
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

    const wasAlreadyCompleted = question.status === 'COMPLETED';

    await this.prisma.passportQuestion.update({
      where: { id: questionId },
      data: { status: "COMPLETED" },
    });

    // Counts today toward the daily-activity streak regardless of whether
    // this question was already answered before — any real interaction on
    // the passport should keep a streak alive, not just first-time
    // completions. Fire-and-forget: never let this affect the save.
    this.rewardsService.recordDailyActivity(userId).catch(() => {});

    // Award points the first time this question is ever completed. Never
    // let a rewards hiccup fail the answer save — the DB unique constraint
    // on passportQuestionId is the real idempotency guarantee regardless
    // of this pre-check, so this is belt-and-suspenders, not load-bearing.
    let pointsAwarded = 0;
    if (!wasAlreadyCompleted) {
      try {
        // MULTIPART questions are seeded with an intentionally blank
        // QuestionTemplate.title (their label is built from `parts` on the
        // frontend instead) — ~60% of templates are this type. Falling
        // back to the task's title keeps the ledger description readable
        // instead of rendering as `Answered: ""`.
        const questionLabel =
          question.questionTemplate.title?.trim() || question.passportSectionTask.title;
        const awarded = await this.rewardsService.awardForQuestion(
          userId,
          questionId,
          question.questionTemplate.points,
          `Answered: "${questionLabel}"`,
          {
            passportId: question.passportSectionTask.passportSection.passportId,
            sectionKey: question.passportSectionTask.passportSection.key,
          },
        );
        if (awarded) pointsAwarded = awarded.amount;
      } catch {
        /* non-critical — the answer itself already saved successfully */
      }
    }

    return { success: true, pointsAwarded };
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

    // passport-docs is a PRIVATE bucket — publicUrlFor returns the
    // relative `/uploads/passport-docs/<filename>` form in both modes,
    // and FilesService later wraps it in a signed /files/... URL on
    // read. We prepend BASE_URL only in disk mode to preserve legacy
    // behaviour; S3 mode stores the relative form so the existing
    // ownership lookup in FilesService.userOwnsFilePath matches.
    const relative = publicUrlFor('passport-docs', storedFilename(file));
    const fileUrl = isS3Mode ? relative : `${BASE_URL}${relative}`;

    // Persist the upload as the question's answer + carry the original
    // filename in answerJson so the UI can show "Gas Safety 2026.pdf"
    // instead of the random server-side filename.
    await this.prisma.questionAnswer.upsert({
      where: { passportQuestionId: questionId },
      update: {
        fileUrl,
        answerJson: {
          fileName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
        } as any,
      },
      create: {
        passportQuestionId: questionId,
        fileUrl,
        answerJson: {
          fileName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
        } as any,
      },
    });

    await this.prisma.passportQuestion.update({
      where: { id: questionId },
      data: { status: 'COMPLETED' },
    });

    return { url: fileUrl, name: file.originalname, mimeType: file.mimetype, size: file.size };
  }
}
