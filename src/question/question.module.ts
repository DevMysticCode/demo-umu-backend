import { Module } from '@nestjs/common';
import { QuestionService } from './question.service';
import { QuestionController } from './question.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '../passport/passport.module';
import { RewardsModule } from '../rewards/rewards.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  // DocumentsModule — reused for the Landlord Passport's multi-copy
  // certificate retention (client feedback items 1a/3). See
  // question.controller.ts's /copies endpoints.
  imports: [PrismaModule, JwtModule, PassportModule, RewardsModule, DocumentsModule],
  providers: [QuestionService],
  controllers: [QuestionController],
})
export class QuestionModule {}
