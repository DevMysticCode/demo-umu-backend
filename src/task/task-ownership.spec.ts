/**
 * Coverage for the access checks that guard TaskService's
 * caller-supplied-id routes.
 *
 * Surfaces tested: getTaskQuestions, completeTask - both take a taskId
 * straight off the URL with no other scoping. Each must reject a caller
 * who is neither the owner nor a collaborator on the task's passport,
 * via PassportService.checkUserAccess, before reading or mutating
 * anything.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TaskService } from './task.service';

function makeService() {
  const prismaStub: any = {
    passportSectionTask: { findUnique: jest.fn(), update: jest.fn() },
    passportQuestion: { findMany: jest.fn() },
    passportSection: { findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    pointsLedgerEntry: { findUnique: jest.fn() },
  };
  const passportServiceStub: any = {
    checkUserAccess: jest.fn(),
    logActivity: jest.fn().mockResolvedValue(undefined),
  };
  const rewardsStub: any = { award: jest.fn() };
  const stampEvaluatorStub: any = { evaluatePassport: jest.fn().mockResolvedValue(undefined) };
  return {
    svc: new TaskService(prismaStub, passportServiceStub, rewardsStub, stampEvaluatorStub),
    prismaStub,
    passportServiceStub,
  };
}

const PASSPORT_ID = 'passport-1';
const TASK_ID = 'task-1';
const OTHER_ID = 'intruder-1';

function baseTask() {
  return {
    id: TASK_ID,
    passportSection: {
      id: 'section-1',
      passportId: PASSPORT_ID,
      passport: { ownerId: 'owner-1' },
    },
    passportQuestions: [],
  };
}

describe('TaskService access checks', () => {
  describe('getTaskQuestions', () => {
    it('rejects a caller with no access to the task\'s passport', async () => {
      const { svc, prismaStub, passportServiceStub } = makeService();
      prismaStub.passportSectionTask.findUnique.mockResolvedValue(baseTask());
      passportServiceStub.checkUserAccess.mockResolvedValue(false);

      await expect(svc.getTaskQuestions(TASK_ID, OTHER_ID)).rejects.toThrow(ForbiddenException);
      expect(passportServiceStub.checkUserAccess).toHaveBeenCalledWith(PASSPORT_ID, OTHER_ID);
      expect(prismaStub.passportQuestion.findMany).not.toHaveBeenCalled();
    });

    it('404s for a task that does not exist', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.passportSectionTask.findUnique.mockResolvedValue(null);
      await expect(svc.getTaskQuestions(TASK_ID, OTHER_ID)).rejects.toThrow(NotFoundException);
    });

    it('allows a caller with access', async () => {
      const { svc, prismaStub, passportServiceStub } = makeService();
      prismaStub.passportSectionTask.findUnique.mockResolvedValue(baseTask());
      passportServiceStub.checkUserAccess.mockResolvedValue(true);
      prismaStub.passportQuestion.findMany.mockResolvedValue([]);

      const result = await svc.getTaskQuestions(TASK_ID, 'owner-1');
      expect(result).toEqual([]);
    });
  });

  describe('completeTask', () => {
    it('rejects a caller with no access to the task\'s passport', async () => {
      const { svc, prismaStub, passportServiceStub } = makeService();
      prismaStub.passportSectionTask.findUnique.mockResolvedValue(baseTask());
      passportServiceStub.checkUserAccess.mockResolvedValue(false);

      await expect(svc.completeTask(TASK_ID, OTHER_ID)).rejects.toThrow(ForbiddenException);
      expect(prismaStub.passportSectionTask.update).not.toHaveBeenCalled();
    });

    it('404s for a task that does not exist', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.passportSectionTask.findUnique.mockResolvedValue(null);
      await expect(svc.completeTask(TASK_ID, OTHER_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
