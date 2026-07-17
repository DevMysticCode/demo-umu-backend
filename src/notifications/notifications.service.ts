import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';

/**
 * Fan-out helper for the app's messaging + activity notifications.
 *
 * Every notification-worthy event in the app should end up calling
 * `sendNotification()` — never write to the `Notification` table
 * directly, never call PushService directly for user-facing events.
 * Doing so keeps three delivery channels (durable DB row, mobile
 * push, optional email) consistent + respects per-user opt-outs
 * from a single choke point.
 *
 * Channels:
 *   1. `Notification` row — always inserted. Drives the in-app bell,
 *      inbox badge, and notification list. Cheap + durable, works
 *      even when the user's device is offline.
 *   2. AWS SNS mobile push — fired via PushService when the user has
 *      registered PushTokens AND their preferences allow this type.
 *      No-ops silently if SNS platform ARNs aren't configured
 *      (dev boxes without an APNs setup stay quiet).
 *   3. Resend email — fired only when the caller explicitly opts in
 *      via `email: { subject, html }`. Intended as a fallback for
 *      users with push disabled OR for high-signal events (viewing
 *      request accepted, passport shared). Marketing-style broadcast
 *      digest emails will land in a later phase.
 *
 * Every step is best-effort: if any single delivery fails we log and
 * keep going. The upstream caller shouldn't have to know or care.
 */

/** All known notification types + which preference category gates them. */
const TYPE_CATEGORY: Record<string, NotificationCategory> = {
  new_message: 'messages',
  viewing_request: 'viewings',
  viewing_response: 'viewings',
  passport_shared: 'share_passport',
  passport_unlocked: 'share_passport',
  invite_accepted: 'viewings',
};

export type NotificationCategory =
  | 'messages'
  | 'viewings'
  | 'share_passport'
  | 'marketing';

export interface NotificationInput {
  userId: string;
  type: keyof typeof TYPE_CATEGORY | string;
  title: string;
  body: string;
  /** Relative deep-link path — e.g. `/inbox/<conversationId>`. */
  actionUrl: string;
  entityType?: string;
  entityId?: string;
  /** Optional structured data attached to the push payload for the app
   *  to switch on when it lands (e.g. { conversationId }). */
  data?: Record<string, string>;
  /** Explicit push override — defaults to whatever the user's
   *  preferences say for this type's category. Pass `false` to force
   *  in-app-only for silent updates (e.g. after a `read` mutation).*/
  push?: boolean;
  /** Send an email too. Skipped unless explicitly requested — most
   *  notifications live comfortably in-app + push. */
  email?: {
    subject: string;
    html: string;
  };
}

/** Sensible defaults for users who haven't touched the settings screen.
 *  Marketing = off so we're not auto-opted into promo email at signup. */
const DEFAULT_PREFS: Record<
  'push' | 'email' | 'inApp',
  Record<NotificationCategory, boolean>
> = {
  push:  { messages: true, viewings: true, share_passport: true, marketing: false },
  email: { messages: false, viewings: true, share_passport: true, marketing: false },
  inApp: { messages: true, viewings: true, share_passport: true, marketing: true  },
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /**
   * Deliver a single notification through every enabled channel.
   * Never throws — logs individual failures + returns a summary so
   * callers can proceed even if push or email happens to be down.
   */
  async sendNotification(
    input: NotificationInput,
  ): Promise<{ notificationId: string | null; pushed: boolean; emailed: boolean }> {
    const category = TYPE_CATEGORY[input.type] ?? 'messages';
    const prefs = await this.getEffectivePreferences(input.userId);

    // 1. Durable in-app row. Skipped only if the user has silenced this
    //    category from the in-app bell (rare — most users want history).
    let notificationId: string | null = null;
    if (prefs.inApp[category]) {
      try {
        const row = await this.prisma.notification.create({
          data: {
            userId: input.userId,
            type: input.type,
            title: input.title,
            body: input.body,
            actionUrl: input.actionUrl,
            entityType: input.entityType ?? null,
            entityId: input.entityId ?? null,
          },
          select: { id: true },
        });
        notificationId = row.id;
      } catch (err) {
        this.logger.warn(
          `Failed to persist Notification for ${input.userId}/${input.type}: ${(err as Error)?.message}`,
        );
      }
    }

    // 2. Mobile push. Explicit `push: false` overrides the pref — used
    //    for silent bell-badge updates. Explicit `push: true` respects
    //    the pref (we never bypass a user's opt-out).
    const pushWanted = input.push !== false && prefs.push[category];
    let pushed = false;
    if (pushWanted) {
      try {
        await this.push.send(input.userId, {
          title: input.title,
          body: input.body,
          data: {
            ...(input.data ?? {}),
            type: input.type,
            actionUrl: input.actionUrl,
            ...(notificationId ? { notificationId } : {}),
            ...(input.entityType ? { entityType: input.entityType } : {}),
            ...(input.entityId ? { entityId: input.entityId } : {}),
          },
        });
        pushed = true;
      } catch (err) {
        this.logger.warn(
          `Push send failed for ${input.userId}/${input.type}: ${(err as Error)?.message}`,
        );
      }
    }

    // 3. Email — opt-in per caller AND respects user pref for the
    //    category. Kept last so a slow SMTP round-trip never blocks
    //    the in-app + push channels.
    let emailed = false;
    if (input.email && prefs.email[category]) {
      try {
        await this.sendEmail(input.userId, input.email);
        emailed = true;
      } catch (err) {
        this.logger.warn(
          `Email send failed for ${input.userId}/${input.type}: ${(err as Error)?.message}`,
        );
      }
    }

    return { notificationId, pushed, emailed };
  }

  /**
   * Merge stored preferences with defaults so callers never need to
   * null-check. A brand-new user has no row → everything defaults on
   * (except marketing). Partial JSON updates are honoured — a user who
   * only turned off `email.messages` still gets defaults for every
   * other category.
   */
  async getEffectivePreferences(userId: string): Promise<{
    push: Record<NotificationCategory, boolean>;
    email: Record<NotificationCategory, boolean>;
    inApp: Record<NotificationCategory, boolean>;
  }> {
    const row = await this.prisma.notificationPreference.findUnique({
      where: { userId },
    });
    const merge = (
      stored: unknown,
      defaults: Record<NotificationCategory, boolean>,
    ): Record<NotificationCategory, boolean> => {
      const asObj = (stored && typeof stored === 'object'
        ? (stored as Record<string, unknown>)
        : {}) as Partial<Record<NotificationCategory, boolean>>;
      return {
        messages: asObj.messages ?? defaults.messages,
        viewings: asObj.viewings ?? defaults.viewings,
        share_passport: asObj.share_passport ?? defaults.share_passport,
        marketing: asObj.marketing ?? defaults.marketing,
      };
    };
    return {
      push: merge(row?.push, DEFAULT_PREFS.push),
      email: merge(row?.email, DEFAULT_PREFS.email),
      inApp: merge(row?.inApp, DEFAULT_PREFS.inApp),
    };
  }

  /**
   * Upsert a partial preference patch. Existing categories the caller
   * doesn't mention are preserved. Used by the profile → settings
   * screen.
   */
  async updatePreferences(
    userId: string,
    patch: Partial<{
      push: Partial<Record<NotificationCategory, boolean>>;
      email: Partial<Record<NotificationCategory, boolean>>;
      inApp: Partial<Record<NotificationCategory, boolean>>;
    }>,
  ) {
    const existing = await this.getEffectivePreferences(userId);
    const next = {
      push:  { ...existing.push,  ...(patch.push  ?? {}) },
      email: { ...existing.email, ...(patch.email ?? {}) },
      inApp: { ...existing.inApp, ...(patch.inApp ?? {}) },
    };
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, push: next.push, email: next.email, inApp: next.inApp },
      update: { push: next.push, email: next.email, inApp: next.inApp },
    });
  }

  /** Recent notifications for the bell dropdown + inbox screen. */
  async listForUser(userId: string, opts?: { limit?: number; before?: Date }) {
    const limit = Math.min(opts?.limit ?? 30, 100);
    return this.prisma.notification.findMany({
      where: {
        userId,
        ...(opts?.before ? { createdAt: { lt: opts.before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** Small + fast — used by the bell badge to poll every 30s. */
  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  async markRead(userId: string, notificationId: string) {
    const now = new Date();
    // updateMany + userId in the where clause keeps this idempotent AND
    // prevents users from mutating each other's rows even if they guess
    // an id.
    const res = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: now },
    });
    return { updated: res.count };
  }

  async markAllRead(userId: string) {
    const now = new Date();
    const res = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: now },
    });
    return { updated: res.count };
  }

  private async sendEmail(
    userId: string,
    email: { subject: string; html: string },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user?.email) return;
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.RESEND_FROM ?? 'UMovingU <info@umovingu.io>';
    await resend.emails.send({
      from,
      to: [user.email],
      subject: email.subject,
      html: email.html,
    });
  }
}
