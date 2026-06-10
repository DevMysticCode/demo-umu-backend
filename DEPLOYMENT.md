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
| `STRIPE_WEBHOOK_SECRET` | | ✓ | `whsec_*` | From Stripe → Webhooks → endpoint signing secret. **Required**: without it the paywall webhook rejects every event |
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

## Stripe webhook setup (required before live)

1. Stripe Dashboard → Developers → Webhooks → **Add endpoint**
2. URL: `https://<your-api-host>/payment/webhook`
3. Events to send:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `payment_intent.canceled`
   - `charge.refunded`
4. Save → copy the signing secret (`whsec_...`)
5. Set as `STRIPE_WEBHOOK_SECRET` on Railway

Without this, the £99 passport-unlock paywall **gracefully degrades**
because `createBuyerAccess` falls back to a synchronous Stripe API
re-fetch — but you lose the async webhook safety net. Set it before
flipping to `sk_live_*`.

## Mobile (iOS) build modes

Today's TestFlight build runs in **REMOTE** mode: the Capacitor shell
opens a WKWebView pointing at the Vercel deployment. Apple may flag
this on full review as "minimum functionality" (Guideline 4.2).

For App Store submission switch to **BUNDLED** mode:

```sh
# build the SPA bundle into .output/public + sync to ios/
npm run mobile:build:bundled

# in your env, before re-running cap sync from a fresh shell:
$env:CAPACITOR_USE_REMOTE = "false"

# open Xcode for signing + archive + submit
npx cap open ios
```

Both modes coexist via env vars:
- `CAPACITOR_BUILD=true` → nuxt.config.ts disables SSR (SPA bundle)
- `CAPACITOR_USE_REMOTE=false` → capacitor.config.ts drops `server.url`

The default (no env vars) keeps remote-mode behaviour so the existing
TestFlight pipeline doesn't break until you explicitly switch.

## Known gaps (audit follow-ups)

These are docs-now / code-later — see commit history from `51c1538`
onwards for the hardening already shipped, and the DF4 Labs gap
analysis PDF for the full inventory.

- **Claim-flow payment gate** — `createBuyerAccess` is now gated
  (commit `33ecd81`), but the plain `POST /passport` (owner-claim)
  flow has no payment check. DF4 only named buyer-unlock; revisit
  if owners should also pay to claim.
- **`isKycVerified()` exists but isn't wired** to anything that should
  require KYC. Helper is at [src/common/kyc.ts](src/common/kyc.ts).
  Needs product decision on what KYC gates (recommendation: claim +
  buyer-unlock).
- **Uploads on local disk** — `./uploads/*` is lost on Railway
  redeploy. Migrating to S3/R2 is now a one-class change via
  [src/common/storage.ts](src/common/storage.ts).
- **Sensitive uploads bucket-by-bucket**: `documents/` is now gated
  via signed URLs (commit `f90e25b`). `kyc/` (when created) and
  marketplace `evidence/` (currently sharing `job-photos/`) should
  follow the same pattern.
- **Land Registry Price Paid import** — `pricePaidTransaction` table
  is queried but never populated.
- **Land Registry Title Number Discovery** — `Property.titleNumber`
  is now null until HMLR confirms (commit `46e4c1b`). Adding the
  paid HMLR Title Number Discovery subscription (~£40/mo) populates
  it for unclaimed properties too.
