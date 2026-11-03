import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { join } from 'path';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { validateEnv, warnIfHmlrLooksLikeTestStub } from './common/env.validation';
import { initSentry } from './common/sentry';
import { isSafeToRenderInline } from './common/storage';
import { ALLOWED_ORIGINS } from './common/cors-origins';
import { swaggerBasicAuth } from './common/swagger-basic-auth';
import { buildFilteredDocument } from './common/swagger-filter-document';
import { WEBSITE_INTEGRATION_API_ALLOWLIST } from './common/website-integration-api-allowlist';

// Fail fast if the runtime env is misconfigured — better to crash on
// boot than to discover at first request that DATABASE_URL or
// JWT_SECRET is missing. See ./common/env.validation for the schema.
validateEnv(process.env);
// Non-fatal — see env.validation.ts's comment on this function for why
// this isn't in the fatal `checks` list above.
warnIfHmlrLooksLikeTestStub(process.env);

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

  // Production runs behind exactly one reverse-proxy hop (AWS App
  // Runner). Without this, Express's req.ip is either the proxy's own
  // address (if it forwards a raw socket) or undefined behaviour reading
  // X-Forwarded-For - either way, ThrottlerGuard's per-IP rate limits
  // (AUTH_THROTTLE etc.) could silently collapse every real client onto
  // one bucket instead of actually discriminating between them. `1` means
  // trust exactly one hop in front of this app, not an open-ended chain -
  // this does NOT make req.ip spoofable by a client's own X-Forwarded-For,
  // since only the proxy-adjacent hop is trusted (security review, 13 Oct
  // 2026).
  app.set('trust proxy', 1);

  // Raise the JSON/urlencoded body limit above express's 100kb default.
  // Some legitimate payloads are large: a signed inventory answer carries
  // the whole room-by-room record PLUS base64 signature-canvas PNGs for
  // the landlord and tenant, which blew past 100kb and 500'd with
  // PayloadTooLargeError on POST /questions/:id/answer. File uploads go
  // through multer (its own limits), not these parsers.
  app.useBodyParser('json', { limit: '15mb' });
  app.useBodyParser('urlencoded', { limit: '15mb', extended: true });

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
      app.useStaticAssets(join(uploadsRoot, bucket), {
        prefix: `/uploads/${bucket}`,
        setHeaders: (res, path) => {
          // Defence in depth on top of the upload-time mimetype
          // allow-list (storage.ts): a scoped CSP that denies this
          // response any script/style/frame capability even if it were
          // ever interpreted as HTML/SVG, plus nosniff so the browser
          // never overrides our Content-Type by sniffing bytes, plus
          // `attachment` for any file whose extension isn't one this
          // app's own upload pipeline can produce (covers anything
          // uploaded before this fix existed).
          res.setHeader(
            'Content-Security-Policy',
            "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          );
          res.setHeader('X-Content-Type-Options', 'nosniff');
          if (!isSafeToRenderInline(path)) {
            res.setHeader('Content-Disposition', 'attachment');
          }
        },
      });
    }
  }

  // CORS allow-list driven by env. Comma-separated origins (full
  // scheme+host, no trailing slash). Falls back to a sensible default
  // covering local dev and the Capacitor mobile shells when the env
  // var is unset.
  //
  // Set CORS_ORIGINS on the AWS App Runner service (the production
  // deploy target - Railway is UAT/demo only) to your real production
  // hosts (security review 2026-09-22, L7 - this comment used to say
  // "Railway" instead):
  //   CORS_ORIGINS=https://app.umovingu.com,https://www.umovingu.com,capacitor://localhost
  // List itself lives in common/cors-origins.ts, shared with
  // frontend-url.ts's link-building logic — the two must never drift apart.
  //
  // credentials: true (auth hardening, 12 Oct 2026): the refresh token
  // moved out of localStorage into an httpOnly cookie (see
  // auth.controller.ts's refresh/:app route), so the browser now needs
  // permission to send/receive cookies cross-origin. Safe to combine with
  // credentials here specifically because `origin` above is always a
  // concrete allow-list, never `true`/`'*'` - the previously-flagged
  // dangerous combo (security review 2026-09-22, L6) was credentials with
  // a WILDCARD origin, not credentials with an explicit list.
  app.use(cookieParser());
  app.enableCors({
    origin: ALLOWED_ORIGINS(),
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Swagger/OpenAPI docs at /docs. This lists every route, param and
  // DTO shape — for a property-tech API handling passports, documents
  // and buyer financial data, that's itself a real information-
  // disclosure surface if left open on a public deploy (same class of
  // concern as the debug-endpoint/test-credential findings from the
  // 2026-09-22/2026-10-19 security reviews). On by default in dev;
  // off by default everywhere else unless SWAGGER_ENABLED=true is set
  // explicitly, so a one-off production/staging review doesn't need a
  // code change, but nobody has to remember to turn it off again next
  // deploy — the default is closed.
  const swaggerEnabled =
    process.env.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true';
  // A second, narrower doc at /pentest-docs — only the endpoints
  // umu-website-integration actually calls (common/website-integration-
  // api-allowlist.ts), for handing to an external pen-testing vendor
  // without also exposing the other two frontends' surface or
  // internal/admin-only routes. Independent on/off switch and its own
  // creds (never shared with SWAGGER_USER/PASSWORD) so revoking the
  // vendor's access after the engagement can't accidentally lock out
  // internal /docs use, or vice versa.
  const pentestDocsEnabled = process.env.PENTEST_DOCS_ENABLED === 'true';
  if (swaggerEnabled || pentestDocsEnabled) {
    const config = new DocumentBuilder()
      .setTitle('UmovingU API')
      .setDescription(
        'umu-backend — NestJS/Prisma API behind the UmovingU frontends (mobile app, website-integration, website-new). ' +
          'Most endpoints require a Bearer access token obtained from /auth/login or /auth/verify-otp — click ' +
          '"Authorize" above and paste the token (no "Bearer " prefix needed) to enable "Try it out" on them.',
      )
      .setVersion(process.env.npm_package_version ?? '0.0.1')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token',
      )
      .build();
    const document = SwaggerModule.createDocument(app, config);

    if (swaggerEnabled) {
      // Enabling the docs (even deliberately, for a one-off prod review)
      // must not also leave them unauthenticated — that was the gap: the
      // SWAGGER_ENABLED flag controlled whether the full route/DTO map
      // was exposed at all, but nothing gated who could read it once it
      // was. validateEnv() (common/env.validation.ts) makes
      // SWAGGER_USER/SWAGGER_PASSWORD mandatory whenever SWAGGER_ENABLED
      // is set in production, so this can't boot in a half-closed state.
      // Left optional in dev for local convenience — set both locally
      // too if you want to test the gate itself.
      const swaggerUser = process.env.SWAGGER_USER;
      const swaggerPassword = process.env.SWAGGER_PASSWORD;
      if (swaggerUser && swaggerPassword) {
        app.use(['/docs', '/docs-json'], swaggerBasicAuth(swaggerUser, swaggerPassword));
      }
      // Must be registered before SwaggerModule.setup() below — its
      // handlers write the response directly without calling next(), so
      // middleware registered after it never runs for a real /docs hit.
      // Search engines have no business indexing an internal API's
      // route map, gated or not.
      app.use(['/docs', '/docs-json'], (_req: any, res: any, next: any) => {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        next();
      });
      SwaggerModule.setup('docs', app, document, {
        swaggerOptions: {
          persistAuthorization: true,
          // Alphabetical tag/operation order and a search box — with 34
          // tags and 293 operations, the unsorted default (declaration
          // order across ~25 controller files) made finding a given
          // endpoint mostly a matter of knowing which file it lived in.
          tagsSorter: 'alpha',
          operationsSorter: 'alpha',
          filter: true,
        },
      });
    }

    if (pentestDocsEnabled) {
      // Always gated, in every environment — unlike /docs there is no
      // dev-convenience "open if creds are unset" fallback, because this
      // path's entire purpose is handing a scoped API surface to an
      // external vendor. validateEnv() refuses to boot if
      // PENTEST_DOCS_ENABLED=true without both creds set.
      const pentestUser = process.env.PENTEST_DOCS_USER as string;
      const pentestPassword = process.env.PENTEST_DOCS_PASSWORD as string;
      app.use(
        ['/pentest-docs', '/pentest-docs-json'],
        swaggerBasicAuth(pentestUser, pentestPassword),
      );
      app.use(['/pentest-docs', '/pentest-docs-json'], (_req: any, res: any, next: any) => {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        next();
      });
      const filtered = buildFilteredDocument(
        document,
        WEBSITE_INTEGRATION_API_ALLOWLIST,
        'UmovingU API — website-integration surface',
        'Scoped subset of the UmovingU API: only the endpoints the website-integration frontend ' +
          'actually calls (see src/common/website-integration-api-allowlist.ts). Published for ' +
          'third-party penetration testing — the other two frontends and all internal/admin-only ' +
          'routes are deliberately absent from this document.',
      );
      SwaggerModule.setup('pentest-docs', app, filtered, {
        swaggerOptions: {
          persistAuthorization: true,
          tagsSorter: 'alpha',
          operationsSorter: 'alpha',
          filter: true,
        },
      });
    }
  }

  // Bind explicitly to 0.0.0.0 so Railway's edge proxy (IPv4) can
  // reach us. Without the host arg, Express on Node 17+ can end up
  // bound only to ::1 (IPv6 localhost) inside the container, which
  // is why the "Nest application successfully started" line never
  // reached the logs and the public URL returned ERR_NAME_NOT_RESOLVED
  // / gateway errors even though the app was clearly booting.
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[main] listening on 0.0.0.0:${port}`);
}
bootstrap();
