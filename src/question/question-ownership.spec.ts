/**
 * Coverage for the access checks that guard QuestionService's
 * caller-supplied-id routes.
 *
 * Surfaces tested: answerQuestion, uploadQuestionFile, uploadPartFile,
 * listQuestionCopies, uploadQuestionCopy, deleteQuestionCopy - every one
 * takes a questionId (or, for deleteQuestionCopy, a UserDocument id)
 * straight off the URL. Each must reject a caller with no access to the
 * question's passport (via PassportService.checkUserAccess) or, for
 * answerQuestion, whose collaborator permission level doesn't allow the
 * edit (via PassportService.checkWriteAccess) - before reading or
 * writing anything.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { QuestionService } from './question.service';

function makeService() {
  const prismaStub: any = {
    passportQuestion: { findUnique: jest.fn(), update: jest.fn() },
    questionAnswer: { findUnique: jest.fn(), upsert: jest.fn() },
    userDocument: { findUnique: jest.fn() },
  };
  const passportServiceStub: any = {
    checkUserAccess: jest.fn(),
    checkWriteAccess: jest.fn(),
  };
  const eventsStub: any = { logEvent: jest.fn().mockResolvedValue(undefined) };
  const actionsStub: any = { evaluateRulesForQuestion: jest.fn().mockResolvedValue(undefined) };
  const pathwaysStub: any = { checkTriggersForAnswer: jest.fn().mockResolvedValue(undefined) };
  const rewardsStub: any = {
    recordDailyActivity: jest.fn().mockResolvedValue(undefined),
    awardForQuestion: jest.fn().mockResolvedValue(null),
  };
  const documentsStub: any = {
    getDocumentsByTag: jest.fn(),
    uploadDocument: jest.fn(),
    deleteDocument: jest.fn(),
  };
  const svc = new QuestionService(
    prismaStub,
    passportServiceStub,
    eventsStub,
    actionsStub,
    pathwaysStub,
    rewardsStub,
    documentsStub,
  );
  return { svc, prismaStub, passportServiceStub, documentsStub };
}

const PASSPORT_ID = 'passport-1';
const QUESTION_ID = 'question-1';
const OWNER_ID = 'owner-1';
const OTHER_ID = 'intruder-1';
const DOC_ID = 'doc-1';

function baseQuestion(extra: any = {}) {
  return {
    id: QUESTION_ID,
    questionTemplateId: 'tmpl-1',
    status: 'PENDING',
    questionTemplate: { points: 5, title: 'Title' },
    passportSectionTask: {
      title: 'Task',
      passportSection: { key: 'section-key', passportId: PASSPORT_ID },
    },
    ...extra,
  };
}

describe('QuestionService access checks', () => {
  describe('answerQuestion', () => {
    it('rejects a caller with no access to the question\'s passport', async () => {
      const { svc, prismaStub, passportServiceStub } = makeService();
      prismaStub.passportQuestion.findUnique.mockResolvedValue(baseQuestion());
      passportServiceStub.checkUserAccess.mockResolvedValue(false);

      await expect(
        svc.answerQuestion(QUESTION_ID, OTHER_ID, { value: 'hi' } as any),
      ).rejects.toThrow(ForbiddenException);
      expect(passportServiceStub.checkUserAccess).toHaveBeenCalledWith(PASSPORT_ID, OTHER_ID);
      expect(prismaStub.questionAnswer.upsert).not.toHaveBeenCalled();
    });

    it('404s for a question that does not exist', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.passportQuestion.findUnique.mockResolvedValue(null);
      await expect(
        svc.answerQuestion(QUESTION_ID, OTHER_ID, { value: 'hi' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a collaborator whose permission level does not allow this edit', async () => {
      const { svc, prismaStub, passportServiceStub } = makeService();
      prismaStub.passportQuestion.findUnique.mockResolvedValue(baseQuestion());
      passportServiceStub.checkUserAccess.mockResolvedValue(true);
      prismaStub.questionAnswer.findUnique.mockResolvedValue(null);
      passportServiceStub.checkWriteAccess.mockResolvedValue({ allowed: false });

      await expect(
        svc.answerQuestion(QUESTION_ID, OTHER_ID, { value: 'hi' } as any),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaStub.questionAnswer.upsert).not.toHaveBeenCalled();
    });

    it('allows a caller with write access', async () => {
      const { svc, prismaStub, passportServiceStub } = makeService();
      prismaStub.passportQuestion.findUnique.mockResolvedValue(baseQuestion());
      passportServiceStub.checkUserAccess.mockResolvedValue(true);
      prismaStub.questionAnswer.findUnique.mockResolvedValue(null);
      passportServiceStub.checkWriteAccess.mockResolvedValue({ allowed: true, isOwner: true });
      prismaStub.questionAnswer.upsert.mockResolvedValue({});
      prismaStub.passportQuestion.update.mockResolvedValue({});

      const result = await svc.answerQuestion(QUESTION_ID, OWNER_ID, { value: 'hi' } as any);
      expect(result.success).toBe(true);
    });
  });

  describe('uploadQuestionFile', () => {
    const file = { originalname: 'f.pdf', mimetype: 'application/pdf', size: 10 };

    it('rejects a caller with no access', async () => {
      const { svc, prismaStub, passportServiceStub } = makeService();
      prismaStub.passportQuestion.findUnique.mockResolvedValue(baseQuestion());
      passportServiceStub.checkUserAccess.mockResolvedValue(false);

      await expect(svc.uploadQuestionFile(QUESTION_ID, OTHER_ID, file)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prismaStub.questionAnswer.upsert).not.toHaveBeenCalled();
    });

    it('404s for a question that does not exist', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.passportQuestion.findUnique.mockResolvedValue(null);
      await expect(svc.uploadQuestionFile(QUESTION_ID, OTHER_ID, file)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('uploadPartFile', () => {
    const file = { originalname: 'f.pdf', mimetype: 'application/pdf', size: 10 };

    it('rejects a caller with no access', async () => {
      const { svc, prismaStub, passportServiceStub } = makeService();
      prismaStub.passportQuestion.findUnique.mockResolvedValue(baseQuestion());
      passportServiceStub.checkUserAccess.mockResolvedValue(false);

      await expect(svc.uploadPartFile(QUESTION_ID, OTHER_ID, file)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('listQuestionCopies / uploadQuestionCopy', () => {
    it('listQuestionCopies rejects a caller with no access', async () => {
      const { svc, prismaStub, passportServiceStub } = makeService();
      prismaStub.passportQuestion.findUnique.mockResolvedValue(baseQuestion());
      passportServiceStub.checkUserAccess.mockResolvedValue(false);

      await expect(svc.listQuestionCopies(QUESTION_ID, OTHER_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('uploadQuestionCopy rejects a caller with no access', async () => {
      const { svc, prismaStub, passportServiceStub, documentsStub } = makeService();
      prismaStub.passportQuestion.findUnique.mockResolvedValue(baseQuestion());
      passportServiceStub.checkUserAccess.mockResolvedValue(false);

      await expect(
        svc.uploadQuestionCopy(QUESTION_ID, OTHER_ID, { originalname: 'f.pdf' }),
      ).rejects.toThrow(ForbiddenException);
      expect(documentsStub.uploadDocument).not.toHaveBeenCalled();
    });
  });

  describe('deleteQuestionCopy', () => {
    it('rejects a caller who does not own the document', async () => {
      const { svc, prismaStub, documentsStub } = makeService();
      prismaStub.userDocument.findUnique.mockResolvedValue({ userId: OWNER_ID, tags: [] });

      await expect(svc.deleteQuestionCopy(OTHER_ID, DOC_ID)).rejects.toThrow(ForbiddenException);
      expect(documentsStub.deleteDocument).not.toHaveBeenCalled();
    });
  });
});
