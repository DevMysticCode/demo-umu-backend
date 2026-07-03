import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
import { PaymentModule } from './payment/payment.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { BuyerProfileModule } from './buyer-profile/buyer-profile.module';
import { KycModule } from './kyc/kyc.module';
import { VerifierApiModule } from './verifier-api/verifier-api.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { HealthModule } from './health/health.module';
import { FilesModule } from './files/files.module';
import { PushModule } from './push/push.module';

// MaintenanceModule exposes destructive endpoints (`DELETE
// /maintenance/all` nukes every passport + property) gated only by a
// shared `x-admin-secret` header. That's fine for local dev seeding,
// dangerous in production — a single secret leak = total data loss.
// Until we replace the header gate with real admin auth + audit log,
// the module simply doesn't load in production builds.
const PROD_BUILD = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    // Global rate limit applied via the APP_GUARD below. Named buckets
    // let controllers/handlers opt into stricter limits with @Throttle
    // — see AuthController, where OTP/login/register tighten to a few
    // requests/min on top of the default. Tune ttl/limit by env if you
    // need to: ttl is in milliseconds in throttler v6+.
    ThrottlerModule.forRoot([
      // Default bucket: 300 req / minute / IP. A single explore-page
      // mount fans out to a dozen API calls (profile, saved, wishlist,
      // feed, notifications, homescore lookup, enrichment sub-calls),
      // and behind a CDN the throttler often groups multiple real
      // users behind one edge IP — 60/min tripped the "Too many
      // requests" toast for genuine users. 300 still stops a bot
      // hammering a single endpoint (that would be 5/sec sustained,
      // trivial to detect elsewhere).
      { name: 'default', ttl: 60_000, limit: 300 },
      // Tight bucket for credential-sensitive endpoints. Brute force
      // an OTP at 5/min and it'll take a year to cover a 6-digit space.
      { name: 'auth',    ttl: 60_000, limit: 5  },
    ]),
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
    PaymentModule,
    // Only available in non-production envs — see PROD_BUILD comment above.
    ...(PROD_BUILD ? [] : [MaintenanceModule]),
    BuyerProfileModule,
    KycModule,
    VerifierApiModule,
    MarketplaceModule,
    HealthModule,
    FilesModule,
    PushModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Apply the throttler as a global guard so every route gets the
    // default bucket unless it opts in to a named one. JwtAuthGuard
    // stays per-controller; this guard runs alongside it.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
