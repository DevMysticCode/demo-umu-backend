# UMU Backend — Deployment

Production deployment runs on Railway against a managed Postgres. This
doc lists what the runtime expects and how it boots. The env validator
([src/common/env.validation.ts](src/common/env.validation.ts)) is the
canonical source — if you see a mismatch, the validator wins.

## Required env vars

| Var | Always | Prod only | Format | Notes |
|---|---|---|---|---|
| `DATABASE_URL` | ✓ | | `postgres(ql)://user:pass@host:port/db` | Railway provides this automatically |
| `JWT_SECRET` | ✓ | | string ≥ 16 chars | `openssl rand -hex 32`. Rotating invalidates every existing token |
| `STRIPE_SECRET_KEY` | | ✓ | `sk_test_*` or `sk_live_*` | Production must use a live key |
| `RESEND_API_KEY` | | ✓ | string | Without it, OTP send fails (dev falls back to console.log) |
| `ADMIN_SECRET` | | ✓ | string ≥ 16 chars, not "123" | Used by verifier-api admin endpoints |
| `CORS_ORIGINS` | | ✓ | comma-separated origins | e.g. `https://demo-umu-frontend.vercel.app,capacitor://localhost` |

The validator exits the process with a clear error if any required
var is missing or malformed. Run with `NODE_ENV=production` to enable
prod-only checks.

## Optional env vars

| Var | Purpose |
|---|---|
| `NODE_ENV` | `development` (default), `production`, `test` |
| `PORT` | Listen port — defaults to 3000 (Dockerfile uses 3000; Railway injects this) |
| `SENTRY_DSN` | Enables Sentry error tracking. No-op when unset |
| `SENTRY_ENV` | Overrides Sentry environment tag (defaults to `NODE_ENV`) |
| `SENTRY_RELEASE` | Build SHA for issue grouping. Recommended in prod |
| `SENTRY_TRACES_SAMPLE_RATE` | `0`–`1`, default `0` (errors only) |
| `GROQ_API_KEY` | Chat + AI passport summaries. Feature disabled when unset |
| `GOOGLE_API_KEY` | Google Maps Street View. Feature disabled when unset |
| `OS_API_KEY` | Ordnance Survey Places. Property search degrades when unset |
| `PERSONA_API_KEY`, `PERSONA_WEBHOOK_SECRET`, `PERSONA_TEMPLATE_ID` | Persona KYC integration |
| `HMLR_PFX_PATH`, `HMLR_PFX_PASSPHRASE` | HM Land Registry ownership verification |
| `FRONTEND_URL` | Used for share-link URL building. Defaults to `http://localhost:3000` |

## Boot sequence

1. `dotenv/config` loads `.env`
2. `validateEnv(process.env)` — exits 1 if any required var missing/malformed
3. `initSentry()` — no-op when `SENTRY_DSN` unset
4. `NestFactory.create(AppModule, { rawBody: true })`
5. `helmet()` + `useGlobalFilters(new AllExceptionsFilter())`
6. Static `/uploads/*` mount
7. `app.enableCors({ origin: CORS_ORIGINS || dev defaults })`
8. `app.listen(PORT)`

## Health checks

- `GET /health` — composite check, returns 200 + JSON when all green, 503
  if any indicator fails. Database ping with 5s timeout. **Use this for
  load-balancer/uptime monitor probes.**
- `GET /health/live` — cheap process-is-up probe. Returns `{ status: 'ok',
  uptime }` immediately. Use for Kubernetes liveness vs readiness split.

Both are `@SkipThrottle` so monitor polling doesn't trigger rate limits.

## Docker

```sh
# build
docker build -t umu-backend:local .

# run with local .env
docker run --rm -p 3000:3000 --env-file .env umu-backend:local

# Railway: add `[build] builder = "DOCKERFILE"` to railway.toml to use
# this image instead of the default Nixpacks build.
```

The image runs as non-root `node` user under `tini` (PID 1, forwards
SIGTERM cleanly). HEALTHCHECK hits `/health` every 30s.

## Migrations

Schema changes follow:

```sh
# 1. Stop the dev backend (Windows file lock on prisma DLL)
# 2. Edit prisma/schema.prisma
# 3. Push to dev DB (local or Railway dev environment)
npx prisma db push --accept-data-loss
# 4. Regenerate client
npx prisma generate
# 5. Restart
npm run start:dev
```

For production, `npx prisma migrate deploy` should run as a release
phase (e.g. Railway pre-deploy hook) before the new app version takes
over traffic.

## Backups

**Not yet configured.** Railway Postgres can be backed up via:
- Railway dashboard → Postgres service → Backups (managed snapshots)
- `pg_dump` on a schedule (add as a GitHub Action with `secrets.DATABASE_URL`)

Both should be set up before real users land.

## Secrets management

- All env vars listed above belong in Railway env, never in the repo.
- The `.claude/settings.local.json` file (per-developer Claude
  permissions) is gitignored and **must never be committed** —
  it captures `Bash(DATABASE_URL=… npx prisma …)` invocations
  verbatim. The previous leak of the Railway password came via this
  file.
- A `gitleaks` pre-commit hook lives at `.githooks/pre-commit`. Activate
  per-developer with `git config core.hooksPath .githooks`. GitHub
  Actions also runs gitleaks on every push/PR (see [.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Logs

NestJS's default logger writes to stdout — Railway captures and displays
in the dashboard. Pair with `SENTRY_DSN` for unhandled error grouping +
release tracking.

There are still ~74 `console.log` calls scattered across the codebase
(DF4 hygiene finding). Replace with `this.logger.debug(...)`
opportunistically when touching the file — once they're all on the
NestJS logger, structured logging shipping (Datadog, Better Stack)
becomes a one-config change.

## Known gaps (audit follow-ups)

These are docs-now / code-later — see commits `51c1538` onwards for the
hardening already shipped, and the DF4 Labs gap analysis PDF for the
full inventory.

- **Payment paywall not enforced** — `passport.service.ts:createBuyerAccess` does
  not check payment state; Stripe webhook handler does not exist. Live
  Stripe deploy needs both before flipping to `sk_live_*`.
- **Uploads on local disk** — `./uploads/*` is lost on Railway redeploy.
  Migrating to S3/R2 is now a one-class change via
  [src/common/storage.ts](src/common/storage.ts).
- **`/uploads/*` is publicly served** — sensitive files (documents,
  KYC) reachable by URL. Either gate via a `GET /files/:id` endpoint
  or migrate to S3 with pre-signed URLs.
- **`isKycVerified()` exists but isn't wired** to anything that should
  require KYC. Helper is at [src/common/kyc.ts](src/common/kyc.ts).
- **Land Registry Price Paid import** — `pricePaidTransaction` table is
  queried but never populated.
