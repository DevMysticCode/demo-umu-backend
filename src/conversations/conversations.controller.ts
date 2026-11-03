import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
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
  @ApiProperty()
  @IsString()
  body: string;
}

class StartConversationDto {
  @ApiProperty({ enum: CONVERSATION_CONTEXTS })
  @IsIn(CONVERSATION_CONTEXTS)
  context: ConversationContext;

  @ApiProperty()
  @IsString()
  contextId: string;

  @ApiProperty()
  @IsString()
  peerUserId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  selfRole?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  peerRole?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  initialMessage?: string;
}

// Shared shape for a single proposed/chosen viewing slot — see
// ViewingRequestsService's Slot interface.
class ViewingSlotDto {
  @ApiProperty()
  @IsString()
  startISO: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  endISO?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  label?: string;
}

class CreateViewingRequestDto {
  @ApiProperty()
  @IsString()
  invitedUserId: string;

  @ApiProperty({ type: [ViewingSlotDto] })
  @ValidateNested({ each: true })
  @Type(() => ViewingSlotDto)
  slots: ViewingSlotDto[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  message?: string;
}

class RespondToViewingDto {
  @ApiProperty({ enum: ['accept', 'decline', 'reschedule'] })
  @IsIn(['accept', 'decline', 'reschedule'])
  action: 'accept' | 'decline' | 'reschedule';

  @ApiProperty({ type: ViewingSlotDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => ViewingSlotDto)
  chosenSlot?: ViewingSlotDto;

  @ApiProperty({ type: [ViewingSlotDto], required: false })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ViewingSlotDto)
  proposedSlots?: ViewingSlotDto[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  message?: string;
}

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
@ApiBearerAuth('access-token')
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
