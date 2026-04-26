import { Module } from '@nestjs/common';
import { BuyerProfileController } from './buyer-profile.controller';
import { BuyerProfileService } from './buyer-profile.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BuyerProfileController],
  providers: [BuyerProfileService],
})
export class BuyerProfileModule {}
