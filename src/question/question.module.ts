import { Module } from '@nestjs/common';
import { QuestionService } from './question.service';
import { QuestionController } from './question.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '../passport/passport.module';

@Module({
  imports: [PrismaModule, JwtModule, PassportModule],
  providers: [QuestionService],
  controllers: [QuestionController],
})
export class QuestionModule {}
