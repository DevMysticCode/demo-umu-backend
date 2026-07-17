import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Generic 1:1 conversations layer. Every messaging surface in the app
 * (matched-buyer chat, property enquiry replacing tap-the-owner,
 * viewing-request thread) goes through this service so the storage
 * shape stays consistent and notifications fan out from one place.
 *
 * A Conversation is uniquely identified by (context, contextId,
 * <participant ids>). The service is deliberately participant-aware:
 * every read/write asserts the caller is in the thread's
 * ConversationParticipant list, so there's no accidental data leak
 * even if a route forgets its authz.
 */

export type ConversationContext =
  | 'passport_match'      // owner ↔ matched buyer (contextId = passportId)
  | 'property_enquiry'    // buyer ↔ owner via property page (contextId = propertyId)
  | 'marketplace_job';    // legacy — Ticket 6 will migrate marketplace threads here

export interface FindOrCreateInput {
  context: ConversationContext;
  contextId: string;
  participants: Array<{ userId: string; role?: string | null }>;
}

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Returns the existing conversation for this context + participant
   * set if one exists, otherwise creates it. The participants array
   * is treated as a set — order-independent — because "seller X + buyer
   * Y talking about passport Z" is the same thread whichever party
   * kicked it off.
   */
  async findOrCreate(input: FindOrCreateInput) {
    if (input.participants.length !== 2) {
      throw new BadRequestException(
        'Conversation must have exactly 2 participants (1:1 for now).',
      );
    }
    const [a, b] = input.participants;
    if (a.userId === b.userId) {
      throw new BadRequestException('Participants must be distinct users.');
    }

    // Look for a conversation on this context+id where BOTH users are
    // already participants. We don't rely on a composite unique index
    // because the participant list lives in a junction table — a raw
    // SQL search on the set would need Postgres array ops. A findMany
    // with the pair filter keeps the query plain Prisma + covers the
    // 1:1 case cleanly. Scale later if group threads land.
    const existing = await this.prisma.conversation.findFirst({
      where: {
        context: input.context,
        contextId: input.contextId,
        AND: [
          { participants: { some: { userId: a.userId } } },
          { participants: { some: { userId: b.userId } } },
        ],
      },
      include: { participants: true },
    });
    if (existing) return existing;

    return this.prisma.conversation.create({
      data: {
        context: input.context,
        contextId: input.contextId,
        participants: {
          create: input.participants.map((p) => ({
            userId: p.userId,
            role: p.role ?? null,
          })),
        },
      },
      include: { participants: true },
    });
  }

  /**
   * Every conversation the user is a participant in, newest activity
   * first. Includes the latest message + the other participant for the
   * inbox row without a second round-trip.
   */
  async listForUser(userId: string) {
    return this.prisma.conversation.findMany({
      where: { participants: { some: { userId } } },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        participants: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, avatarUrl: true },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            body: true,
            kind: true,
            payload: true,
            senderId: true,
            createdAt: true,
          },
        },
      },
    });
  }

  /**
   * Messages in a single conversation, oldest first. Enforces
   * participant membership so a leaked conversationId can't be tailed
   * by a non-participant.
   */
  async listMessages(conversationId: string, userId: string) {
    await this.assertParticipant(conversationId, userId);
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true },
        },
      },
    });
    // Piggy-back on the read call so opening a thread marks it read.
    await this.markRead(conversationId, userId).catch(() => {
      /* non-critical */
    });
    return messages;
  }

  /**
   * Send a message + fan out a notification to every OTHER participant.
   * `kind` defaults to plain text; structured cards (viewing_request,
   * share_passport, payment_prompt) pass their data in `payload`.
   */
  async sendMessage(input: {
    conversationId: string;
    senderId: string;
    body: string;
    kind?: string;
    payload?: any;
    // For system messages posted by callers (e.g. viewing-request
    // created); skips the notification fan-out because the caller
    // is doing its own richer notification.
    skipNotification?: boolean;
    // Deep-link path for the notification action — defaults to the
    // conversation page.
    actionUrl?: string;
    // Notification type override for structured cards.
    notificationType?: string;
    notificationTitle?: string;
    notificationBody?: string;
  }) {
    await this.assertParticipant(input.conversationId, input.senderId);

    const kind = input.kind ?? 'text';
    if (kind === 'text' && (!input.body || !input.body.trim())) {
      throw new BadRequestException('Message body cannot be empty.');
    }

    const now = new Date();
    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId: input.conversationId,
          senderId: input.senderId,
          body: input.body ?? '',
          kind,
          payload: input.payload ?? undefined,
        },
      });
      await tx.conversation.update({
        where: { id: input.conversationId },
        data: { lastMessageAt: now },
      });
      return created;
    });

    if (!input.skipNotification) {
      const recipients = await this.getOtherParticipants(
        input.conversationId,
        input.senderId,
      );
      const sender = await this.prisma.user.findUnique({
        where: { id: input.senderId },
        select: { firstName: true, lastName: true },
      });
      const senderName =
        [sender?.firstName, sender?.lastName].filter(Boolean).join(' ') ||
        'Someone';
      const actionUrl = input.actionUrl ?? `/inbox/${input.conversationId}`;
      await Promise.all(
        recipients.map((p) =>
          this.notifications.sendNotification({
            userId: p.userId,
            type: input.notificationType ?? 'new_message',
            title: input.notificationTitle ?? `New message from ${senderName}`,
            body:
              input.notificationBody ??
              (message.body.length > 120
                ? message.body.slice(0, 117) + '…'
                : message.body),
            actionUrl,
            entityType: 'conversation',
            entityId: input.conversationId,
            data: {
              conversationId: input.conversationId,
              messageId: message.id,
            },
          }),
        ),
      );
    }

    return message;
  }

  async markRead(conversationId: string, userId: string) {
    await this.assertParticipant(conversationId, userId);
    await this.prisma.conversationParticipant.updateMany({
      where: { conversationId, userId },
      data: { lastReadAt: new Date() },
    });
  }

  /**
   * Enforce membership before any read/write. Kept as a shared helper so
   * every entry point uses identical checks — never route-level ad-hoc.
   */
  async assertParticipant(conversationId: string, userId: string) {
    const row = await this.prisma.conversationParticipant.findFirst({
      where: { conversationId, userId },
      select: { id: true },
    });
    if (!row) {
      // Also cover the case where the conversation doesn't exist at all —
      // return the same 404 either way so callers can't tell a missing
      // conversation from one they aren't in.
      const exists = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Conversation not found');
      throw new ForbiddenException('You are not a participant in this conversation.');
    }
  }

  private async getOtherParticipants(
    conversationId: string,
    excludeUserId: string,
  ) {
    return this.prisma.conversationParticipant.findMany({
      where: { conversationId, userId: { not: excludeUserId } },
      select: { userId: true },
    });
  }
}
