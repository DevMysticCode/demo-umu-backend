import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';

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

  // `kind` lets one question host more than one independently-tracked
  // document list — Deposit Protection needs this: the protection
  // certificate and the served prescribed-information copy are legally
  // distinct documents (client feedback item #7), but both live under the
  // same deposit_upload question. Defaults to the plain form so existing
  // Gas Safety/EPC/EICR/Insurance tags (landlord-cert:<questionId>, no
  // kind) keep matching unchanged.
  private copyTag(questionId: string, kind?: string): string {
    return kind ? `landlord-cert:${kind}:${questionId}` : `landlord-cert:${questionId}`;
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
  async listQuestionCopies(questionId: string, userId: string, kind?: string) {
    await this.assertQuestionAccess(questionId, userId);
    return this.documentsService.getDocumentsByTag(userId, this.copyTag(questionId, kind));
  }

  async uploadQuestionCopy(questionId: string, userId: string, file: any, name?: string, kind?: string) {
    const question = await this.assertQuestionAccess(questionId, userId);
    const doc = await this.documentsService.uploadDocument(
      userId,
      file,
      name || '',
      [this.copyTag(questionId, kind)],
    );
    // Multi-copy uploads never touch QuestionAnswer (they live on
    // UserDocument instead — see listQuestionCopies), so without this the
    // question stays PENDING forever even with real certificates on file:
    // section-completion, the passport progress %, and the compliance
    // card's status pill all read PassportQuestion.status, not the copies
    // list. Mark it COMPLETED the same way answerQuestion() does on the
    // first successful copy.
    if (question.status !== 'COMPLETED') {
      await this.prisma.passportQuestion.update({
        where: { id: questionId },
        data: { status: 'COMPLETED' },
      });
    }
    return doc;
  }

  async deleteQuestionCopy(userId: string, docId: string) {
    // Read the tag before deleting so we know which question to re-check
    // afterwards — removing a landlord's only certificate shouldn't leave
    // the section showing complete with nothing on file.
    const doc = await this.prisma.userDocument.findUnique({
      where: { id: docId },
      select: { tags: true },
    });
    const tag = (doc?.tags as string[] | null)?.find((t) => t.startsWith('landlord-cert:'));
    // Tag shape is either landlord-cert:<questionId> or, for a
    // multi-kind question (Deposit Protection's cert vs served-PI),
    // landlord-cert:<kind>:<questionId> — the id is always the LAST
    // segment either way.
    const questionId = tag?.split(':').pop();

    const result = await this.documentsService.deleteDocument(userId, docId);

    if (questionId) {
      const [remaining, question] = await Promise.all([
        this.documentsService.getDocumentsByTag(userId, tag!),
        this.prisma.passportQuestion.findUnique({
          where: { id: questionId },
          include: { answer: true },
        }),
      ]);
      const hasLegacyFile = !!question?.answer?.fileUrl;
      if (remaining.length === 0 && !hasLegacyFile && question?.status === 'COMPLETED') {
        await this.prisma.passportQuestion.update({
          where: { id: questionId },
          data: { status: 'PENDING' },
        });
      }
    }

    return result;
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

  // ── Tenancy Agreement e-signature (client feedback: "Send to tenant
  // to e-sign", held earlier this session pending scope, now approved —
  // magic link, drawn signature). The tenant has no umovingu account, so
  // access is by long-lived signed token (TenancySignLink) rather than
  // JWT — same reasoning as SharedPassportLink, but write-capable and
  // longer-lived (signing can take days, not a 3-hour viewing window).
  // Signature images are stored as data: URLs directly in the answer's
  // JSON blob rather than going through the file-upload pipeline — the
  // tenant is unauthenticated, so the ownership/signed-URL machinery
  // every other upload uses doesn't apply, and a signature PNG is small
  // enough that a Postgres text column is the simpler, safer choice.
  private frontendBaseUrl(): string {
    return (
      process.env.FRONTEND_URL ??
      (process.env.NODE_ENV === 'production'
        ? 'https://demo-umu-frontend.vercel.app'
        : 'http://localhost:3000')
    );
  }

  async createTenancySignLink(questionId: string, userId: string, kind: 'tenancy' | 'inventory' = 'tenancy') {
    await this.assertQuestionAccess(questionId, userId);
    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days — signing can take a while
    const link = await this.prisma.tenancySignLink.create({
      data: { passportQuestionId: questionId, token, kind, expiresAt },
    });
    return { token: link.token, url: `${this.frontendBaseUrl()}/sign/${kind}/${link.token}` };
  }

  async getTenancySignData(token: string) {
    const link = await this.prisma.tenancySignLink.findUnique({ where: { token } });
    if (!link) throw new NotFoundException('This signing link is invalid.');
    if (link.expiresAt < new Date()) throw new ForbiddenException('This signing link has expired.');

    const question = await this.prisma.passportQuestion.findUnique({
      where: { id: link.passportQuestionId },
      include: {
        answer: true,
        passportSectionTask: {
          include: { passportSection: { include: { passport: true } } },
        },
      },
    });
    if (!question) throw new NotFoundException('Document not found.');

    const record = (question.answer?.answerJson as any) ?? {};
    const propertyAddress = question.passportSectionTask.passportSection.passport.addressLine1 ?? '';
    const landlordSigned = !!record.audit?.landlord;
    const tenantSigned = !!record.audit?.tenant;

    if (link.kind === 'inventory') {
      // Inventory has no assembled document text (Tenancy Agreement's
      // docText) — summarise the room-by-room record instead, matching
      // what the landlord already sees on the review screen.
      return {
        kind: 'inventory',
        tenantName: record.tenantName ?? '',
        propertyAddress,
        inventoryType: record.type ?? 'checkin',
        furnishing: record.furnishing ?? '',
        completedAt: record.completedAt ?? '',
        rooms: (record.rooms ?? []).map((r: any) => ({
          name: r.name,
          items: (r.items ?? []).map((i: any) => ({ name: i.name, condition: i.condition, cleanliness: i.cleanliness, note: i.note })),
        })),
        landlordSigned,
        tenantSigned,
      };
    }

    return {
      kind: 'tenancy',
      docText: record.docText ?? [],
      tenantName: record.tenantName ?? '',
      propertyAddress,
      landlordSigned,
      tenantSigned,
    };
  }

  async submitTenantSignature(
    token: string,
    dto: { signerName: string; signatureDataUrl: string },
    ip?: string,
  ) {
    const link = await this.prisma.tenancySignLink.findUnique({ where: { token } });
    if (!link) throw new NotFoundException('This signing link is invalid.');
    if (link.expiresAt < new Date()) throw new ForbiddenException('This signing link has expired.');
    if (link.usedAt) throw new ForbiddenException('This document has already been signed.');
    if (!dto.signerName?.trim() || !dto.signatureDataUrl) {
      throw new BadRequestException('A name and signature are required.');
    }
    if (!dto.signatureDataUrl.startsWith('data:image/')) {
      throw new BadRequestException('Invalid signature image.');
    }

    const question = await this.prisma.passportQuestion.findUnique({
      where: { id: link.passportQuestionId },
      include: { answer: true },
    });
    if (!question) throw new NotFoundException('Document not found.');

    const record = (question.answer?.answerJson as any) ?? {};
    record.audit = record.audit ?? {};
    record.audit.tenant = {
      name: dto.signerName.trim(),
      signatureDataUrl: dto.signatureDataUrl,
      signedAt: new Date().toISOString(),
      ip: ip ?? null,
    };

    await this.prisma.questionAnswer.upsert({
      where: { passportQuestionId: link.passportQuestionId },
      update: { answerJson: record },
      create: { passportQuestionId: link.passportQuestionId, answerJson: record },
    });
    await this.prisma.tenancySignLink.update({ where: { token }, data: { usedAt: new Date() } });

    return { success: true };
  }
}
