import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { ViewingRequestsService } from './viewing-requests.service';

/**
 * Shared conversations + viewing-requests. Every messaging surface in
 * the app funnels through here so the storage shape stays consistent
 * and notifications fan out from one place.
 *
 * Exports both services so downstream modules (e.g. PassportModule for
 * the share-with-buyer endpoint added in Ticket 3.5) can start a
 * conversation without going through HTTP.
 */
@Module({
  imports: [PrismaModule, JwtModule, NotificationsModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, ViewingRequestsService],
  exports: [ConversationsService, ViewingRequestsService],
})
export class ConversationsModule {}
