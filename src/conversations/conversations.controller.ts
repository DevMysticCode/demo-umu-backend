import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProperty, ApiResponse } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ConversationsService } from './conversations.service';
import type { ConversationContext } from './conversations.service';
import { ViewingRequestsService } from './viewing-requests.service';

const CONVERSATION_CONTEXTS: ConversationContext[] = [
  'passport_match',
  'property_enquiry',
  'marketplace_job',
];

class SendMessageDto {
  @ApiProperty({ description: 'The message text to post into this conversation.' })
  @IsString()
  body: string;
}

class StartConversationDto {
  @ApiProperty({ enum: CONVERSATION_CONTEXTS, description: 'What kind of conversation this is - drives which card types can be posted into it.' })
  @IsIn(CONVERSATION_CONTEXTS)
  context: ConversationContext;

  @ApiProperty({ description: 'ID of the entity (passport, property, marketplace job) this conversation is about.' })
  @IsString()
  contextId: string;

  @ApiProperty({ description: 'User ID of the other participant in this conversation.' })
  @IsString()
  peerUserId: string;

  @ApiProperty({ required: false, description: "Caller's role in this conversation (e.g. buyer, seller), if relevant to the context." })
  @IsOptional()
  @IsString()
  selfRole?: string;

  @ApiProperty({ required: false, description: "The peer's role in this conversation (e.g. buyer, seller), if relevant to the context." })
  @IsOptional()
  @IsString()
  peerRole?: string;

  @ApiProperty({ required: false, description: 'Optional first message to post immediately after the conversation is created.' })
  @IsOptional()
  @IsString()
  initialMessage?: string;
}

// Shared shape for a single proposed/chosen viewing slot — see
// ViewingRequestsService's Slot interface.
class ViewingSlotDto {
  @ApiProperty({ description: 'Slot start time, ISO 8601.' })
  @IsString()
  startISO: string;

  @ApiProperty({ required: false, description: 'Slot end time, ISO 8601.' })
  @IsOptional()
  @IsString()
  endISO?: string;

  @ApiProperty({ required: false, description: 'Optional human-readable label for this slot (e.g. "Saturday morning").' })
  @IsOptional()
  @IsString()
  label?: string;
}

class CreateViewingRequestDto {
  @ApiProperty({ description: 'User ID of the person being invited to the viewing.' })
  @IsString()
  invitedUserId: string;

  @ApiProperty({ type: [ViewingSlotDto], description: 'Proposed time slots for the viewing.' })
  @ValidateNested({ each: true })
  @Type(() => ViewingSlotDto)
  slots: ViewingSlotDto[];

  @ApiProperty({ required: false, description: 'Optional message to include with the viewing invitation.' })
  @IsOptional()
  @IsString()
  message?: string;
}

class RespondToViewingDto {
  @ApiProperty({ enum: ['accept', 'decline', 'reschedule'], description: 'How the invitee is responding to the viewing request.' })
  @IsIn(['accept', 'decline', 'reschedule'])
  action: 'accept' | 'decline' | 'reschedule';

  @ApiProperty({ type: ViewingSlotDto, required: false, description: 'The slot being accepted, required when action is "accept".' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ViewingSlotDto)
  chosenSlot?: ViewingSlotDto;

  @ApiProperty({ type: [ViewingSlotDto], required: false, description: 'Alternative slots being proposed, required when action is "reschedule".' })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ViewingSlotDto)
  proposedSlots?: ViewingSlotDto[];

  @ApiProperty({ required: false, description: 'Optional message to include with the response.' })
  @IsOptional()
  @IsString()
  message?: string;
}

const MESSAGE_SCHEMA = { type: 'object' as const, properties: { id: { type: 'string' }, conversationId: { type: 'string' }, senderId: { type: 'string' }, body: { type: 'string' }, kind: { type: 'string' }, payload: { type: 'object', nullable: true, description: "Genuinely dynamic - shape depends on kind (plain text messages have no payload; structured cards like viewing_request, share_passport, payment_prompt each carry their own data shape here)" }, createdAt: { type: 'string' } } };
const CONVERSATION_SCHEMA = { type: 'object' as const, properties: { id: { type: 'string' }, context: { type: 'string', enum: CONVERSATION_CONTEXTS }, contextId: { type: 'string' }, lastMessageAt: { type: 'string', nullable: true }, createdAt: { type: 'string' }, participants: { type: 'array', items: { type: 'object', properties: { userId: { type: 'string' }, role: { type: 'string', nullable: true }, user: { type: 'object', properties: { id: { type: 'string' }, firstName: { type: 'string', nullable: true }, lastName: { type: 'string', nullable: true }, avatarUrl: { type: 'string', nullable: true } } } } } }, messages: { type: 'array', items: MESSAGE_SCHEMA, description: "most recent message only" } } };

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
 *   POST /viewing-requests/:id/respond                — buyer accepts/declines
 *
 * All routes require auth; participant-level authorisation is enforced
 * inside the service (see assertParticipant) so a leaked conversation
 * id can't be tailed by a non-participant.
 */
@Controller()
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly viewingRequests: ViewingRequestsService,
  ) {}

  @Get('conversations')
  @ApiOperation({ summary: "List the caller's conversations", description: 'Inbox view: every conversation the authenticated user is a participant in (passport-match, property-enquiry or marketplace-job context), most recently active first, each with its most recent message.' })
  @ApiResponse({ status: 200, description: 'Array of conversations.', schema: { type: 'array', items: CONVERSATION_SCHEMA } })
  async listMine(@Request() req: any) {
    return this.conversations.listForUser(req.user.id);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Get a conversation and its full message history', description: 'Caller must be a participant. Also marks the conversation read for the caller as a side effect of opening it, and returns participants so the client can compute WhatsApp-style read receipts.' })
  @ApiParam({ name: 'id', description: 'Conversation ID' })
  @ApiResponse({ status: 200, description: 'Full message list plus participants.', schema: { type: 'object', properties: { messages: { type: 'array', items: MESSAGE_SCHEMA }, participants: { type: 'array', items: { type: 'object', properties: { userId: { type: 'string' }, lastReadAt: { type: 'string', nullable: true }, role: { type: 'string', nullable: true } } } } } } })
  async listMessages(@Param('id') id: string, @Request() req: any) {
    return this.conversations.listMessages(id, req.user.id);
  }

  @Post('conversations/:id/messages')
  @ApiOperation({ summary: 'Send a conversation message', description: 'Posts a text message as the authenticated user and notifies every other participant. Caller must be a participant.' })
  @ApiParam({ name: 'id', description: 'Conversation ID' })
  @ApiResponse({ status: 201, description: 'The created message.', schema: MESSAGE_SCHEMA })
  async sendMessage(
    @Param('id') id: string,
    @Body() body: SendMessageDto,
    @Request() req: any,
  ) {
    return this.conversations.sendMessage({
      conversationId: id,
      senderId: req.user.id,
      body: body.body ?? '',
    });
  }

  @Post('conversations/:id/read')
  @ApiOperation({ summary: 'Mark a conversation read', description: 'Marks every message in the conversation as read for the authenticated user.' })
  @ApiParam({ name: 'id', description: 'Conversation ID' })
  @ApiResponse({ status: 201, description: 'Acknowledgement.', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } })
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
  @ApiOperation({ summary: 'Start (or resume) a conversation', description: 'Opens a conversation between the caller and a peer user in the given context (passport_match / property_enquiry / marketplace_job), or returns the existing matching one. Optionally sends an initial message.' })
  @ApiResponse({ status: 201, description: 'The conversation ID to open.', schema: { type: 'object', properties: { conversationId: { type: 'string' } } } })
  async start(
    @Body()
    body: StartConversationDto,
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
  @ApiOperation({ summary: 'Invite a buyer to view a property', description: 'The caller (an owner/collaborator who manages the property via a Passport) proposes 1-5 viewing slots to an invited buyer, opens a conversation for it, and posts a system "viewing_request" message carrying the slots.' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 201, description: 'The created viewing request.', schema: { type: 'object', properties: { id: { type: 'string' }, propertyId: { type: 'string' }, status: { type: 'string' }, conversationId: { type: 'string' } } } })
  async createViewingRequest(
    @Param('id') propertyId: string,
    @Body()
    body: CreateViewingRequestDto,
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
  @ApiOperation({ summary: 'Respond to a viewing invite', description: 'The invited buyer accepts a slot, declines, or proposes new slots (reschedule). Posts a system "viewing_response" message and notifies the proposer.' })
  @ApiParam({ name: 'id', description: 'Viewing request ID' })
  @ApiResponse({ status: 201, description: 'The updated viewing request.', schema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' } } } })
  async respondToViewing(
    @Param('id') viewingRequestId: string,
    @Body()
    body: RespondToViewingDto,
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
