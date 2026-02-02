import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { PassportModule } from './passport/passport.module';
import { TaskModule } from './task/task.module';
import { QuestionModule } from './question/question.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    PassportModule,
    TaskModule,
    QuestionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
