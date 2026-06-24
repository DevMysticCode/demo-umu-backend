import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { validateEnv } from './common/env.validation';
import { initSentry } from './common/sentry';

// Fail fast if the runtime env is misconfigured — better to crash on
// boot than to discover at first request that DATABASE_URL or
// JWT_SECRET is missing. See ./common/env.validation for the schema.
validateEnv(process.env);

// Sentry must be initialised BEFORE NestFactory.create so its
// http/express auto-instrumentation can monkey-patch the runtime.
// No-op when SENTRY_DSN is unset.
initSentry();

async function bootstrap() {
  // rawBody: true tells Nest's body-parser to keep the raw bytes on
  // req.rawBody as well as the parsed body. The Persona webhook handler
  // needs the raw bytes to compute its HMAC signature.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // helmet — security headers. crossOriginResourcePolicy is loosened
  // because the mobile webapp + Capacitor shells fetch /uploads/* from
  // a different origin; the default 'same-origin' would break image
  // rendering. CSP is intentionally OFF: this is an API, not a page
  // server, and a CSP for HTML responses wouldn't apply to JSON.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    }),
  );

  // Global exception filter — strips Prisma error internals and stack
  // traces from client responses while logging the full detail server-
  // side. Without this, unhandled throws leak table/column names.
  app.useGlobalFilters(new AllExceptionsFilter());

  // Static serving — PUBLIC buckets only. Sensitive buckets
  // (documents/, anything containing user PII like passport answer
  // files) deliberately MISS this mount, so a direct GET /uploads/
  // /documents/abc.pdf 404s. Those files must be fetched via the
  // signed-URL endpoint /files/:bucket/:filename (see FilesController).
  //
  // In S3 mode (production), public buckets serve directly from S3 via
  // the bucket's public DNS — App Runner never sees those requests, so
  // we skip the static mount entirely. Disk mode (local dev) keeps the
  // per-bucket allow-list so adding a new public bucket is explicit.
  if (!process.env.S3_UPLOADS_BUCKET) {
    const uploadsRoot = join(process.cwd(), 'uploads');
    const publicBuckets = ['avatars', 'job-photos', 'property-images'];
    for (const bucket of publicBuckets) {
      app.useStaticAssets(join(uploadsRoot, bucket), { prefix: `/uploads/${bucket}` });
    }
  }

  // CORS allow-list driven by env. Comma-separated origins (full
  // scheme+host, no trailing slash). Falls back to a sensible default
  // covering local dev and the Capacitor mobile shells when the env
  // var is unset — never permits the audit-flagged `origin: true,
  // credentials: true` combo, which would let any site read responses
  // from authenticated browsers.
  //
  // Set CORS_ORIGINS on Railway to your real production hosts:
  //   CORS_ORIGINS=https://app.umovingu.com,https://www.umovingu.com,capacitor://localhost
  const defaultOrigins = [
    'http://localhost:3000',
    'http://localhost:3002',
    'https://demo-umu-frontend.vercel.app',
    'capacitor://localhost', // iOS Capacitor webview
    'ionic://localhost',     // legacy Capacitor scheme on Android
    'http://localhost',
    'https://localhost',
  ];
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const allowList = corsOrigins.length ? corsOrigins : defaultOrigins;

  app.enableCors({
    origin: allowList,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
