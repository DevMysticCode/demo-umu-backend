import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { NotificationsService } from './notifications.service';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';

/**
 * HTTP surface for the shared in-app notifications tray.
 *
 *   GET  /notifications                    — recent notifications for me
 *   GET  /notifications/unread-count       — small { count } payload for
 *                                             the bell-badge poll
 *   POST /notifications/:id/read           — mark one read (tap in tray)
 *   POST /notifications/read-all           — bulk "mark all" from the
 *                                             tray header
 *
 * Preferences (push/email/in-app on/off per category) will come with the
 * settings screen in a later phase; the service methods for that
 * (getEffectivePreferences / updatePreferences) already exist.
 */
@Controller('notifications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @ApiOperation({ summary: "List the caller's recent notifications", description: 'Returns recent in-app notifications for the signed-in user, newest first, optionally paginated backwards from a given timestamp.' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max rows to return, clamped to 1-100.' })
  @ApiQuery({ name: 'before', required: false, description: 'ISO timestamp - only notifications older than this.' })
  @ApiResponse({
    status: 200,
    description: 'Notification rows, newest first.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          userId: { type: 'string' },
          type: { type: 'string', description: "e.g. 'new_message' | 'viewing_request' | 'viewing_response' | 'passport_shared' | 'passport_unlocked' | 'invite_accepted'" },
          title: { type: 'string' },
          body: { type: 'string' },
          actionUrl: { type: 'string', description: 'Relative deep-link path the app navigates to on tap' },
          entityType: { type: 'string', nullable: true, description: "'conversation' | 'viewing' | 'passport' | 'property'" },
          entityId: { type: 'string', nullable: true },
          readAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @Get()
  async list(
    @Request() req: any,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const parsedLimit = limit ? Math.max(1, Math.min(100, +limit)) : undefined;
    const parsedBefore = before ? new Date(before) : undefined;
    return this.notifications.listForUser(req.user.id, {
      limit: parsedLimit,
      before: parsedBefore,
    });
  }

  @ApiOperation({ summary: 'Get unread notification count', description: 'Small { count } payload powering the notification bell badge; polled periodically by the frontend.' })
  @ApiResponse({ status: 200, description: 'Unread count.', schema: { type: 'object', properties: { count: { type: 'number' } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @Get('unread-count')
  async unread(@Request() req: any) {
    const count = await this.notifications.unreadCount(req.user.id);
    return { count };
  }

  @ApiOperation({ summary: 'Mark one notification read', description: "Marks a single notification in the caller's tray as read (tapped)." })
  @ApiParam({ name: 'id', description: 'Notification ID' })
  @ApiResponse({ status: 201, description: 'Count of rows updated (0 or 1 - idempotent, and a mismatched/foreign id is silently a no-op).', schema: { type: 'object', properties: { updated: { type: 'number' } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @Post(':id/read')
  async markRead(@Param('id') id: string, @Request() req: any) {
    return this.notifications.markRead(req.user.id, id);
  }

  @ApiOperation({ summary: 'Mark all notifications read', description: "Bulk-marks every one of the caller's notifications as read, from the tray header's \"mark all\" action." })
  @ApiResponse({ status: 201, description: 'Count of rows updated.', schema: { type: 'object', properties: { updated: { type: 'number' } } } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @Post('read-all')
  async markAllRead(@Request() req: any) {
    return this.notifications.markAllRead(req.user.id);
  }
}
