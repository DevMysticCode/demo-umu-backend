import { Module } from '@nestjs/common';
import { PropertyController } from './property.controller';
import { PropertyService } from './property.service';
import { RunningCostsService } from './running-costs.service';
import { FloodRiskService } from './flood-risk.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PassportModule } from '../passport/passport.module';

@Module({
  imports: [PrismaModule, AuthModule, PassportModule],
  controllers: [PropertyController],
  providers: [PropertyService, RunningCostsService, FloodRiskService],
  exports: [PropertyService, RunningCostsService, FloodRiskService],
})
export class PropertyModule {}
