import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Passport,
  PassportSection,
  PassportSectionTask,
  QuestionTemplate,
} from '@prisma/client';
import { TASK_DESCRIPTIONS, TASK_ORDERS } from '../constants/task-metadata';

interface GroupedQuestion {
  sectionKey: string;
  taskKey: string;
  template: QuestionTemplate;
}

@Injectable()
export class PassportService {
  constructor(private prisma: PrismaService) {}

  async getPassport(passportId: string) {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      include: {
        sections: {
          select: {
            id: true,
            key: true,
            title: true,
            status: true,
            order: true,
          },
          orderBy: { order: 'asc' },
        },
      },
    });

    return passport;
  }

  async getPassportSections(passportId: string, userId: string) {
    // Verify passport exists and user has access (owner or collaborator)
    const hasAccess = await this.checkUserAccess(passportId, userId);
    if (!hasAccess) {
      throw new ForbiddenException('You do not have access to this passport');
    }

    // Fetch sections with tasks
    const sections = await this.prisma.passportSection.findMany({
      where: { passportId },
      include: {
        tasks: {
          include: {
            passportQuestions: {
              include: {
                answer: {
                  select: {
                    id: true,
                  },
                },
              },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { order: 'asc' },
    });

    // Transform tasks to include question counts
    const transformedSections = sections.map((section) => ({
      id: section.id,
      key: section.key,
      title: section.title,
      subtitle: section.subtitle,
      description: section.description,
      imageKey: section.imageKey,
      status: section.status,
      order: section.order,
      tasks: section.tasks.map((task) => ({
        id: task.id,
        key: task.key,
        title: task.title,
        description: task.description,
        order: task.order,
        totalQuestions: task.passportQuestions.length,
        answeredQuestions: task.passportQuestions.filter(
          (q) => q.answer !== null,
        ).length,
      })),
    }));

    return transformedSections;
  }

  async createPassport(
    userId: string,
    addressLine1: string,
    postcode: string,
  ): Promise<{ passportId: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User does not exist: ' + userId);

    // Create passport
    const passport = await this.prisma.passport.create({
      data: {
        addressLine1,
        postcode,
        ownerId: userId,
      },
    });

    // Load all question templates
    const templates = await this.prisma.questionTemplate.findMany({
      orderBy: [{ sectionKey: 'asc' }, { taskKey: 'asc' }, { order: 'asc' }],
    });

    // Group templates by section and task
    const groupedBySection = this.groupTemplatesBySection(templates);

    // Fetch section templates ordered by their defined order
    const sectionTemplates = await this.prisma.sectionTemplate.findMany({
      orderBy: { order: 'asc' },
    });

    // Create sections, tasks, and questions using SectionTemplate order
    for (const sectionTemplate of sectionTemplates) {
      const sectionKey = sectionTemplate.key;
      const tasksForSection = groupedBySection.get(sectionKey);

      // Determine section status (first by order is ACTIVE, rest are LOCKED)
      const sectionStatus = sectionTemplate.order === 1 ? 'ACTIVE' : 'LOCKED';

      // Create passport section with template metadata
      const section = await this.prisma.passportSection.create({
        data: {
          passportId: passport.id,
          key: sectionKey,
          title: sectionTemplate.title,
          subtitle: sectionTemplate.subtitle,
          description: sectionTemplate.description,
          imageKey: sectionTemplate.icon,
          order: sectionTemplate.order,
          status: sectionStatus,
        },
      });

      if (!tasksForSection) continue;

      // Sort tasks by TASK_ORDERS before creating them
      const sortedTasks = [...tasksForSection.entries()].sort(
        ([keyA], [keyB]) => {
          const orderA = TASK_ORDERS[sectionKey]?.[keyA] ?? 999;
          const orderB = TASK_ORDERS[sectionKey]?.[keyB] ?? 999;
          return orderA - orderB;
        },
      );

      for (const [taskKey, questions] of sortedTasks) {
        const taskDescription =
          TASK_DESCRIPTIONS[sectionKey]?.[taskKey] || null;
        const taskOrder = TASK_ORDERS[sectionKey]?.[taskKey] || 999;

        // Create task
        const task = await this.prisma.passportSectionTask.create({
          data: {
            passportSectionId: section.id,
            key: taskKey,
            title: this.formatTaskKey(taskKey),
            description: taskDescription,
            order: taskOrder,
          },
        });

        // Create questions for this task
        for (const groupedQ of questions) {
          await this.prisma.passportQuestion.create({
            data: {
              passportSectionTaskId: task.id,
              questionTemplateId: groupedQ.template.id,
            },
          });
        }
      }
    }

    return {
      passportId: passport.id,
    };
  }

  private formatTaskKey(key: string): string {
    return key
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  private groupTemplatesBySection(
    templates: QuestionTemplate[],
  ): Map<string, Map<string, GroupedQuestion[]>> {
    const grouped = new Map<string, Map<string, GroupedQuestion[]>>();

    for (const template of templates) {
      if (!grouped.has(template.sectionKey)) {
        grouped.set(template.sectionKey, new Map());
      }

      const tasksInSection = grouped.get(template.sectionKey)!;

      if (!tasksInSection.has(template.taskKey)) {
        tasksInSection.set(template.taskKey, []);
      }

      tasksInSection.get(template.taskKey)!.push({
        sectionKey: template.sectionKey,
        taskKey: template.taskKey,
        template,
      });
    }

    return grouped;
  }

  // Check if user has access to passport (owner or collaborator)
  async checkUserAccess(passportId: string, userId: string): Promise<boolean> {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      include: {
        collaborators: {
          where: { userId },
        },
      },
    });

    if (!passport) {
      return false;
    }

    // User has access if they are the owner or a collaborator
    return (
      passport.ownerId === userId || passport.collaborators.length > 0
    );
  }

  // Add collaborator by email
  async addCollaborator(passportId: string, requesterId: string, email: string) {
    // Verify requester is the owner
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
    });

    if (!passport) {
      throw new ForbiddenException('Passport not found');
    }

    if (passport.ownerId !== requesterId) {
      throw new ForbiddenException(
        'Only the owner can add collaborators',
      );
    }

    // Find user by email
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new ForbiddenException('User with this email not found');
    }

    // Check if user is already owner
    if (user.id === passport.ownerId) {
      throw new ForbiddenException('User is already the owner');
    }

    // Check if already a collaborator
    const existingCollaborator =
      await this.prisma.passportCollaborator.findUnique({
        where: {
          passportId_userId: {
            passportId,
            userId: user.id,
          },
        },
      });

    if (existingCollaborator) {
      throw new ForbiddenException('User is already a collaborator');
    }

    // Add collaborator
    const collaborator = await this.prisma.passportCollaborator.create({
      data: {
        passportId,
        userId: user.id,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    return {
      message: 'Collaborator added successfully',
      collaborator: {
        id: collaborator.id,
        userId: collaborator.userId,
        email: collaborator.user.email,
        firstName: collaborator.user.firstName,
        lastName: collaborator.user.lastName,
        createdAt: collaborator.createdAt,
      },
    };
  }

  // Get all collaborators for a passport
  async getCollaborators(passportId: string, userId: string) {
    // Verify user has access
    const hasAccess = await this.checkUserAccess(passportId, userId);
    if (!hasAccess) {
      throw new ForbiddenException('You do not have access to this passport');
    }

    const collaborators = await this.prisma.passportCollaborator.findMany({
      where: { passportId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return collaborators.map((c) => ({
      id: c.id,
      userId: c.userId,
      email: c.user.email,
      firstName: c.user.firstName,
      lastName: c.user.lastName,
      createdAt: c.createdAt,
    }));
  }

  // Remove collaborator
  async removeCollaborator(
    passportId: string,
    requesterId: string,
    collaboratorId: string,
  ) {
    // Verify requester is the owner
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
    });

    if (!passport) {
      throw new ForbiddenException('Passport not found');
    }

    if (passport.ownerId !== requesterId) {
      throw new ForbiddenException(
        'Only the owner can remove collaborators',
      );
    }

    // Delete collaborator
    await this.prisma.passportCollaborator.delete({
      where: { id: collaboratorId },
    });

    return {
      message: 'Collaborator removed successfully',
    };
  }
}
