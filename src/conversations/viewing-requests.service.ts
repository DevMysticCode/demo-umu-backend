import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ConversationsService } from './conversations.service';

/**
 * Property-viewing invites. Every viewing lives inside a Conversation
 * (context = 'property_enquiry', contextId = propertyId) so the buyer
 * can accept / decline / propose a new time by chatting with the owner
 * around the request card — no separate screen, no lost context.
 *
 * The invite flow:
 *   1. Seller taps "Invite to view" on a matched-buyer row → picks
 *      1-5 proposed slots → we create a ViewingRequest + open (or
 *      reuse) a Conversation between the two + post a system Message
 *      of kind 'viewing_request' with the slots in `payload`.
 *   2. Buyer sees a bell notification + push, opens the thread, the
 *      card renders inline with Accept / Propose new time / Decline.
 *   3. Their response updates the ViewingRequest + posts a
 *      'viewing_response' system message + notifies the seller.
 */

interface Slot {
  startISO: string;
  endISO?: string;
  label?: string;
}

interface CreateInput {
  propertyId: string;
  proposedById: string;   // authenticated user creating the invite (seller / collaborator)
  invitedUserId: string;  // buyer being invited
  slots: Slot[];
  message?: string;       // optional extra note from the seller
}

interface RespondInput {
  viewingRequestId: string;
  userId: string;
  action: 'accept' | 'decline' | 'reschedule';
  chosenSlot?: Slot;      // required for `accept`
  proposedSlots?: Slot[]; // required for `reschedule`
  message?: string;
}

@Injectable()
export class ViewingRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(input: CreateInput) {
    if (!Array.isArray(input.slots) || input.slots.length === 0) {
      throw new BadRequestException(
        'Provide at least one proposed viewing slot.',
      );
    }
    if (input.slots.length > 5) {
      throw new BadRequestException(
        'A maximum of 5 slots can be proposed per invite.',
      );
    }
    if (input.proposedById === input.invitedUserId) {
      throw new BadRequestException('You cannot invite yourself to view.');
    }

    const property = await this.prisma.property.findUnique({
      where: { id: input.propertyId },
      select: { id: true, addressLine1: true, postcode: true },
    });
    if (!property) throw new NotFoundException('Property not found');

    // Open (or reuse) the conversation between the two parties for this
    // property. Roles are hints — the seller side may actually be an
    // owner OR a collaborator; we just tag as 'owner' vs 'buyer' for
    // the UI to decide who sits on which side of the thread.
    const conversation = await this.conversations.findOrCreate({
      context: 'property_enquiry',
      contextId: input.propertyId,
      participants: [
        { userId: input.proposedById, role: 'owner' },
        { userId: input.invitedUserId, role: 'buyer' },
      ],
    });

    const viewing = await this.prisma.viewingRequest.create({
      data: {
        propertyId: input.propertyId,
        proposedById: input.proposedById,
        invitedUserId: input.invitedUserId,
        conversationId: conversation.id,
        slots: input.slots as any,
        status: 'pending',
      },
    });

    // System message that renders as the viewing-request card in the
    // buyer's chat. `skipNotification` because we send a richer
    // notification below (with the seller's name + property address).
    await this.conversations.sendMessage({
      conversationId: conversation.id,
      senderId: input.proposedById,
      body:
        input.message?.trim() ||
        `Viewing invite for ${property.addressLine1}. Pick a time or propose a new one.`,
      kind: 'viewing_request',
      payload: {
        viewingRequestId: viewing.id,
        propertyId: property.id,
        propertyAddress: property.addressLine1,
        slots: input.slots,
      },
      skipNotification: true,
    });

    const sellerName = await this.displayName(input.proposedById);
    await this.notifications.sendNotification({
      userId: input.invitedUserId,
      type: 'viewing_request',
      title: `${sellerName} invited you to view a property`,
      body: `${property.addressLine1}${property.postcode ? ' · ' + property.postcode : ''}`,
      actionUrl: `/inbox/${conversation.id}`,
      entityType: 'viewing',
      entityId: viewing.id,
      data: {
        viewingRequestId: viewing.id,
        conversationId: conversation.id,
      },
      // Viewings are high-signal — send an email too (defaults allow
      // for the 'viewings' category).
      email: {
        subject: `${sellerName} invited you to view ${property.addressLine1}`,
        html: `<p>${sellerName} has invited you to view <strong>${property.addressLine1}${
          property.postcode ? ', ' + property.postcode : ''
        }</strong>.</p><p>Open the app to accept a time, propose a new one, or decline.</p>`,
      },
    });

    return { viewing, conversationId: conversation.id };
  }

  async respond(input: RespondInput) {
    const viewing = await this.prisma.viewingRequest.findUnique({
      where: { id: input.viewingRequestId },
      include: {
        property: { select: { addressLine1: true, postcode: true } },
      },
    });
    if (!viewing) throw new NotFoundException('Viewing request not found');
    if (viewing.invitedUserId !== input.userId) {
      throw new ForbiddenException(
        'Only the invited user can respond to this request.',
      );
    }
    if (viewing.status !== 'pending' && viewing.status !== 'rescheduled') {
      throw new BadRequestException(
        `Cannot respond — request is already ${viewing.status}.`,
      );
    }

    if (input.action === 'accept' && !input.chosenSlot) {
      throw new BadRequestException('Choose a slot to accept.');
    }
    if (
      input.action === 'reschedule' &&
      (!input.proposedSlots || input.proposedSlots.length === 0)
    ) {
      throw new BadRequestException(
        'Propose at least one new slot when rescheduling.',
      );
    }

    const nextStatus =
      input.action === 'accept'
        ? 'accepted'
        : input.action === 'decline'
          ? 'declined'
          : 'rescheduled';

    const updated = await this.prisma.viewingRequest.update({
      where: { id: viewing.id },
      data: {
        status: nextStatus,
        chosenSlot: input.chosenSlot ? (input.chosenSlot as any) : undefined,
        slots:
          input.action === 'reschedule'
            ? (input.proposedSlots as any)
            : undefined,
        respondedAt: new Date(),
      },
    });

    // Post the response as a system card in the same conversation. The
    // seller sees "Buyer accepted · 3pm Fri" inline without a
    // separate email thread.
    if (viewing.conversationId) {
      const bodyForCard =
        input.action === 'accept'
          ? `Accepted for ${input.chosenSlot?.label ?? formatSlot(input.chosenSlot!)}`
          : input.action === 'decline'
            ? 'Declined this viewing invite'
            : 'Proposed a new time';
      await this.conversations.sendMessage({
        conversationId: viewing.conversationId,
        senderId: input.userId,
        body: input.message?.trim() || bodyForCard,
        kind: 'viewing_response',
        payload: {
          viewingRequestId: viewing.id,
          action: input.action,
          chosenSlot: input.chosenSlot ?? null,
          proposedSlots: input.proposedSlots ?? null,
        },
        skipNotification: true,
      });
    }

    const buyerName = await this.displayName(input.userId);
    const summary =
      input.action === 'accept'
        ? 'accepted your viewing invite'
        : input.action === 'decline'
          ? 'declined your viewing invite'
          : 'proposed a new time for your viewing';
    await this.notifications.sendNotification({
      userId: viewing.proposedById,
      type: 'viewing_response',
      title: `${buyerName} ${summary}`,
      body: viewing.property.addressLine1,
      actionUrl: viewing.conversationId
        ? `/inbox/${viewing.conversationId}`
        : `/property/${viewing.propertyId}`,
      entityType: 'viewing',
      entityId: viewing.id,
      data: {
        viewingRequestId: viewing.id,
        conversationId: viewing.conversationId ?? '',
      },
      email:
        input.action === 'accept'
          ? {
              subject: `Viewing confirmed — ${viewing.property.addressLine1}`,
              html: `<p>${buyerName} accepted your viewing invite for <strong>${
                viewing.property.addressLine1
              }</strong>.</p><p>Chosen time: <strong>${formatSlot(input.chosenSlot!)}</strong>.</p>`,
            }
          : undefined,
    });

    return updated;
  }

  private async displayName(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    return (
      [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'A user'
    );
  }
}

function formatSlot(slot: Slot): string {
  if (slot.label) return slot.label;
  try {
    const start = new Date(slot.startISO);
    const opts: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    };
    return start.toLocaleString('en-GB', opts);
  } catch {
    return slot.startISO;
  }
}
