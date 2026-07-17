import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentService } from '../payment/payment.service';
import { PushService } from '../push/push.service';
import { ConversationsService } from '../conversations/conversations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertKycVerified } from '../common/kyc';
import {
  Passport,
  PassportSection,
  PassportSectionTask,
  QuestionTemplate,
} from '@prisma/client';
import { TASK_DESCRIPTIONS, TASK_ORDERS } from '../constants/task-metadata';
import OpenAI from 'openai';
import { Resend } from 'resend';

interface GroupedQuestion {
  sectionKey: string;
  taskKey: string;
  template: QuestionTemplate;
}

@Injectable()
export class PassportService {
  private groq: OpenAI;
  private resend: Resend;
  private readonly EMAIL_FROM =
    process.env.RESEND_FROM ?? 'UMovingU <onboarding@resend.dev>';

  constructor(
    private prisma: PrismaService,
    private payments: PaymentService,
    private push: PushService,
    private conversations: ConversationsService,
    private notifications: NotificationsService,
  ) {
    this.groq = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });
    this.resend = new Resend(process.env.RESEND_API_KEY ?? '');
  }

  /**
   * Frontend URL builder for links included in outbound emails. Same
   * env-driven fallback pattern the share-link builder uses so a
   * missing FRONTEND_URL never ships localhost links to real users.
   */
  private frontendBaseUrl(): string {
    return (
      process.env.FRONTEND_URL ??
      (process.env.NODE_ENV === 'production'
        ? 'https://demo-umu-frontend.vercel.app'
        : 'http://localhost:3000')
    );
  }

  private async sendCollaboratorAddedEmail(params: {
    to: string;
    inviteeFirstName: string | null;
    ownerFirstName: string | null;
    ownerLastName: string | null;
    passportId: string;
    propertyAddressLine1: string | null;
    propertyPostcode: string | null;
  }) {
    if (!process.env.RESEND_API_KEY) return; // no-op if email isn't configured
    const link = `${this.frontendBaseUrl()}/passportview/${params.passportId}`;
    const ownerName =
      [params.ownerFirstName, params.ownerLastName].filter(Boolean).join(' ') ||
      'The property owner';
    const propertyLine = [params.propertyAddressLine1, params.propertyPostcode]
      .filter(Boolean)
      .join(', ');
    const greeting = params.inviteeFirstName
      ? `Hi ${params.inviteeFirstName},`
      : 'Hi,';
    try {
      await this.resend.emails.send({
        from: this.EMAIL_FROM,
        to: params.to,
        subject: `${ownerName} added you as a collaborator on their Property Passport`,
        html: `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#ffffff;">
  <h2 style="color:#1f2024;font-size:22px;margin:0 0 12px;">You've been added as a collaborator</h2>
  <p style="color:#4a4b52;font-size:15px;line-height:1.55;margin:0 0 16px;">${greeting}</p>
  <p style="color:#4a4b52;font-size:15px;line-height:1.55;margin:0 0 20px;">
    <strong>${ownerName}</strong> has added you as a collaborator on the Property Passport
    ${propertyLine ? `for <strong>${propertyLine}</strong>` : ''}.
    You can now view and help complete the passport.
  </p>
  <div style="text-align:center;margin:28px 0;">
    <a href="${link}" style="display:inline-block;background:#00a19a;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:700;font-size:15px;">Open the Passport</a>
  </div>
  <p style="color:#8f9094;font-size:13px;line-height:1.5;margin:0;">If the button doesn't work, paste this link into your browser:<br/><span style="word-break:break-all;color:#00857f;">${link}</span></p>
  <hr style="border:none;border-top:1px solid #e5e5ea;margin:24px 0;" />
  <p style="color:#b4b5b8;font-size:11px;text-align:center;margin:0;">You're receiving this because ${ownerName} added you on UMovingU.</p>
</div>`,
      });
    } catch (err) {
      // Non-blocking: collaborator record is already saved.
      // eslint-disable-next-line no-console
      console.warn(`[collaborator email] add failed for ${params.to}: ${(err as Error).message}`);
    }
  }

  private async sendCollaboratorRemovedEmail(params: {
    to: string;
    inviteeFirstName: string | null;
    ownerFirstName: string | null;
    ownerLastName: string | null;
    propertyAddressLine1: string | null;
    propertyPostcode: string | null;
  }) {
    if (!process.env.RESEND_API_KEY) return;
    const ownerName =
      [params.ownerFirstName, params.ownerLastName].filter(Boolean).join(' ') ||
      'The property owner';
    const propertyLine = [params.propertyAddressLine1, params.propertyPostcode]
      .filter(Boolean)
      .join(', ');
    const greeting = params.inviteeFirstName
      ? `Hi ${params.inviteeFirstName},`
      : 'Hi,';
    try {
      await this.resend.emails.send({
        from: this.EMAIL_FROM,
        to: params.to,
        subject: `Your access to a Property Passport was removed`,
        html: `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#ffffff;">
  <h2 style="color:#1f2024;font-size:22px;margin:0 0 12px;">Access removed</h2>
  <p style="color:#4a4b52;font-size:15px;line-height:1.55;margin:0 0 16px;">${greeting}</p>
  <p style="color:#4a4b52;font-size:15px;line-height:1.55;margin:0 0 20px;">
    <strong>${ownerName}</strong> has removed your collaborator access
    ${propertyLine ? `to the Property Passport for <strong>${propertyLine}</strong>` : 'to their Property Passport'}.
    You can no longer view or edit the passport.
  </p>
  <p style="color:#8f9094;font-size:13px;line-height:1.5;margin:0;">If you think this is a mistake, please get in touch with the property owner directly.</p>
  <hr style="border:none;border-top:1px solid #e5e5ea;margin:24px 0;" />
  <p style="color:#b4b5b8;font-size:11px;text-align:center;margin:0;">You're receiving this because ${ownerName} removed you on UMovingU.</p>
</div>`,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[collaborator email] remove failed for ${params.to}: ${(err as Error).message}`);
    }
  }

  async getPassport(passportId: string) {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      include: {
        // Sibling passports created via convert-to-seller — used by the
        // landlord view to surface a "Selling passport linked" CTA.
        convertedTo: { select: { id: true, type: true } },
        sections: {
          orderBy: { order: 'asc' },
          include: {
            tasks: {
              orderBy: { order: 'asc' },
              include: {
                passportQuestions: {
                  include: {
                    questionTemplate: {
                      select: { id: true, type: true, title: true, description: true },
                    },
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
    opts: { type?: 'SELLER' | 'LANDLORD'; isHmo?: boolean; convertedFromId?: string } = {},
  ): Promise<{ passportId: string }> {
    const passportType = opts.type ?? 'SELLER';
    const isHmo = !!opts.isHmo;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User does not exist: ' + userId);

    // Phone is required to become a passport owner (needed for WhatsApp contact)
    if (!user.phone || !user.phone.trim()) {
      throw new BadRequestException(
        'A phone number is required on your profile before claiming a property passport. Please add your phone number in Profile → Personal Information.',
      );
    }

    // Manual claim: at most one passport per (owner, property, type). Convert
    // flow bypasses this naturally — its target type is SELLER and the source
    // landlord passport sits on the same property unchanged.
    let propertyTenure: string | null = null;
    if (propertyId) {
      const existingSameType = await this.prisma.passport.findFirst({
        where: { propertyId, type: passportType as any },
      });
      if (existingSameType) {
        if (existingSameType.ownerId === userId) {
          // Returning the user's OWN existing passport — no KYC needed,
          // they already cleared it when they first claimed.
          return { passportId: existingSameType.id };
        }
        throw new ForbiddenException(
          'This property already has a passport of this type owned by another user',
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

    // KYC gate. Claiming a property creates a verified-owner relationship
    // with a real address — we need to know the claimant is who they
    // say they are before HMLR ownership verification, TA6 generation,
    // and buyer-side trust signals downstream. Returning an existing
    // owned passport (above) skips this — that user already cleared it.
    assertKycVerified(user);

    // Create passport
    const passport = await this.prisma.passport.create({
      data: {
        addressLine1,
        postcode,
        ownerId: userId,
        type: passportType as any,
        isHmo,
        ...(opts.convertedFromId ? { convertedFromId: opts.convertedFromId } : {}),
        ...(propertyId ? { propertyId } : {}),
      },
    });

    // Belt-and-braces filter: prefer the section/template `type` column, but
    // also gate by key prefix so a landlord passport can never accidentally
    // be seeded with seller sections (or vice-versa) if the type column is
    // wrong / missing. Landlord templates use the `landlord_` prefix.
    const isLandlord = passportType === 'LANDLORD';
    const keyPrefixMatches = (key: string) =>
      isLandlord ? key.startsWith('landlord_') : !key.startsWith('landlord_');

    const allTemplates = await this.prisma.questionTemplate.findMany({
      orderBy: [{ sectionKey: 'asc' }, { taskKey: 'asc' }, { order: 'asc' }],
    });
    const templates = allTemplates.filter((t) => keyPrefixMatches(t.sectionKey));

    // Group templates by section and task
    const groupedBySection = this.groupTemplatesBySection(templates);

    // Fetch section templates in display order, then filter by key prefix.
    const allSectionTemplates = await this.prisma.sectionTemplate.findMany({
      orderBy: { order: 'asc' },
    });
    const sectionTemplates = allSectionTemplates.filter((st) =>
      keyPrefixMatches(st.key),
    );

    // Create sections, tasks, and questions using SectionTemplate order
    for (const sectionTemplate of sectionTemplates) {
      const sectionKey = sectionTemplate.key;
      const tasksForSection = groupedBySection.get(sectionKey);

      // Skip the leasehold section for non-leasehold properties (seller only)
      if (sectionKey === 'leasehold' && !isLeasehold) continue;

      // Skip conditional sections that don't match this passport's flags.
      // Currently only "isHmo" is wired (PAT testing, HMO licence).
      if (sectionTemplate.conditionalKey === 'isHmo' && !isHmo) continue;

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

  /**
   * Landlord → Seller conversion. Creates a SELLER passport on the same
   * property (the unique constraint allows it because type differs), links
   * it back to the source landlord passport via convertedFromId, and pre-
   * marks the seller passport's "transferable" sections as ACTIVE so the UI
   * can badge them with "transferred from your letting passport".
   *
   * The two passports remain independent — editing one does not change the
   * other. Either can be deleted later without affecting its sibling.
   */
  async convertLandlordToSeller(
    landlordPassportId: string,
    userId: string,
  ): Promise<{ passportId: string; transferredSectionKeys: string[] }> {
    const source = await this.prisma.passport.findUnique({
      where: { id: landlordPassportId },
    });
    if (!source) throw new NotFoundException('Landlord passport not found');
    if (source.ownerId !== userId) {
      throw new ForbiddenException('You do not own this passport');
    }
    if (source.type !== 'LANDLORD') {
      throw new BadRequestException(
        'Only landlord passports can be converted to seller passports',
      );
    }

    // Refuse if a seller passport already exists for this property + owner.
    if (source.propertyId) {
      const existingSeller = await this.prisma.passport.findFirst({
        where: {
          ownerId: userId,
          propertyId: source.propertyId,
          type: 'SELLER',
        },
      });
      if (existingSeller) {
        return {
          passportId: existingSeller.id,
          transferredSectionKeys: [],
        };
      }
    }

    // Create the new seller passport in the standard way.
    const created = await this.createPassport(
      userId,
      source.addressLine1,
      source.postcode,
      source.propertyId ?? undefined,
      { type: 'SELLER', convertedFromId: source.id },
    );

    // Section keys that carry compliance/insurance data over from letting
    // into the seller passport's "transferable" sections. These match the
    // transfer map in the prototype landlord-passport1.html.
    const transferableSourceKeys = ['gas', 'eicr', 'epc', 'alarms', 'insurance', 'rtr'];
    const transferableTargetKeys = [
      'services',
      'environmental',
      'insurance', // seller-side insurance section key
      'occupiers',
    ];

    // Mark target sections as ACTIVE so they're highlighted in the seller
    // passport view as "transferred — review and confirm".
    await this.prisma.passportSection.updateMany({
      where: {
        passportId: created.passportId,
        key: { in: transferableTargetKeys },
      },
      data: { status: 'ACTIVE' as any },
    });

    return {
      passportId: created.passportId,
      transferredSectionKeys: transferableSourceKeys.filter(Boolean),
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

  // Get all passports the user owns or collaborates on. Each row is
  // tagged with `isOwner` so the collections screen can gate destructive
  // actions (only the owner can delete a passport; a collaborator has
  // edit rights but not admin rights).
  async getUserPassports(userId: string) {
    const owned = await this.prisma.passport.findMany({
      where: { ownerId: userId },
      select: {
        id: true,
        addressLine1: true,
        postcode: true,
        status: true,
        type: true,
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
            type: true,
            createdAt: true,
          },
        },
      },
    });

    const result: Array<
      (typeof owned)[number] & { isOwner: boolean }
    > = owned.map((p) => ({ ...p, isOwner: true }));
    for (const c of collaborated) {
      if (!result.find((p) => p.id === c.passport.id)) {
        result.push({ ...c.passport, isOwner: false });
      }
    }
    return result;
  }

  // Get all the user's purchased buyer-access records (the "Watching" list)
  async getBuyerAccessList(userId: string) {
    const rows = await this.prisma.buyerPassportAccess.findMany({
      where: { userId },
      include: {
        passport: {
          select: {
            id: true,
            addressLine1: true,
            postcode: true,
            status: true,
            propertyId: true,
            property: {
              select: {
                id: true,
                imageUrl: true,
                addressLine1: true,
                postcode: true,
                bedrooms: true,
                propertyType: true,
                epcRating: true,
              },
            },
          },
        },
      },
      orderBy: { unlockedAt: 'desc' },
    });

    return rows.map((r) => ({
      id: r.id,
      passportId: r.passportId,
      propertyId: r.passport?.propertyId ?? null,
      addressLine1: r.passport?.addressLine1 ?? '',
      postcode: r.passport?.postcode ?? '',
      status: r.passport?.status ?? null,
      property: r.passport?.property ?? null,
      purchasedAt: r.unlockedAt,
    }));
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

    // Fire-and-forget so push latency never blocks the API response.
    // PushService no-ops if Firebase isn't configured, so this is safe
    // in dev / before the FCM credential lands in Secrets Manager.
    void this.push.send(user.id, {
      title: 'You were invited to a passport',
      body: 'Tap to open the passport you can now collaborate on.',
      data: { kind: 'collaborator_invite', passportId },
    });

    // Also notify by email so the invitee sees the invitation in
    // their inbox even if push is off / device isn't registered.
    // Fetch the owner + property once so the email can carry the
    // "who added you" + "which property" context.
    void (async () => {
      const [owner, property] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: requesterId },
          select: { firstName: true, lastName: true },
        }),
        passport.propertyId
          ? this.prisma.property.findUnique({
              where: { id: passport.propertyId },
              select: { addressLine1: true, postcode: true },
            })
          : Promise.resolve(null),
      ]);
      await this.sendCollaboratorAddedEmail({
        to: user.email,
        inviteeFirstName: user.firstName,
        ownerFirstName: owner?.firstName ?? null,
        ownerLastName: owner?.lastName ?? null,
        passportId,
        propertyAddressLine1: property?.addressLine1 ?? null,
        propertyPostcode: property?.postcode ?? null,
      });
    })();

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

  // ── Resume tracking ─────────────────────────────────────────────────
  // Records the most recently visited task on the passport so the
  // "Pick up where you left off" CTA can route the user back. Owner or
  // any collaborator may update it; we simply require they have access.
  async setLastVisited(passportId: string, userId: string, taskId: string) {
    if (!taskId) throw new BadRequestException('taskId is required');

    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      select: { id: true, ownerId: true },
    });
    if (!passport) throw new NotFoundException('Passport not found');

    if (passport.ownerId !== userId) {
      const collab = await this.prisma.passportCollaborator.findFirst({
        where: { passportId, userId },
        select: { id: true },
      });
      if (!collab) throw new ForbiddenException('No access to this passport');
    }

    await (this.prisma.passport as any).update({
      where: { id: passportId },
      data: {
        lastVisitedTaskId: taskId,
        lastVisitedAt: new Date(),
      },
    });
    return { ok: true };
  }

  // Resolves where to send the user next:
  //  1. If the recorded last-visited task is still incomplete → that task.
  //  2. If complete → the next incomplete task in the same section.
  //  3. If the section is finished → the first incomplete task in any
  //     remaining section (in section order).
  //  4. If everything is complete → null.
  async getResumeTarget(passportId: string, userId: string) {
    const passport = await (this.prisma.passport as any).findUnique({
      where: { id: passportId },
      select: { id: true, ownerId: true, lastVisitedTaskId: true },
    });
    if (!passport) throw new NotFoundException('Passport not found');
    if (passport.ownerId !== userId) {
      const collab = await this.prisma.passportCollaborator.findFirst({
        where: { passportId, userId },
        select: { id: true },
      });
      if (!collab) throw new ForbiddenException('No access to this passport');
    }

    const sections = await this.prisma.passportSection.findMany({
      where: { passportId },
      orderBy: { order: 'asc' },
      include: {
        tasks: {
          orderBy: { order: 'asc' },
          select: { id: true, status: true, passportSectionId: true },
        },
      },
    });

    if (!sections.length) return { target: null };

    const isIncomplete = (t: { status: string }) => t.status !== 'COMPLETED';

    const findTaskWithSection = (taskId: string) => {
      for (const s of sections) {
        const t = s.tasks.find((x) => x.id === taskId);
        if (t) return { section: s, task: t };
      }
      return null;
    };

    const lastTaskId = (passport as any).lastVisitedTaskId as string | null;

    // 1. Recorded task still incomplete?
    if (lastTaskId) {
      const found = findTaskWithSection(lastTaskId);
      if (found && isIncomplete(found.task)) {
        return {
          target: {
            sectionId: found.section.id,
            taskId: found.task.id,
            reason: 'last-visited',
          },
        };
      }
      // 2. Same section, next incomplete task
      if (found) {
        const next = found.section.tasks.find(isIncomplete);
        if (next) {
          return {
            target: {
              sectionId: found.section.id,
              taskId: next.id,
              reason: 'next-in-section',
            },
          };
        }
      }
    }

    // 3. First incomplete task across all remaining sections
    for (const s of sections) {
      const next = s.tasks.find(isIncomplete);
      if (next) {
        return {
          target: {
            sectionId: s.id,
            taskId: next.id,
            reason: lastTaskId ? 'next-section' : 'first-task',
          },
        };
      }
    }

    // 4. Everything complete
    return { target: null };
  }

  // Grant buyer access to a passport — gated on KYC verification +
  // a successful Stripe payment for this (user, passport) pair.
  //
  // Until DF4 Finding #1 was closed, this endpoint upserted access
  // unconditionally — any authenticated user could POST and get a free
  // unlock. The check is now belt-and-braces:
  //   1. Owner of the passport? Pass through (no KYC/payment needed —
  //      they already own it).
  //   2. Already has buyer access? Idempotent return (refreshes / shouldn't
  //      double-charge if Stripe replays a webhook).
  //   3. KYC check (Persona). Buyer-side trust signal — a paying buyer
  //      gets unlocked seller/landlord PII (address, photos, documents);
  //      we want a real identity attached to that access. Thrown BEFORE
  //      the payment check so we don't charge users we can't unlock.
  //   4. PaymentService.hasSuccessfulPayment() consults the DB; if no
  //      succeeded row, falls through to a synchronous Stripe API check
  //      so a slow webhook doesn't block a paying user. Throws 403 if
  //      still no successful payment is found.
  /**
   * Owner (or collaborator) shares this passport with a specific buyer.
   * Opens or reuses a passport_match conversation between them and
   * posts a share_passport system card the buyer can act on.
   *
   * Critically: this does NOT grant BuyerPassportAccess. The card just
   * prompts the buyer to unlock via the existing paid flow
   * (POST /passport/:id/buyer-unlock) or, if they already have access,
   * renders as a direct link into the passport. The paid gate is
   * preserved end-to-end — sharing a passport is a marketing nudge,
   * not a bypass.
   */
  async sharePassportWithBuyer(
    passportId: string,
    fromUserId: string,
    toUserId: string,
    note?: string,
  ) {
    if (fromUserId === toUserId) {
      throw new BadRequestException(
        'You cannot share this passport with yourself.',
      );
    }
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      include: {
        property: {
          select: { addressLine1: true, postcode: true },
        },
        collaborators: { select: { userId: true } },
      },
    });
    if (!passport) throw new NotFoundException('Passport not found');

    const isOwner = passport.ownerId === fromUserId;
    const isCollaborator = passport.collaborators.some(
      (c) => c.userId === fromUserId,
    );
    if (!isOwner && !isCollaborator) {
      throw new ForbiddenException(
        'Only the passport owner or a collaborator can share it.',
      );
    }

    // Does the recipient already have paid access? If yes the card
    // renders as a direct "View passport" quick-link; if no, it
    // renders as a "Preview + unlock" prompt. Storing this on the
    // payload lets the frontend decide without a second round-trip.
    const existingAccess = await this.prisma.buyerPassportAccess.findUnique({
      where: { passportId_userId: { passportId, userId: toUserId } },
    });
    const hasAccess = !!existingAccess;

    const conversation = await this.conversations.findOrCreate({
      context: 'passport_match',
      contextId: passportId,
      participants: [
        { userId: fromUserId, role: isOwner ? 'owner' : 'collaborator' },
        { userId: toUserId, role: 'buyer' },
      ],
    });

    const senderNameRow = await this.prisma.user.findUnique({
      where: { id: fromUserId },
      select: { firstName: true, lastName: true },
    });
    const senderName =
      [senderNameRow?.firstName, senderNameRow?.lastName]
        .filter(Boolean)
        .join(' ') || 'The owner';

    const address = passport.property?.addressLine1 ?? passport.addressLine1;

    await this.conversations.sendMessage({
      conversationId: conversation.id,
      senderId: fromUserId,
      body:
        note?.trim() ||
        (hasAccess
          ? `${senderName} shared this passport with you.`
          : `${senderName} shared this passport. Unlock full access to view every section.`),
      kind: 'share_passport',
      payload: {
        passportId,
        propertyId: passport.propertyId,
        propertyAddress: address,
        postcode: passport.property?.postcode ?? passport.postcode,
        hasAccess,
      },
      skipNotification: true,
    });

    await this.notifications.sendNotification({
      userId: toUserId,
      type: 'passport_shared',
      title: `${senderName} shared a Property Passport with you`,
      body: address ?? 'Open to view or unlock full access.',
      actionUrl: `/inbox/${conversation.id}`,
      entityType: 'passport',
      entityId: passportId,
      data: {
        conversationId: conversation.id,
        passportId,
      },
      email: {
        subject: `${senderName} shared a Property Passport with you`,
        html: `<p>${senderName} shared the passport for <strong>${
          address ?? 'a property'
        }</strong> with you.</p><p>Open UMovingU to ${
          hasAccess ? 'view it directly' : 'preview and unlock full access'
        }.</p>`,
      },
    });

    return { conversationId: conversation.id, hasAccess };
  }

  async createBuyerAccess(passportId: string, userId: string) {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      select: { id: true, ownerId: true },
    });
    if (!passport) throw new NotFoundException('Passport not found');

    if (passport.ownerId === userId) {
      return { passportId };
    }

    const existing = await this.prisma.buyerPassportAccess.findUnique({
      where: { passportId_userId: { passportId, userId } },
    });
    if (existing) {
      return { passportId };
    }

    // KYC must come BEFORE payment — never take money from a user we
    // can't immediately unlock. The user's row is fetched once and
    // re-used so we don't double-query Prisma for the same record.
    const buyerUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, kycStatus: true },
    });
    if (!buyerUser) throw new NotFoundException('User not found');
    assertKycVerified(buyerUser);

    const paid = await this.payments.hasSuccessfulPayment(userId, passportId);
    if (!paid) {
      // Returning 402 Payment Required is the explicit status for "your
      // request can't be served until you pay". Nest maps the message
      // string into the body so the frontend can render a useful copy.
      throw new ForbiddenException(
        'Payment required — call POST /payment/create-intent first and complete the Stripe charge.',
      );
    }

    await this.prisma.buyerPassportAccess.create({
      data: { passportId, userId },
    });

    // Notify the owner that a buyer just unlocked their passport —
    // a high-signal event that justifies a push interruption. Errors
    // are swallowed by PushService.send so this can't fail the
    // unlock that the buyer just paid for.
    void this.push.send(passport.ownerId, {
      title: 'A buyer unlocked your passport',
      body: 'Someone just paid to access your property passport.',
      data: { kind: 'buyer_unlocked', passportId },
    });

    return { passportId };
  }

  // Get full passport data in buyer-friendly read-only format
  async getBuyerView(passportId: string, userId: string) {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      include: {
        property: true,
        owner: { select: { id: true, firstName: true, lastName: true, email: true } },
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

    const owner = (passport as any).owner;
    const ownerName = [owner?.firstName, owner?.lastName].filter(Boolean).join(' ') || owner?.email || '';

    return {
      passport: {
        id: passport.id,
        addressLine1: passport.addressLine1,
        postcode: passport.postcode,
        ownerName,
        // Flag surfaced to the frontend so the buyer-passport page
        // can offer an owner-only "Switch to Seller view" toggle
        // (owners occasionally land on this route via a share link
        // or historical navigation and can't otherwise flip back
        // to their editable seller passport). Also drives whether
        // buyer-specific CTAs like "Save to Profile" / "Ask the
        // seller" render — the owner shouldn't be asking themself.
        isOwner,
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
      include: {
        property: { select: { addressLine1: true, postcode: true } },
      },
    });

    if (!passport) {
      throw new ForbiddenException('Passport not found');
    }

    if (passport.ownerId !== requesterId) {
      throw new ForbiddenException('Only the owner can remove collaborators');
    }

    // Fetch the collaborator's user info BEFORE deletion so we can
    // still notify them by email afterwards. Without this we'd have
    // to keep the row around to know where to write.
    const collaborator = await this.prisma.passportCollaborator.findUnique({
      where: { id: collaboratorId },
      include: {
        user: {
          select: { email: true, firstName: true },
        },
      },
    });

    // Delete collaborator
    await this.prisma.passportCollaborator.delete({
      where: { id: collaboratorId },
    });

    // Notify the (now-former) collaborator by email so they aren't
    // surprised when they lose access. Fire-and-forget so email
    // latency doesn't hold the API response.
    if (collaborator?.user?.email) {
      void (async () => {
        const owner = await this.prisma.user.findUnique({
          where: { id: requesterId },
          select: { firstName: true, lastName: true },
        });
        await this.sendCollaboratorRemovedEmail({
          to: collaborator.user.email,
          inviteeFirstName: collaborator.user.firstName,
          ownerFirstName: owner?.firstName ?? null,
          ownerLastName: owner?.lastName ?? null,
          propertyAddressLine1: passport.property?.addressLine1 ?? null,
          propertyPostcode: passport.property?.postcode ?? null,
        });
      })();
    }

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

    const updated = await this.prisma.passport.update({
      where: { id: passportId },
      data: { status: 'PUBLISHED' as any },
      select: { id: true, status: true },
    });
    await this.logActivity(passportId, {
      type: 'PUBLISHED',
      title: 'Passport published — live to buyers',
      actor: 'You',
      icon: '🚀',
    });
    return updated;
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

    const updated = await this.prisma.passport.update({
      where: { id: passportId },
      data: { status: 'IN_PROGRESS' as any },
      select: { id: true, status: true },
    });
    await this.logActivity(passportId, {
      type: 'UNPUBLISHED',
      title: 'Passport unpublished — back to private',
      actor: 'You',
      icon: '🔒',
    });
    return updated;
  }

  // ── Timeline / activity ledger ─────────────────────────────────────────
  // Pseudo block-hash for the verified stamp — visual only (matches the
  // prototype's "0x….." chip). Tamper-evidence in real terms comes from the
  // immutable row + createdAt; the hash is for display.
  private pseudoHash(): string {
    const hex = '0123456789abcdef';
    const rand = (n: number) =>
      Array.from({ length: n }, () => hex[Math.floor(Math.random() * 16)]).join('');
    return `0x${rand(4)}…${rand(2)}`;
  }

  /** Internal helper: write an event to the timeline. */
  async logActivity(
    passportId: string,
    entry: {
      type: string;
      title: string;
      actor: string;
      icon?: string;
      metadata?: any;
    },
  ): Promise<void> {
    try {
      await this.prisma.passportActivity.create({
        data: {
          passportId,
          type: entry.type,
          title: entry.title,
          actor: entry.actor,
          icon: entry.icon ?? null,
          hash: this.pseudoHash(),
          metadata: entry.metadata ?? undefined,
        },
      });
    } catch {
      // Best-effort — never block the parent action on a logging failure.
    }
  }

  async getPassportTimeline(passportId: string, userId: string) {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      include: { collaborators: { where: { userId }, select: { id: true } } },
    });
    if (!passport) throw new ForbiddenException('Passport not found');
    const isOwner = passport.ownerId === userId;
    const isCollab = (passport as any).collaborators?.length > 0;
    const isPublished = (passport.status as any) === 'PUBLISHED';
    if (!isOwner && !isCollab && !isPublished) {
      throw new ForbiddenException('Not authorised to view this timeline');
    }

    let events = await this.prisma.passportActivity.findMany({
      where: { passportId },
      orderBy: { createdAt: 'desc' },
    });

    // Seed an "issued" event the first time we read the timeline so a brand-new
    // passport doesn't show an empty ledger.
    if (events.length === 0) {
      await this.logActivity(passportId, {
        type: 'ISSUED',
        title: 'Property Passport issued',
        actor: 'UmovingU',
        icon: '📕',
      });
      events = await this.prisma.passportActivity.findMany({
        where: { passportId },
        orderBy: { createdAt: 'desc' },
      });
    }

    // Stage tracker (prototype's "Where this sale is" stepper).
    const STAGES = [
      'Issued',
      'Matched',
      'Published',
      'Offer',
      'Exchange',
      'Complete',
    ];
    let stageIdx = 0;
    if (events.some((e) => e.type === 'ISSUED')) stageIdx = Math.max(stageIdx, 0);
    if (events.some((e) => e.type === 'MATCHED')) stageIdx = Math.max(stageIdx, 1);
    if (isPublished || events.some((e) => e.type === 'PUBLISHED')) {
      stageIdx = Math.max(stageIdx, 2);
    }
    if (events.some((e) => e.type === 'OFFER')) stageIdx = Math.max(stageIdx, 3);
    if (events.some((e) => e.type === 'EXCHANGE')) stageIdx = Math.max(stageIdx, 4);
    if (events.some((e) => e.type === 'COMPLETE')) stageIdx = Math.max(stageIdx, 5);

    return {
      stages: STAGES,
      stageIdx,
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        title: e.title,
        actor: e.actor,
        icon: e.icon,
        hash: e.hash,
        createdAt: e.createdAt,
      })),
    };
  }

  // ── Vault (section visibility) ─────────────────────────────────────────
  async getPassportVault(passportId: string, userId: string) {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      include: {
        collaborators: { where: { userId }, select: { id: true } },
        sections: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            key: true,
            title: true,
            imageKey: true,
            status: true,
            visibility: true,
          },
        },
      } as any,
    });
    if (!passport) throw new ForbiddenException('Passport not found');
    const isOwner = passport.ownerId === userId;
    const isCollab = (passport as any).collaborators?.length > 0;
    if (!isOwner && !isCollab) {
      throw new ForbiddenException('Not authorised to view this vault');
    }
    return { sections: (passport as any).sections };
  }

  async setSectionVisibility(
    sectionId: string,
    userId: string,
    visibility: 'PUBLIC' | 'PRIVATE',
  ) {
    if (visibility !== 'PUBLIC' && visibility !== 'PRIVATE') {
      throw new ForbiddenException('Invalid visibility value');
    }
    const section = await this.prisma.passportSection.findUnique({
      where: { id: sectionId },
      include: {
        passport: {
          select: {
            id: true,
            ownerId: true,
            collaborators: { where: { userId }, select: { id: true } },
          },
        },
      } as any,
    });
    if (!section) throw new ForbiddenException('Section not found');
    const p: any = (section as any).passport;
    const isOwner = p?.ownerId === userId;
    const isCollab = p?.collaborators?.length > 0;
    if (!isOwner && !isCollab) {
      throw new ForbiddenException('Not authorised to change visibility');
    }
    const updated = await this.prisma.passportSection.update({
      where: { id: sectionId },
      data: { visibility: visibility as any },
      select: { id: true, key: true, title: true, visibility: true },
    });
    await this.logActivity(p.id, {
      type: visibility === 'PRIVATE' ? 'SECTION_PRIVATE' : 'SECTION_PUBLIC',
      title:
        visibility === 'PRIVATE'
          ? `${updated.title} set to Private — kept out of the published Passport`
          : `${updated.title} set to Public — will publish with the Passport`,
      actor: 'You',
      icon: visibility === 'PRIVATE' ? '🔒' : '🌐',
      metadata: { sectionKey: updated.key },
    });
    return updated;
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

  // ── Comparables ─────────────────────────────────────────────────────────

  async getComparables(passportId: string, userId: string) {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      include: { buyerAccesses: { where: { userId } }, collaborators: { where: { userId } } },
    });
    if (!passport) throw new NotFoundException('Passport not found');
    const isOwner = passport.ownerId === userId;
    if (!isOwner && !passport.collaborators.length && !passport.buyerAccesses.length) {
      throw new ForbiddenException('Access denied');
    }

    const postcode = passport.postcode.replace(/\s+/g, '').toUpperCase();
    // Match on postcode sector (e.g. "TW181" from "TW18 1AB") for nearby results
    const sector = postcode.slice(0, -2);

    const rows = await this.prisma.pricePaidTransaction.findMany({
      where: {
        postcode: { startsWith: sector },
      },
      orderBy: { transactionDate: 'desc' },
      take: 6,
      select: {
        price: true,
        transactionDate: true,
        postcode: true,
        propertyType: true,
        paon: true,
        street: true,
        town: true,
        tenure: true,
      },
    });

    const typeMap: Record<string, string> = {
      D: 'Detached', S: 'Semi-detached', T: 'Terraced', F: 'Flat/Maisonette', O: 'Other',
    };
    const tenureMap: Record<string, string> = { F: 'Freehold', L: 'Leasehold', U: 'Unknown' };

    return rows.map((r) => ({
      price: r.price,
      date: r.transactionDate,
      postcode: r.postcode,
      address: [r.paon, r.street, r.town].filter(Boolean).join(', '),
      propertyType: typeMap[r.propertyType ?? ''] ?? r.propertyType ?? 'Property',
      tenure: tenureMap[r.tenure ?? ''] ?? r.tenure ?? null,
    }));
  }

  // ── Share Link ───────────────────────────────────────────────────────────

  async createShareLink(
    passportId: string,
    userId: string,
    scope: 'buyer' | 'tenant' = 'buyer',
  ) {
    const passport = await this.prisma.passport.findUnique({ where: { id: passportId } });
    if (!passport) throw new NotFoundException('Passport not found');
    const isOwner = passport.ownerId === userId;
    const isCollaborator = await this.prisma.passportCollaborator.findFirst({
      where: { passportId, userId },
    });
    const isBuyer = await this.prisma.buyerPassportAccess.findFirst({
      where: { passportId, userId },
    });
    if (!isOwner && !isCollaborator && !isBuyer) {
      throw new ForbiddenException('Access denied');
    }

    // Tenant scope only makes sense for landlord passports.
    if (scope === 'tenant' && passport.type !== 'LANDLORD') {
      throw new BadRequestException(
        'Tenant share is only available on landlord passports.',
      );
    }

    const token = require('crypto').randomUUID() as string;
    const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000); // 3 hours

    await this.prisma.sharedPassportLink.create({
      data: { passportId, token, expiresAt, scope },
    });

    // Prefer the explicit env var; otherwise fall back to the
    // production Vercel host in non-dev environments. Localhost was
    // the previous fallback which shipped through to the mobile
    // share sheet on prod when FRONTEND_URL wasn't set on Railway.
    const baseUrl =
      process.env.FRONTEND_URL ??
      (process.env.NODE_ENV === 'production'
        ? 'https://demo-umu-frontend.vercel.app'
        : 'http://localhost:3000');
    const url =
      scope === 'tenant'
        ? `${baseUrl}/shared-tenant/${token}`
        : `${baseUrl}/shared/${token}`;
    return { token, url, expiresAt, scope };
  }

  async getSharedPassport(token: string) {
    const link = await this.prisma.sharedPassportLink.findUnique({
      where: { token },
      include: { passport: true },
    });
    if (!link) throw new NotFoundException('Share link not found');
    if (link.expiresAt < new Date()) {
      await this.prisma.sharedPassportLink.delete({ where: { token } });
      throw new ForbiddenException('This share link has expired');
    }

    const passportId = link.passportId;
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      include: {
        property: true,
        sections: {
          orderBy: { order: 'asc' },
          include: {
            tasks: {
              orderBy: { order: 'asc' },
              include: {
                passportQuestions: {
                  include: { questionTemplate: true, answer: true },
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
      },
    });
    if (!passport) throw new NotFoundException('Passport not found');

    const sectionKeys = passport.sections.map((s) => s.key);
    const sectionTemplates = await this.prisma.sectionTemplate.findMany({
      where: { key: { in: sectionKeys } },
      select: { key: true, helpContent: true, helpVideoUrl: true },
    });
    const stMap = new Map(sectionTemplates.map((st) => [st.key, st]));

    const propertyTenure = (passport.property as any)?.tenure ?? null;
    const isLeasehold = this.isLeaseholdTenure(propertyTenure);

    // Tenant-scoped shares of a landlord passport only expose the docs the
    // tenant is legally entitled to or that they need to keep on hand.
    const TENANT_VISIBLE_SECTIONS = new Set([
      'landlord_ast',
      'landlord_deposit',
      'landlord_how_to_rent',
      'landlord_right_to_rent',
      'landlord_gas_safety',
      'landlord_eicr',
      'landlord_epc',
    ]);

    const visibleSections = passport.sections.filter((s) => {
      if (s.key === 'leasehold' && !isLeasehold) return false;
      if (link.scope === 'tenant' && !TENANT_VISIBLE_SECTIONS.has(s.key)) return false;
      return true;
    });

    return {
      passport: { id: passport.id, addressLine1: passport.addressLine1, postcode: passport.postcode },
      property: { ...(passport.property as any), isLeasehold },
      expiresAt: link.expiresAt,
      sections: visibleSections.map((s) => {
        const tpl = stMap.get(s.key);
        return {
          id: s.id, key: s.key, title: s.title, subtitle: s.subtitle,
          description: s.description, imageKey: s.imageKey, order: s.order,
          helpContent: tpl?.helpContent ?? null,
          tasks: s.tasks.map((t) => ({
            id: t.id, key: t.key, title: t.title, description: t.description, order: t.order,
            questions: t.passportQuestions.map((q) => ({
              id: q.id, type: q.questionTemplate.type, question: q.questionTemplate.title,
              description: q.questionTemplate.description, parts: q.questionTemplate.parts,
              options: q.questionTemplate.options, fields: q.questionTemplate.fields,
              answer: q.answer ? {
                answerText: q.answer.answerText, answerJson: q.answer.answerJson,
                fileUrl: q.answer.fileUrl, createdAt: q.answer.createdAt,
              } : null,
            })),
          })),
        };
      }),
    };
  }

  // ── AI Section Summary ───────────────────────────────────────────────────

  async getSectionAiSummary(passportId: string, sectionKey: string, userId: string) {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      include: {
        buyerAccesses: { where: { userId } },
        collaborators: { where: { userId } },
        sections: {
          where: { key: sectionKey },
          include: {
            tasks: {
              include: {
                passportQuestions: {
                  include: { questionTemplate: true, answer: true },
                },
              },
            },
          },
        },
      },
    });
    if (!passport) throw new NotFoundException('Passport not found');
    const isOwner = passport.ownerId === userId;
    if (!isOwner && !passport.collaborators.length && !passport.buyerAccesses.length) {
      throw new ForbiddenException('Access denied');
    }

    const section = passport.sections[0];
    if (!section) throw new NotFoundException('Section not found');

    // Build Q&A list
    const qaList: string[] = [];
    for (const task of section.tasks) {
      for (const pq of task.passportQuestions) {
        const q = pq.questionTemplate.title;
        let a = '';
        if (pq.answer) {
          a = pq.answer.answerText ?? '';
          if (!a && pq.answer.answerJson) {
            try {
              const j: any = typeof pq.answer.answerJson === 'string'
                ? JSON.parse(pq.answer.answerJson as string)
                : pq.answer.answerJson;
              a = j?.mainAnswer ?? j?.radioAnswer ?? j?.text ?? JSON.stringify(j);
            } catch { a = String(pq.answer.answerJson); }
          }
          if (!a && pq.answer.fileUrl) a = '[Document uploaded]';
        }
        if (a) qaList.push(`Q: ${q}\nA: ${a}`);
      }
    }

    if (!qaList.length) {
      return { summary: 'The seller has not yet answered any questions in this section.' };
    }

    const prompt = `You are a UK property buying assistant helping a buyer understand a property passport section.

Section: ${section.title}
${section.subtitle ? `Description: ${section.subtitle}` : ''}

Seller's answers:
${qaList.join('\n\n')}

Write a short, plain-English summary (3-5 sentences) of what these answers mean for the buyer.
Focus on: what is good news, what needs attention, and any questions the buyer should ask their solicitor.
Be factual, helpful, and concise. Do not repeat the questions verbatim.`;

    const completion = await this.groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
      temperature: 0.4,
    });

    return { summary: completion.choices[0]?.message?.content ?? 'Unable to generate summary.' };
  }

  // ── Buyer Notes ──────────────────────────────────────────────────────────

  async createBuyerNote(passportId: string, userId: string, text: string, sectionKey?: string) {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      include: {
        buyerAccesses: { where: { userId } },
        collaborators: { where: { userId } },
      },
    });
    if (!passport) throw new NotFoundException('Passport not found');
    const isOwner = passport.ownerId === userId;
    if (!isOwner && !passport.collaborators.length && !passport.buyerAccesses.length) {
      throw new ForbiddenException('Access denied');
    }
    if (!text?.trim()) throw new BadRequestException('Note text is required');

    return this.prisma.buyerNote.create({
      data: { passportId, userId, text: text.trim(), sectionKey: sectionKey ?? null },
      select: { id: true, passportId: true, sectionKey: true, text: true, createdAt: true },
    });
  }

  async getBuyerNotes(passportId: string, userId: string) {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      include: {
        buyerAccesses: { where: { userId } },
        collaborators: { where: { userId } },
      },
    });
    if (!passport) throw new NotFoundException('Passport not found');
    const isOwner = passport.ownerId === userId;
    if (!isOwner && !passport.collaborators.length && !passport.buyerAccesses.length) {
      throw new ForbiddenException('Access denied');
    }

    return this.prisma.buyerNote.findMany({
      where: { passportId, userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, passportId: true, sectionKey: true, text: true, createdAt: true },
    });
  }

  async deleteBuyerNote(noteId: string, userId: string) {
    const note = await this.prisma.buyerNote.findUnique({ where: { id: noteId } });
    if (!note) throw new NotFoundException('Note not found');
    if (note.userId !== userId) throw new ForbiddenException('Not your note');
    await this.prisma.buyerNote.delete({ where: { id: noteId } });
    return { deleted: true };
  }
}
