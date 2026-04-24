import { Module } from '@nestjs/common';
import { BuyerPassportController } from './buyer-passport.controller';
import { BuyerPassportService } from './buyer-passport.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BuyerPassportController],
  providers: [BuyerPassportService],
})
export class BuyerPassportModule {}
