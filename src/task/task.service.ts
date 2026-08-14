import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PassportService } from '../passport/passport.service';
import { RewardsService } from '../rewards/rewards.service';
import { sectionBonusActionKey } from '../rewards/section-bonuses';
import { StampEvaluatorService } from '../rewards/stamp-evaluator';

@Injectable()
export class TaskService {
  constructor(
    private prisma: PrismaService,
    private passportService: PassportService,
    private rewards: RewardsService,
    private stampEvaluator: StampEvaluatorService,
  ) {}

  async getTaskQuestions(taskId: string, userId: string) {
    const task = await this.prisma.passportSectionTask.findUnique({
      where: { id: taskId },
      include: {
        passportSection: {
          include: {
            passport: {
              select: { ownerId: true },
            },
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    // Check if user has access (owner or collaborator)
    const passportId = task.passportSection.passportId;
    const hasAccess = await this.passportService.checkUserAccess(
      passportId,
      userId,
    );
    if (!hasAccess) {
      throw new ForbiddenException('You do not have access to this task');
    }

    const questions = await this.prisma.passportQuestion.findMany({
      where: { passportSectionTaskId: taskId },
      include: {
        questionTemplate: {
          select: {
            id: true,
            title: true,
            description: true,
            instructionText: true,
            type: true,
            helpText: true,
            helpContent: true,
            helpVideoUrl: true,
            options: true,
            placeholder: true,
            displayMode: true,
            uploadInstruction: true,
            prewrittenTemplates: true,
            dateFields: true,
            parts: true,
            fields: true,
            autoSaveOn: true,
            repeatable: true,
            buttonText: true,
            scaleType: true,
            scaleMin: true,
            scaleMax: true,
            scaleStep: true,
            scaleFormat: true,
            scaleMaxLabel: true,
            externalLink: true,
            otherPlaceholder: true,
            points: true,
          },
        },
        answer: {
          select: {
            answerText: true,
            answerJson: true,
            fileUrl: true,
          },
        },
      },
      orderBy: {
        questionTemplate: {
          order: 'asc',
        },
      },
    });

    const transformedQuestions = questions.map((question) => ({
      id: question.id,
      templateId: question.questionTemplate.id,
      question: question.questionTemplate.title,
      description: question.questionTemplate.description,
      instructionText: question.questionTemplate.instructionText,
      type: question.questionTemplate.type,
      help: question.questionTemplate.helpText,
      helpContent: question.questionTemplate.helpContent ?? null,
      helpVideoUrl: question.questionTemplate.helpVideoUrl ?? null,
      options: question.questionTemplate.options,
      placeholder: question.questionTemplate.placeholder,
      display: question.questionTemplate.displayMode,
      uploadInstruction: question.questionTemplate.uploadInstruction,
      prewritten: question.questionTemplate.prewrittenTemplates,
      dateFields: question.questionTemplate.dateFields,
      parts: question.questionTemplate.parts,
      fields: question.questionTemplate.fields,
      autoSaveOn: question.questionTemplate.autoSaveOn,
      repeatable: question.questionTemplate.repeatable,
      buttonText: question.questionTemplate.buttonText,
      scaleType: question.questionTemplate.scaleType,
      scaleMin: question.questionTemplate.scaleMin,
      scaleMax: question.questionTemplate.scaleMax,
      scaleStep: question.questionTemplate.scaleStep,
      scaleFormat: question.questionTemplate.scaleFormat,
      scaleMaxLabel: question.questionTemplate.scaleMaxLabel,
      externalLink: question.questionTemplate.externalLink,
      otherPlaceholder: question.questionTemplate.otherPlaceholder,
      points: question.questionTemplate.points,
      answer: question.answer
        ? question.answer.answerText ||
          question.answer.answerJson ||
          question.answer.fileUrl
        : null,
      completed: question.status === 'COMPLETED',
    }));

    return transformedQuestions;
  }

  async completeTask(taskId: string, userId: string) {
    const task = await this.prisma.passportSectionTask.findUnique({
      where: { id: taskId },
      include: {
        passportSection: {
          include: {
            passport: {
              select: { ownerId: true },
            },
          },
        },
        passportQuestions: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    // Check if user has access (owner or collaborator)
    const passportId = task.passportSection.passportId;
    const hasAccess = await this.passportService.checkUserAccess(
      passportId,
      userId,
    );
    if (!hasAccess) {
      throw new ForbiddenException('You do not have access to this task');
    }

    const totalQuestions = task.passportQuestions.length;
    const completedQuestions = task.passportQuestions.filter(
      (q) => q.status === 'COMPLETED',
    ).length;

    if (completedQuestions !== totalQuestions) {
      throw new BadRequestException('Task not finished');
    }

    await this.prisma.passportSectionTask.update({
      where: { id: taskId },
      data: { status: 'COMPLETED' },
    });

    // UMU Stamp Reward System V1 — re-checks every stamp this task's
    // completion could have just satisfied (this task alone, or as the
    // last piece of a multi-task/cross-section group). Fire-and-forget:
    // never allowed to block task completion.
    this.stampEvaluator
      .evaluatePassport(passportId, userId)
      .catch((err) => console.error(`[StampEvaluator] failed: ${err?.message}`));

    const sectionId = task.passportSection.id;

    const tasksInSection = await this.prisma.passportSectionTask.findMany({
      where: { passportSectionId: sectionId },
      select: { id: true, status: true },
    });

    const allTasksCompleted = tasksInSection.every(
      (t) => t.status === 'COMPLETED',
    );

    let sectionCompleted = false;
    let nextSectionId: string | undefined;
    let awardedBonusPoints = 0;
    let balanceAfterBonus: number | undefined;

    if (allTasksCompleted) {
      sectionCompleted = true;
      const currentSection = task.passportSection;
      const actionKey = sectionBonusActionKey(currentSection.key);

      // Guards against re-running the one-time completion side effects
      // (activity log, bonus award, next-section unlock) on every
      // subsequent completeTask call for this section — e.g. re-toggling
      // an already-answered NOTE question re-triggers this endpoint, and
      // without this check it would log a duplicate Timeline entry and
      // attempt to re-award the bonus (harmlessly blocked by the ledger's
      // idempotency guard, but reporting a false "0 pts" bonus back to a
      // celebration screen that's already been shown once).
      if (currentSection.status === 'COMPLETED') {
        const existingEntry = await this.prisma.pointsLedgerEntry.findUnique({
          where: { userId_actionKey_subjectId: { userId, actionKey, subjectId: sectionId } },
        });
        if (existingEntry) {
          awardedBonusPoints = existingEntry.amount;
          balanceAfterBonus = existingEntry.balanceAfter;
        }
        const nextSection = await this.prisma.passportSection.findFirst({
          where: { passportId: currentSection.passportId, order: { gt: currentSection.order } },
          orderBy: { order: 'asc' },
        });
        if (nextSection) nextSectionId = nextSection.id;
      } else {
        await this.prisma.passportSection.update({
          where: { id: sectionId },
          data: { status: 'COMPLETED' },
        });

        // Record an immutable activity-ledger entry — surfaces on the Timeline tab.
        await this.passportService.logActivity(currentSection.passportId, {
          type: 'SECTION_COMPLETED',
          title: `${currentSection.title} completed & verified`,
          actor: 'You',
          icon: '📎',
          metadata: { sectionKey: currentSection.key },
        });
        // Section-completion bonus, on top of whatever per-question points
        // were already earned along the way. Amount varies by section (see
        // section-bonuses.ts) — subjectId = sectionId, so this can only
        // ever fire once per section. Awaited (unlike CORE_PASSPORT_COMPLETE
        // below) because the section-complete celebration screen needs the
        // exact bonus amount + resulting balance to show "425 -> 455 pts" —
        // still wrapped in try/catch so a rewards hiccup never fails task
        // completion itself.
        try {
          const awarded = await this.rewards.award(userId, actionKey, sectionId, {
            passportId: currentSection.passportId,
          });
          if (awarded) {
            awardedBonusPoints = awarded.amount;
            balanceAfterBonus = awarded.balanceAfter;
          }
        } catch (err: any) {
          console.error(`[Rewards] ${actionKey} award failed: ${err?.message}`);
        }
        const nextSection = await this.prisma.passportSection.findFirst({
          where: {
            passportId: currentSection.passportId,
            order: {
              gt: currentSection.order,
            },
          },
          orderBy: { order: 'asc' },
        });

        if (nextSection) {
          await this.prisma.passportSection.update({
            where: { id: nextSection.id },
            data: { status: 'ACTIVE' },
          });
          nextSectionId = nextSection.id;
        } else {
          // No next section left to activate — check whether every section
          // on this passport is now COMPLETED (re-query rather than assume
          // order-based "last section" means "all done", since sections can
          // in principle be skipped/reordered). "Complete core Property
          // Passport" — 1000 pts per the client's Major Actions Points
          // Framework. subjectId = passportId, so this can only ever fire
          // once per passport. Never allowed to block task completion.
          const allSections = await this.prisma.passportSection.findMany({
            where: { passportId: currentSection.passportId },
            select: { status: true },
          });
          if (allSections.length > 0 && allSections.every((s) => s.status === 'COMPLETED')) {
            this.rewards
              .award(userId, 'CORE_PASSPORT_COMPLETE', currentSection.passportId, {
                passportId: currentSection.passportId,
              })
              .catch((err) =>
                console.error(`[Rewards] CORE_PASSPORT_COMPLETE award failed: ${err?.message}`),
              );
          }
        }
      }
    }

    return {
      success: true,
      sectionCompleted,
      nextSectionId,
      sectionBonusPoints: awardedBonusPoints,
      balanceAfterBonus,
    };
  }
}
