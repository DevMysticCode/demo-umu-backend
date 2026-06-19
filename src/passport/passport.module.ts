import { Module } from '@nestjs/common';
import { PassportService } from './passport.service';
import { PassportController } from './passport.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { PaymentModule } from '../payment/payment.module';
import { PushModule } from '../push/push.module';

@Module({
  // PaymentModule imported so createBuyerAccess can call
  // PaymentService.hasSuccessfulPayment before granting access.
  // PushModule imported so we can notify users on collaboration
  // invites + buyer unlocks.
  imports: [PrismaModule, JwtModule, PaymentModule, PushModule],
  providers: [PassportService],
  controllers: [PassportController],
  exports: [PassportService],
})
export class PassportModule {}
