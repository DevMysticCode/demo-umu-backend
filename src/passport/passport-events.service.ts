import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { categoryForEventType, EVENT_TYPES_BY_CATEGORY, HistoryCategoryValue } from './passport-event-types';

type PrismaTransactionClient = Prisma.TransactionClient;

export interface LogEventInput {
  passportId: string;
  eventType: string;
  actorType: 'OWNER' | 'COLLABORATOR' | 'SYSTEM' | 'ADMIN' | 'SOURCE';
  actorId?: string | null;
  actingOnBehalfOf?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  sectionId?: string | null;
  sourceType?: string | null;
  beforeRef?: unknown;
  afterRef?: unknown;
  visibilityClass?: 'OWNER_ONLY' | 'COLLABORATOR' | 'BUYER' | 'PUBLIC';
  correlationId?: string | null;
  ruleId?: string | null;
  ruleVersion?: number | null;
  metadata?: unknown;
  /** Overrides the server "now" — only ever used for the one-off migration
   * seed event (§5 of the spec: "Imported from existing passport on
   * [date]" must not imply a fabricated original date). Leave unset for
   * every real write path. */
  occurredAt?: Date;
}

@Injectable()
export class PassportEventsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Writes one History event. Accepts an optional transaction client so
   * callers that need the event written atomically with the domain change
   * it describes (e.g. an answer save) can pass their `tx` — per the
   * spec's "prefer writing the domain change and its event in the same
   * database transaction". Callers that don't have one (e.g. a simple
   * fire-and-forget collaborator notification) can omit it; the write
   * still happens, just not atomically with anything else.
   */
  async logEvent(
    input: LogEventInput,
    tx?: PrismaTransactionClient,
  ): Promise<void> {
    const client = tx ?? (this.prisma as unknown as PrismaTransactionClient);
    try {
      await client.passportEvent.create({
        data: {
          passportId: input.passportId,
          eventType: input.eventType,
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          actingOnBehalfOf: input.actingOnBehalfOf ?? null,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          sectionId: input.sectionId ?? null,
          sourceType: input.sourceType ?? null,
          beforeRef: (input.beforeRef ?? undefined) as Prisma.InputJsonValue,
          afterRef: (input.afterRef ?? undefined) as Prisma.InputJsonValue,
          visibilityClass: input.visibilityClass ?? 'OWNER_ONLY',
          correlationId: input.correlationId ?? null,
          ruleId: input.ruleId ?? null,
          ruleVersion: input.ruleVersion ?? null,
          metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue,
          ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
        },
      });
    } catch (err) {
      // History logging must never block the domain action it describes —
      // same "best-effort" contract the old logActivity() had. A missing
      // event is recoverable (support can reconstruct from other tables);
      // a blocked answer-save/upload because the LOG write failed is not
      // an acceptable trade.
      // eslint-disable-next-line no-console
      console.error('[PassportEvents] logEvent failed:', (err as Error)?.message ?? err);
    }
  }

  /**
   * Resolves the caller's viewing relationship to a passport, for both
   * History-read scoping and elsewhere. Mirrors PassportService's
   * checkUserAccess() but returns the richer detail History needs (which
   * collaborator row, and whether that collaborator has historyAccess).
   */
  private async resolveViewer(passportId: string, userId: string | null) {
    const passport = await this.prisma.passport.findUnique({
      where: { id: passportId },
      select: { id: true, ownerId: true, status: true },
    });
    if (!passport) throw new NotFoundException('Passport not found');

    const isOwner = !!userId && passport.ownerId === userId;

    let collaborator: {
      id: string;
      sectionKeys: unknown;
      historyAccess: boolean;
    } | null = null;
    if (!isOwner && userId) {
      collaborator = await this.prisma.passportCollaborator.findUnique({
        where: { passportId_userId: { passportId, userId } },
        select: { id: true, sectionKeys: true, historyAccess: true },
      });
    }

    let isBuyerWithAccess = false;
    if (!isOwner && !collaborator && userId) {
      const grant = await this.prisma.buyerPassportAccess.findUnique({
        where: { passportId_userId: { passportId, userId } },
      }).catch(() => null);
      isBuyerWithAccess = !!grant;
    }

    const isPublished = passport.status === ('PUBLISHED' as any);

    return { passport, isOwner, collaborator, isBuyerWithAccess, isPublished };
  }

  /** Which visibilityClass values this viewer is allowed to see, and
   * (for a scoped collaborator) which sectionIds — null sectionKeys means
   * unscoped/full access. Throws if the viewer has no access at all. */
  private async authorizeHistoryRead(passportId: string, userId: string | null) {
    const { isOwner, collaborator, isBuyerWithAccess, isPublished } =
      await this.resolveViewer(passportId, userId);

    if (isOwner) {
      return { allowedVisibility: null as string[] | null, sectionScope: null as string[] | null };
    }
    if (collaborator) {
      if (!collaborator.historyAccess) {
        throw new ForbiddenException('This collaborator does not have history access');
      }
      const sectionScope = Array.isArray(collaborator.sectionKeys)
        ? (collaborator.sectionKeys as string[])
        : null;
      return { allowedVisibility: ['COLLABORATOR', 'BUYER', 'PUBLIC'], sectionScope };
    }
    if (isBuyerWithAccess) {
      return { allowedVisibility: ['BUYER', 'PUBLIC'], sectionScope: null };
    }
    if (isPublished) {
      return { allowedVisibility: ['PUBLIC'], sectionScope: null };
    }
    throw new ForbiddenException('Not authorised to view this passport history');
  }

  async getHistory(
    passportId: string,
    userId: string | null,
    opts: {
      cursor?: string;
      limit?: number;
      category?: HistoryCategoryValue | 'all';
      sectionId?: string;
      dateFrom?: Date;
      dateTo?: Date;
    },
  ) {
    const { allowedVisibility, sectionScope } = await this.authorizeHistoryRead(
      passportId,
      userId,
    );

    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);

    const where: Prisma.PassportEventWhereInput = { passportId };
    if (allowedVisibility) where.visibilityClass = { in: allowedVisibility as any[] };
    if (sectionScope) {
      // A scoped collaborator sees section-tagged events only for their
      // sections, plus passport-level events (sectionId null) — e.g.
      // "collaborator invited" isn't attached to any one section.
      where.OR = [{ sectionId: { in: sectionScope } }, { sectionId: null }];
    }
    if (opts.category && opts.category !== 'all') {
      where.eventType = { in: EVENT_TYPES_BY_CATEGORY[opts.category] };
    }
    if (opts.sectionId) where.sectionId = opts.sectionId;
    if (opts.dateFrom || opts.dateTo) {
      where.occurredAt = {
        ...(opts.dateFrom ? { gte: opts.dateFrom } : {}),
        ...(opts.dateTo ? { lte: opts.dateTo } : {}),
      };
    }

    const rows = await this.prisma.passportEvent.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      events: page.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        category: categoryForEventType(e.eventType),
        actorType: e.actorType,
        actorId: e.actorId,
        entityType: e.entityType,
        entityId: e.entityId,
        sectionId: e.sectionId,
        sourceType: e.sourceType,
        occurredAt: e.occurredAt,
        ruleId: e.ruleId,
        correlationId: e.correlationId,
        // Deliberately NOT including beforeRef/afterRef here — the list
        // is a "safe summary"; only getEventDetail() (which re-checks
        // permissions) returns the restricted payload.
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async getEventDetail(passportId: string, eventId: string, userId: string | null) {
    const { allowedVisibility, sectionScope } = await this.authorizeHistoryRead(
      passportId,
      userId,
    );

    const event = await this.prisma.passportEvent.findUnique({ where: { id: eventId } });
    if (!event || event.passportId !== passportId) {
      throw new NotFoundException('Event not found');
    }
    if (allowedVisibility && !allowedVisibility.includes(event.visibilityClass)) {
      throw new ForbiddenException('Not authorised to view this event');
    }
    if (sectionScope && event.sectionId && !sectionScope.includes(event.sectionId)) {
      throw new ForbiddenException('Not authorised to view this event');
    }

    let linkedAction: unknown = null;
    if (event.correlationId) {
      linkedAction = await this.prisma.passportAction.findFirst({
        where: { passportId, subjectEntityId: event.correlationId },
        orderBy: { createdAt: 'desc' },
      });
    }

    return {
      id: event.id,
      eventType: event.eventType,
      category: categoryForEventType(event.eventType),
      actorType: event.actorType,
      actorId: event.actorId,
      actingOnBehalfOf: event.actingOnBehalfOf,
      entityType: event.entityType,
      entityId: event.entityId,
      sectionId: event.sectionId,
      sourceType: event.sourceType,
      occurredAt: event.occurredAt,
      recordedAt: event.recordedAt,
      visibilityClass: event.visibilityClass,
      beforeRef: event.beforeRef,
      afterRef: event.afterRef,
      ruleId: event.ruleId,
      ruleVersion: event.ruleVersion,
      metadata: event.metadata,
      linkedAction,
    };
  }
}
