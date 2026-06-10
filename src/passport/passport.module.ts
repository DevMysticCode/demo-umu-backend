import { Module } from '@nestjs/common';
import { PassportService } from './passport.service';
import { PassportController } from './passport.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { PaymentModule } from '../payment/payment.module';

@Module({
  // PaymentModule imported so createBuyerAccess can call
  // PaymentService.hasSuccessfulPayment before granting access.
  imports: [PrismaModule, JwtModule, PaymentModule],
  providers: [PassportService],
  controllers: [PassportController],
  exports: [PassportService],
})
export class PassportModule {}
