import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { PushModule } from '../push/push.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

/**
 * Home for the shared notifications fan-out + HTTP surface.
 * NotificationsService is exported so other modules can inject it
 * (ConversationsService + PassportService already do).
 */
@Module({
  imports: [PrismaModule, JwtModule, PushModule],
  providers: [NotificationsService],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
