import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RewardsModule } from '../rewards/rewards.module';
import { PassportModule } from '../passport/passport.module';

@Module({
  imports: [
    PrismaModule,
    // So register() can auto-accept any pending "add collaborator" invite
    // sent to this email before the account existed (see
    // AuthService.register -> PassportService.acceptPendingCollaboratorInvites).
    PassportModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      // Shortened from 7d to 1h now that a proper refresh-token flow exists
      // (AuthService.refresh) — the access token's blast radius if leaked
      // is now an hour, not a week, and the frontend silently exchanges it
      // for a new one via /auth/refresh before/when it expires (security
      // review follow-up, 2026-09-25).
      signOptions: { expiresIn: '1h' },
    }),
    RewardsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
