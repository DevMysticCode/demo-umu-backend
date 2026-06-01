import { Module } from '@nestjs/common';
import { PropertyController } from './property.controller';
import { PropertyService } from './property.service';
import { RunningCostsService } from './running-costs.service';
import { FloodRiskService } from './flood-risk.service';
import { BillParserService } from './bill-parser.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PassportModule } from '../passport/passport.module';
import { LandRegistryModule } from '../land-registry/land-registry.module';

@Module({
  imports: [PrismaModule, AuthModule, PassportModule, LandRegistryModule],
  controllers: [PropertyController],
  providers: [PropertyService, RunningCostsService, FloodRiskService, BillParserService],
  exports: [PropertyService, RunningCostsService, FloodRiskService, BillParserService],
})
export class PropertyModule {}
