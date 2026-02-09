import { Module } from '@nestjs/common';
import { TaskService } from './task.service';
import { TaskController } from './task.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '../passport/passport.module';

@Module({
  imports: [PrismaModule, JwtModule, PassportModule],
  providers: [TaskService],
  controllers: [TaskController],
})
export class TaskModule {}
