import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VerifierApiService } from './verifier-api.service';
import {
  BuyerProfileAccessController,
  BuyerProfileGrantController,
  VerifierPublicController,
  VerifierAdminController,
} from './verifier-api.controller';

@Module({
  controllers: [
    BuyerProfileAccessController,
    BuyerProfileGrantController,
    VerifierPublicController,
    VerifierAdminController,
  ],
  providers: [VerifierApiService, PrismaService],
  exports: [VerifierApiService],
})
export class VerifierApiModule {}
