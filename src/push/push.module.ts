import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { PushController } from './push.controller';
import { PushService } from './push.service';

@Module({
  imports: [
    PrismaModule,
    JwtModule.register({ secret: process.env.JWT_SECRET }),
  ],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
