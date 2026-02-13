import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PassportService } from '../passport/passport.service';

@Injectable()
export class TaskService {
  constructor(
    private prisma: PrismaService,
    private passportService: PassportService,
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
            options: true,
            placeholder: true,
            displayMode: true,
            uploadInstruction: true,
            prewrittenTemplates: true,
            dateFields: true,
            parts: true,
            fields: true,
            repeatable: true,
            buttonText: true,
            scaleMin: true,
            scaleMax: true,
            scaleStep: true,
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
      options: question.questionTemplate.options,
      placeholder: question.questionTemplate.placeholder,
      display: question.questionTemplate.displayMode,
      uploadInstruction: question.questionTemplate.uploadInstruction,
      prewritten: question.questionTemplate.prewrittenTemplates,
      dateFields: question.questionTemplate.dateFields,
      parts: question.questionTemplate.parts,
      fields: question.questionTemplate.fields,
      repeatable: question.questionTemplate.repeatable,
      buttonText: question.questionTemplate.buttonText,
      min: question.questionTemplate.scaleMin,
      max: question.questionTemplate.scaleMax,
      step: question.questionTemplate.scaleStep,
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

    if (allTasksCompleted) {
      await this.prisma.passportSection.update({
        where: { id: sectionId },
        data: { status: 'COMPLETED' },
      });
      sectionCompleted = true;

      const currentSection = task.passportSection;
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
      }
    }

    return {
      success: true,
      sectionCompleted,
      nextSectionId,
    };
  }
}
