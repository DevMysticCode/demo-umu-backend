import { Module } from '@nestjs/common';
import { PassportService } from './passport.service';
import { PassportController } from './passport.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { PaymentModule } from '../payment/payment.module';
import { PushModule } from '../push/push.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FilesModule } from '../files/files.module';

@Module({
  // PaymentModule imported so createBuyerAccess can call
  // PaymentService.hasSuccessfulPayment before granting access.
  // PushModule imported so we can notify users on collaboration
  // invites + buyer unlocks.
  // Conversations + Notifications imported so sharePassportWithBuyer
  // can open a thread + notify the recipient without going through
  // HTTP.
  // FilesModule imported so getPassport() can sign private-bucket file
  // URLs (passport-docs) before they reach the client — see the
  // resolveAnswerFileUrls comment in passport.service.ts.
  imports: [
    PrismaModule,
    // Bare `JwtModule` (no .register()) leaves JwtService with no secret
    // configured. AuthModule's registration is `global: true`, but a
    // module's own local import of the same provider shadows the global
    // one for that module's injector - so every JwtAuthGuard-protected
    // route on PassportController (including /passport/create) got a
    // JwtService that threw "secret or public key must be provided" on
    // every verify() call, surfaced to callers as "Invalid or expired
    // token" regardless of how valid the token actually was. Match every
    // other module in the app (capture/documents/llc/profile/push/
    // rewards/truevalue) and register it with the real secret.
    JwtModule.register({ secret: process.env.JWT_SECRET }),
    PaymentModule,
    PushModule,
    ConversationsModule,
    NotificationsModule,
    FilesModule,
  ],
  providers: [PassportService],
  controllers: [PassportController],
  exports: [PassportService],
})
export class PassportModule {}
