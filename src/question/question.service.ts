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
import { DocumentsService } from '../documents/documents.service';
import { publicUrlFor, storedFilename, isS3Mode } from '../common/storage';

@Injectable()
export class QuestionService {
  constructor(
    private prisma: PrismaService,
    private passportService: PassportService,
    private rewardsService: RewardsService,
    private documentsService: DocumentsService,
  ) {}

  private copyTag(questionId: string): string {
    return `landlord-cert:${questionId}`;
  }

  private async assertQuestionAccess(questionId: string, userId: string) {
    const question = await this.prisma.passportQuestion.findUnique({
      where: { id: questionId },
      include: { passportSectionTask: { include: { passportSection: true } } },
    });
    if (!question) throw new NotFoundException('Question not found');
    const passportId = question.passportSectionTask.passportSection.passportId;
    const hasAccess = await this.passportService.checkUserAccess(passportId, userId);
    if (!hasAccess) throw new ForbiddenException('You do not have access to this question');
    return question;
  }

  // Multi-copy certificate retention (client feedback items 1a/3) — a
  // landlord uploading a renewed Gas Safety cert or EPC shouldn't lose
  // the previous copy, which they may still need for compliance history.
  // Reuses UserDocument (the same model/storage/signed-URL machinery as
  // the general /documents vault) rather than the single QuestionAnswer
  // .fileUrl slot every other UPLOAD question still uses, tagged per
  // question so it stays scoped to just this section's list.
  async listQuestionCopies(questionId: string, userId: string) {
    await this.assertQuestionAccess(questionId, userId);
    return this.documentsService.getDocumentsByTag(userId, this.copyTag(questionId));
  }

  async uploadQuestionCopy(questionId: string, userId: string, file: any, name?: string) {
    await this.assertQuestionAccess(questionId, userId);
    return this.documentsService.uploadDocument(userId, file, name || '', [this.copyTag(questionId)]);
  }

  async deleteQuestionCopy(userId: string, docId: string) {
    return this.documentsService.deleteDocument(userId, docId);
  }

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

  // For a file uploaded as ONE PART of a MULTIPART question — e.g. the
  // "photos" part of services/electricity, which sits alongside a
  // separate property_rewired yes/no part in the SAME PassportQuestion.
  // uploadQuestionFile() above upserts the whole QuestionAnswer row
  // (wiping every other part's answer already in answerJson) and force-
  // completes the question — correct for a real standalone upload
  // question, destructive here. This only verifies access, stores the
  // file, and returns its URL; the caller merges that URL into the
  // part's own answer and saves the WHOLE multipart answer normally
  // (MultipartQuestion.vue's updatePartAnswer -> the regular save flow).
  async uploadPartFile(questionId: string, userId: string, file: any) {
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

    const relative = publicUrlFor('passport-docs', storedFilename(file));
    const fileUrl = isS3Mode ? relative : `${BASE_URL}${relative}`;

    return { url: fileUrl, name: file.originalname, mimeType: file.mimetype, size: file.size };
  }
}
