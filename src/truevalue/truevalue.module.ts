import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TrueValueController } from './truevalue.controller';
import { TrueValueService } from './truevalue.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, JwtModule.register({ secret: process.env.JWT_SECRET })],
  controllers: [TrueValueController],
  providers: [TrueValueService],
})
export class TrueValueModule {}
