import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
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

    // Fetch section templates to get helpContent / helpVideoUrl
    const sectionKeys = sections.map((s) => s.key);
    const sectionTemplates = await this.prisma.sectionTemplate.findMany({
      where: { key: { in: sectionKeys } },
      select: { key: true, helpContent: true, helpVideoUrl: true },
    });
    const sectionTemplateMap = new Map(
      sectionTemplates.map((st) => [st.key, st]),
    );

    // Transform tasks to include question counts
    const transformedSections = sections.map((section) => {
      const template = sectionTemplateMap.get(section.key);
      return {
        id: section.id,
        key: section.key,
        title: section.title,
        subtitle: section.subtitle,
        description: section.description,
        imageKey: section.imageKey,
        status: section.status,
        order: section.order,
        helpContent: template?.helpContent ?? null,
        helpVideoUrl: template?.helpVideoUrl ?? null,
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
      };
    });

    return transformedSections;
  }

  async createPassport(
    userId: string,
    addressLine1: string,
    postcode: string,
    propertyId?: string,
  ): Promise<{ passportId: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User does not exist: ' + userId);

    // Phone is required to become a passport owner (needed for WhatsApp contact)
    if (!user.phone || !user.phone.trim()) {
      throw new BadRequestException(
        'A phone number is required on your profile before claiming a property passport. Please add your phone number in Profile → Personal Information.',
      );
    }

    // If propertyId provided, check if a passport already exists for it
    let propertyTenure: string | null = null;
    if (propertyId) {
      const existing = await this.prisma.passport.findUnique({
        where: { propertyId },
      });
      if (existing) {
        if (existing.ownerId === userId) {
          return { passportId: existing.id };
        }
        throw new ForbiddenException(
          'This property already has a passport owned by another user',
        );
      }
      // Fetch tenure so we can skip the leasehold section for non-leasehold properties
      const prop = await this.prisma.property.findUnique({
        where: { id: propertyId },
        select: { tenure: true },
      });
      propertyTenure = prop?.tenure ?? null;
    }

    const isLeasehold = this.isLeaseholdTenure(propertyTenure);

    // Create passport
    const passport = await this.prisma.passport.create({
      data: {
        addressLine1,
        postcode,
        ownerId: userId,
        ...(propertyId ? { propertyId } : {}),
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

      // Skip the leasehold section for non-leasehold properties
      if (sectionKey === 'leasehold' && !isLeasehold) continue;

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

  /** Returns true for any tenure value that indicates leasehold ownership. */
  private isLeaseholdTenure(tenure: string | null): boolean {
    if (!tenure) return false;
    const t = tenure.toLowerCase();
    return t.includes('leasehold') || t === 'l';
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

  // Get all passports the user owns or collaborates on
  async getUserPassports(userId: string) {
    const owned = await this.prisma.passport.findMany({
      where: { ownerId: userId },
      select: {
        id: true,
        addressLine1: true,
        postcode: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const collaborated = await this.prisma.passportCollaborator.findMany({
      where: { userId },
      include: {
        passport: {
          select: {
            id: true,
            addressLine1: true,
            postcode: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    const result = [...owned];
    for (const c of collaborated) {
      if (!result.find((p) => p.id === c.passport.id)) {
        result.push(c.passport);
      }
    }
    return result;
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
    return passport.ownerId === userId || passport.collaborators.length > 0;
  }

  // Add collaborator by email
  async addCollaborator(
    passportId: string,
    requesterId: string,
    email: string,
  ) {
    // Verify requester is the owner
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
    });

    if (!passport) {
      throw new ForbiddenException('Passport not found');
    }

    if (passport.ownerId !== requesterId) {
      throw new ForbiddenException('Only the owner can add collaborators');
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

  // Delete passport (owner only)
  async deletePassport(passportId: string, userId: string) {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
    });
    if (!passport) throw new NotFoundException('Passport not found');
    if (passport.ownerId !== userId) {
      throw new ForbiddenException('Only the owner can delete this passport');
    }
    await this.prisma.passport.delete({ where: { id: passportId } });
    return { message: 'Passport deleted successfully' };
  }

  // Create buyer access (simulated payment unlock)
  async createBuyerAccess(passportId: string, userId: string) {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
    });
    if (!passport) throw new NotFoundException('Passport not found');

    // Owner already has full access
    if (passport.ownerId === userId) {
      return { passportId };
    }

    // Upsert buyer access record
    await this.prisma.buyerPassportAccess.upsert({
      where: { passportId_userId: { passportId, userId } },
      update: {},
      create: { passportId, userId },
    });

    return { passportId };
  }

  // Get full passport data in buyer-friendly read-only format
  async getBuyerView(passportId: string, userId: string) {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      include: {
        property: true,
        collaborators: { where: { userId } },
        buyerAccesses: { where: { userId } },
        sections: {
          orderBy: { order: 'asc' },
          include: {
            tasks: {
              orderBy: { order: 'asc' },
              include: {
                passportQuestions: {
                  include: {
                    questionTemplate: true,
                    answer: true,
                  },
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    if (!passport) throw new NotFoundException('Passport not found');

    const isOwner = passport.ownerId === userId;
    const isCollaborator = passport.collaborators.length > 0;
    const hasBuyerAccess = passport.buyerAccesses.length > 0;

    if (!isOwner && !isCollaborator && !hasBuyerAccess) {
      throw new ForbiddenException('You do not have access to this passport');
    }

    // Fetch section templates to get helpContent / helpVideoUrl per section
    const sectionKeys = passport.sections.map((s) => s.key);
    const sectionTemplates = await this.prisma.sectionTemplate.findMany({
      where: { key: { in: sectionKeys } },
      select: { key: true, helpContent: true, helpVideoUrl: true },
    });
    const sectionTemplateMap = new Map(
      sectionTemplates.map((st) => [st.key, st]),
    );

    const propertyTenure = (passport.property as any)?.tenure ?? null;
    const isLeasehold = this.isLeaseholdTenure(propertyTenure);

    // Filter out leasehold section for non-leasehold properties
    const visibleSections = passport.sections.filter(
      (s) => s.key !== 'leasehold' || isLeasehold,
    );

    return {
      passport: {
        id: passport.id,
        addressLine1: passport.addressLine1,
        postcode: passport.postcode,
      },
      property: { ...(passport.property as any), isLeasehold },
      sections: visibleSections.map((s) => {
        const template = sectionTemplateMap.get(s.key);
        return {
          id: s.id,
          key: s.key,
          title: s.title,
          subtitle: s.subtitle,
          description: s.description,
          imageKey: s.imageKey,
          order: s.order,
          helpContent: template?.helpContent ?? null,
          helpVideoUrl: template?.helpVideoUrl ?? null,
          tasks: s.tasks.map((t) => ({
            id: t.id,
            key: t.key,
            title: t.title,
            description: t.description,
            order: t.order,
            questions: t.passportQuestions.map((q) => ({
              id: q.id,
              type: q.questionTemplate.type,
              question: q.questionTemplate.title,
              description: q.questionTemplate.description,
              parts: q.questionTemplate.parts,
              options: q.questionTemplate.options,
              fields: q.questionTemplate.fields,
              helpContent: q.questionTemplate.helpContent,
              helpVideoUrl: q.questionTemplate.helpVideoUrl,
              answer: q.answer
                ? {
                    answerText: q.answer.answerText,
                    answerJson: q.answer.answerJson,
                    fileUrl: q.answer.fileUrl,
                    createdAt: q.answer.createdAt,
                  }
                : null,
            })),
          })),
        };
      }),
    };
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
      throw new ForbiddenException('Only the owner can remove collaborators');
    }

    // Delete collaborator
    await this.prisma.passportCollaborator.delete({
      where: { id: collaboratorId },
    });

    return {
      message: 'Collaborator removed successfully',
    };
  }

  async publishPassport(passportId: string, userId: string) {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
    });
    if (!passport) throw new ForbiddenException('Passport not found');
    if (passport.ownerId !== userId)
      throw new ForbiddenException('Only the owner can publish this passport');

    return this.prisma.passport.update({
      where: { id: passportId },
      data: { status: 'PUBLISHED' as any },
      select: { id: true, status: true },
    });
  }

  async unpublishPassport(passportId: string, userId: string) {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
    });
    if (!passport) throw new ForbiddenException('Passport not found');
    if (passport.ownerId !== userId)
      throw new ForbiddenException(
        'Only the owner can unpublish this passport',
      );

    return this.prisma.passport.update({
      where: { id: passportId },
      data: { status: 'IN_PROGRESS' as any },
      select: { id: true, status: true },
    });
  }

  // ── Property Images ──────────────────────────────────────────────────────

  async updatePropertyImages(
    passportId: string,
    userId: string,
    images: string[],
  ) {
    const hasAccess = await this.checkUserAccess(passportId, userId);
    if (!hasAccess)
      throw new ForbiddenException('You do not have access to this passport');

    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      select: { propertyId: true },
    });
    if (!passport) throw new NotFoundException('Passport not found');
    if (!passport.propertyId)
      throw new BadRequestException('This passport has no linked property');

    await this.prisma.property.update({
      where: { id: passport.propertyId },
      data: { images },
    });

    return { images };
  }

  async getPropertyImages(passportId: string, userId: string) {
    const hasAccess = await this.checkUserAccess(passportId, userId);
    if (!hasAccess)
      throw new ForbiddenException('You do not have access to this passport');

    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      select: { propertyId: true },
    });
    if (!passport) throw new NotFoundException('Passport not found');
    if (!passport.propertyId) return { images: [] };

    const property = await this.prisma.property.findUnique({
      where: { id: passport.propertyId },
      select: { images: true },
    });

    return { images: (property?.images as string[]) ?? [] };
  }
}
