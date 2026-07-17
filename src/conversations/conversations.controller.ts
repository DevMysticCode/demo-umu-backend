import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import {
  ConversationsService,
  ConversationContext,
} from './conversations.service';
import { ViewingRequestsService } from './viewing-requests.service';

/**
 * HTTP surface for the shared messaging layer.
 *
 * Endpoints:
 *   GET  /conversations                              — inbox for me
 *   GET  /conversations/:id/messages                 — history
 *   POST /conversations/:id/messages                 — send a text message
 *   POST /conversations/:id/read                     — mark read
 *   POST /conversations/start                        — open a thread on
 *                                                      a context+peer (used by
 *                                                      the buyer-drawer's
 *                                                      "Message" button)
 *   POST /property/:id/viewing-request               — seller invites buyer
 *   POST /viewing-requests/:id/respond               — buyer accepts/declines
 *
 * All routes require auth; participant-level authorisation is enforced
 * inside the service (see assertParticipant) so a leaked conversation
 * id can't be tailed by a non-participant.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly viewingRequests: ViewingRequestsService,
  ) {}

  @Get('conversations')
  async listMine(@Request() req: any) {
    return this.conversations.listForUser(req.user.id);
  }

  @Get('conversations/:id/messages')
  async listMessages(@Param('id') id: string, @Request() req: any) {
    return this.conversations.listMessages(id, req.user.id);
  }

  @Post('conversations/:id/messages')
  async sendMessage(
    @Param('id') id: string,
    @Body() body: { body: string },
    @Request() req: any,
  ) {
    return this.conversations.sendMessage({
      conversationId: id,
      senderId: req.user.id,
      body: body.body ?? '',
    });
  }

  @Post('conversations/:id/read')
  async markRead(@Param('id') id: string, @Request() req: any) {
    await this.conversations.markRead(id, req.user.id);
    return { ok: true };
  }

  /**
   * Kick off a new thread from any client-side context (matched-buyer
   * drawer's "Message" button etc.). If a matching thread already
   * exists, returns that instead of creating a duplicate.
   */
  @Post('conversations/start')
  async start(
    @Body()
    body: {
      context: ConversationContext;
      contextId: string;
      peerUserId: string;
      selfRole?: string;
      peerRole?: string;
      initialMessage?: string;
    },
    @Request() req: any,
  ) {
    const conversation = await this.conversations.findOrCreate({
      context: body.context,
      contextId: body.contextId,
      participants: [
        { userId: req.user.id, role: body.selfRole ?? null },
        { userId: body.peerUserId, role: body.peerRole ?? null },
      ],
    });
    if (body.initialMessage && body.initialMessage.trim()) {
      await this.conversations.sendMessage({
        conversationId: conversation.id,
        senderId: req.user.id,
        body: body.initialMessage,
      });
    }
    return { conversationId: conversation.id };
  }

  @Post('property/:id/viewing-request')
  async createViewingRequest(
    @Param('id') propertyId: string,
    @Body()
    body: {
      invitedUserId: string;
      slots: Array<{ startISO: string; endISO?: string; label?: string }>;
      message?: string;
    },
    @Request() req: any,
  ) {
    return this.viewingRequests.create({
      propertyId,
      proposedById: req.user.id,
      invitedUserId: body.invitedUserId,
      slots: body.slots,
      message: body.message,
    });
  }

  @Post('viewing-requests/:id/respond')
  async respondToViewing(
    @Param('id') viewingRequestId: string,
    @Body()
    body: {
      action: 'accept' | 'decline' | 'reschedule';
      chosenSlot?: { startISO: string; endISO?: string; label?: string };
      proposedSlots?: Array<{
        startISO: string;
        endISO?: string;
        label?: string;
      }>;
      message?: string;
    },
    @Request() req: any,
  ) {
    return this.viewingRequests.respond({
      viewingRequestId,
      userId: req.user.id,
      action: body.action,
      chosenSlot: body.chosenSlot,
      proposedSlots: body.proposedSlots,
      message: body.message,
    });
  }
}
