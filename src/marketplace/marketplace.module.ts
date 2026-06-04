import { Module } from '@nestjs/common';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { MarketplaceMessagesService } from './messages.service';
import { EscrowService } from './escrow.service';
import { ReviewsService } from './reviews.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MarketplaceController],
  providers: [MarketplaceService, MarketplaceMessagesService, EscrowService, ReviewsService],
  exports: [MarketplaceService, MarketplaceMessagesService, EscrowService, ReviewsService],
})
export class MarketplaceModule {}
