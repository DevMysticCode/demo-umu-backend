import { Module } from '@nestjs/common';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RewardsModule } from '../rewards/rewards.module';

@Module({
  imports: [PrismaModule, RewardsModule],
  controllers: [KycController],
  providers: [KycService],
  exports: [KycService],
})
export class KycModule {}
