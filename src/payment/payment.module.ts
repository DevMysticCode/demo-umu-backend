import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PaymentController],
  providers: [PaymentService],
  // Exported so PassportModule's createBuyerAccess can call hasSuccessfulPayment.
  exports: [PaymentService],
})
export class PaymentModule {}
