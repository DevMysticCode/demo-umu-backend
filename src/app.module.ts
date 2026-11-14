import { Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
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
import { AdminModule } from './admin/admin.module';
import { BuyerProfileModule } from './buyer-profile/buyer-profile.module';
import { RewardsModule } from './rewards/rewards.module';
import { TrueValueModule } from './truevalue/truevalue.module';
import { KycModule } from './kyc/kyc.module';
import { VerifierApiModule } from './verifier-api/verifier-api.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { HealthModule } from './health/health.module';
import { FilesModule } from './files/files.module';
import { PushModule } from './push/push.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ConversationsModule } from './conversations/conversations.module';
import { CaptureModule } from './capture/capture.module';
import { LlcModule } from './llc/llc.module';

// MaintenanceModule exposes destructive endpoints (`DELETE
// /maintenance/all` nukes every passport + property) gated only by a
// shared `x-admin-secret` header. That's fine for local dev seeding,
// dangerous in production — a single secret leak = total data loss.
// Until we replace the header gate with real admin auth + audit log,
// the module simply doesn't load in production builds.
const PROD_BUILD = process.env.NODE_ENV === 'production';

// Security/launch review finding #11: the throttler's default storage
// is an in-memory Map — fine for a single instance, but counters reset
// per-process and aren't shared once there's more than one (anything
// behind a load balancer, App Runner/ECS auto-scaling, etc.), so the
// same client gets a fresh limit on every instance it happens to land
// on. Switching to Redis-backed storage when REDIS_URL is set — and
// falling back to the existing in-memory storage, logged once, when
// it isn't — means this is ready to scale out without a second code
// change, but doesn't force a Redis dependency on anyone still running
// single-instance (dev, or the pilot before Redis is provisioned).
function buildThrottlerStorage(): ThrottlerStorage | undefined {
  const url = process.env.REDIS_URL;
  if (!url) {
    if (PROD_BUILD) {
      new Logger('ThrottlerStorage').warn(
        'REDIS_URL is not set - rate-limit counters are in-memory and ' +
          'per-instance. Fine for a single instance; set REDIS_URL before ' +
          'running more than one (security/launch review finding #11).',
      );
    }
    return undefined; // @nestjs/throttler's own in-memory default
  }
  return new ThrottlerStorageRedisService(url);
}

@Module({
  imports: [
    // Global rate limit applied via the APP_GUARD below. Named buckets
    // let controllers/handlers opt into stricter limits with @Throttle
    // — see AuthController, where OTP/login/register tighten to a few
    // requests/min on top of the default. Tune ttl/limit by env if you
    // need to: ttl is in milliseconds in throttler v6+.
    ThrottlerModule.forRoot({
      throttlers: [
        // Default bucket: 300 req / minute / IP in prod. In dev everything
        // runs against a single loopback IP, and rapid iteration with a
        // browser open (hot-reload triggering re-fetches, DevTools
        // network panel re-issuing requests) blew past 60 within seconds.
        // Bumped to a very generous limit in dev so `npm run start:dev`
        // never surfaces 429 to the engineer testing a real request.
        // Prod still enforces 300/min so a bot hammering one endpoint
        // trips the guard at ~5 rps sustained — plenty for real traffic
        // (an explore-page mount fans out to ~a dozen API calls) but
        // trivial to detect.
        {
          name: 'default',
          ttl: 60_000,
          limit: process.env.NODE_ENV === 'production' ? 300 : 10_000,
        },
        // NOTE: credential-sensitive endpoints (OTP/login/register) do NOT
        // get a second globally-registered named bucket here — every named
        // throttler registered in this array applies to EVERY route by
        // default (nestjs-throttler v6 semantics: a route must opt OUT via
        // @SkipThrottle({name: true}) per bucket name, and bare
        // @SkipThrottle() only opts out of 'default'). A previously-added
        // 'auth' bucket here was silently rate-limiting the entire API to
        // 5 req/min/IP — /tasks/:id/questions, /property/search, etc. —
        // even though those routes had @SkipThrottle() (which only skips
        // 'default'). Fixed by having AuthController's @Throttle(...)
        // override the *existing* 'default' bucket's limit down to 5 for
        // just those routes, instead of introducing a second global bucket.
        // See AUTH_THROTTLE in auth.controller.ts.
      ],
      storage: buildThrottlerStorage(),
    }),
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
    // Narrow, always-available admin actions (currently just delete-user-
    // by-email) — deliberately NOT gated by PROD_BUILD like MaintenanceModule
    // above. See admin.controller.ts for why this one's safe in prod.
    AdminModule,
    BuyerProfileModule,
    RewardsModule,
    TrueValueModule,
    KycModule,
    VerifierApiModule,
    MarketplaceModule,
    HealthModule,
    FilesModule,
    PushModule,
    NotificationsModule,
    ConversationsModule,
    CaptureModule,
    LlcModule,
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
