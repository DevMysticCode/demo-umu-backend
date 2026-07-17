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
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

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

  @Get('unread-count')
  async unread(@Request() req: any) {
    const count = await this.notifications.unreadCount(req.user.id);
    return { count };
  }

  @Post(':id/read')
  async markRead(@Param('id') id: string, @Request() req: any) {
    return this.notifications.markRead(req.user.id, id);
  }

  @Post('read-all')
  async markAllRead(@Request() req: any) {
    return this.notifications.markAllRead(req.user.id);
  }
}
