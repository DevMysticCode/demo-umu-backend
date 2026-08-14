import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RewardsController } from './rewards.controller';
import { RewardsService } from './rewards.service';
import { StampEvaluatorService } from './stamp-evaluator';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, JwtModule.register({ secret: process.env.JWT_SECRET })],
  controllers: [RewardsController],
  providers: [RewardsService, StampEvaluatorService],
  exports: [RewardsService, StampEvaluatorService],
})
export class RewardsModule {}
