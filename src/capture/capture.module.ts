import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt.guard';
import { CaptureController } from './capture.controller';
import { CaptureService } from './capture.service';

@Module({
  imports: [PrismaModule, JwtModule.register({ secret: process.env.JWT_SECRET })],
  controllers: [CaptureController],
  providers: [CaptureService, OptionalJwtAuthGuard],
})
export class CaptureModule {}
