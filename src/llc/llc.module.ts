import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { LlcController } from './llc.controller';
import { LlcService } from './llc.service';

@Module({
  imports: [PrismaModule, JwtModule.register({ secret: process.env.JWT_SECRET })],
  controllers: [LlcController],
  providers: [LlcService, JwtAuthGuard],
})
export class LlcModule {}
