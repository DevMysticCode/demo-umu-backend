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
import { CollectionModule } from './collection/collection.module';
import { ProfileModule } from './profile/profile.module';
import { DocumentsModule } from './documents/documents.module';
import { ChatModule } from './chat/chat.module';
import { CalendarModule } from './calendar/calendar.module';
import { SupportModule } from './support/support.module';
import { LearnModule } from './learn/learn.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    PassportModule,
    TaskModule,
    QuestionModule,
    PropertyModule,
    OnboardingModule,
    CollectionModule,
    ProfileModule,
    DocumentsModule,
    ChatModule,
    CalendarModule,
    SupportModule,
    LearnModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
