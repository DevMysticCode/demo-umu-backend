import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Passport,
  PassportSection,
  PassportSectionTask,
  QuestionTemplate,
} from '@prisma/client';

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
    // Verify passport exists and belongs to user
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
    });

    if (!passport) {
      throw new ForbiddenException('Passport not found');
    }

    if (passport.ownerId !== userId) {
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
      status: section.status,
      order: section.order,
      tasks: section.tasks.map((task) => ({
        id: task.id,
        key: task.key,
        title: task.title,
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

    // Create sections, tasks, and questions
    let sectionOrder = 0;
    for (const [sectionKey, tasks] of groupedBySection) {
      sectionOrder++;

      // Determine section status (first is ACTIVE, rest are LOCKED)
      const sectionStatus = sectionOrder === 1 ? 'ACTIVE' : 'LOCKED';

      // Fetch section template metadata
      const sectionTemplate = await this.prisma.sectionTemplate.findUnique({
        where: { key: sectionKey },
      });

      // Create passport section with template metadata
      const section = await this.prisma.passportSection.create({
        data: {
          passportId: passport.id,
          key: sectionKey,
          title: sectionTemplate?.title || sectionKey,
          subtitle: sectionTemplate?.subtitle,
          description: sectionTemplate?.description,
          order: sectionOrder,
          status: sectionStatus,
        },
      });

      // Create tasks and questions for this section
      let taskOrder = 0;
      for (const [taskKey, questions] of tasks) {
        taskOrder++;

        // Create task
        const task = await this.prisma.passportSectionTask.create({
          data: {
            passportSectionId: section.id,
            key: taskKey,
            title: this.formatTaskKey(taskKey),
            description: null,
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
}
