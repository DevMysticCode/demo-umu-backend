import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { PassportModule } from './passport/passport.module';
import { TaskModule } from './task/task.module';
import { QuestionModule } from './question/question.module';
import { PropertyModule } from './property/property.module';
import { OnboardingModule } from './onboarding/onboarding.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    PassportModule,
    TaskModule,
    QuestionModule,
    PropertyModule,
    OnboardingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
