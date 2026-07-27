# UMU Backend — Deployment

Production runs on **AWS** (App Runner + RDS + S3 + ECR + Secrets
Manager, provisioned via CDK). Railway was the original TestFlight-era
host; data was migrated Railway → RDS and AWS is now the real
production target. Full infra operations (bootstrap, teardown, custom
domain, rollback, cost breakdown) live in
[infra/RUNBOOK.md](infra/RUNBOOK.md) — this doc covers the app-level
contract (env vars, boot sequence, health checks) plus the day-to-day
"ship a code change" and "change a config value" flows.

## Architecture at a glance

| Component | What it is | AWS Console location |
|---|---|---|
| **App Runner** service `umu-backend` | Runs the container, public HTTPS endpoint | App Runner → Services → `umu-backend` |
| **RDS Postgres** | Primary database, private subnet | RDS → Databases → `umufoundation-...` |
| **S3 bucket** | File uploads (avatars, documents, property images) | S3 → bucket name from `S3_UPLOADS_BUCKET` secret |
| **ECR repo** `umu-backend` | Docker image registry App Runner pulls from | ECR → Repositories → `umu-backend` |
| **Secrets Manager** | `umu/prod/app` (app config) + `umu/prod/db-credentials` (DB) | Secrets Manager → Secrets |
| **CloudFormation stacks** | `UmuFoundation` (VPC/RDS/S3/ECR/secrets) + `UmuCompute` (App Runner) | CloudFormation → Stacks |

Live URL: `https://ijfai9mgwj.eu-west-2.awsapprunner.com` (custom domain
`api.umovingu.com` can be associated — see RUNBOOK "Custom domain").

## Environment variables

Unlike Railway (env vars typed directly into a dashboard), AWS env vars
are split two ways:

1. **Plain runtime vars** — set directly on the App Runner service
   config (`NODE_ENV`, `PORT`). Rarely change.
2. **Secrets** — everything sensitive (`JWT_SECRET`, `STRIPE_SECRET_KEY`,
   `CORS_ORIGINS`, DB credentials, API keys, etc.) lives in **Secrets
   Manager**, not on the service directly. App Runner is configured to
   pull each one at deploy time and inject it as a normal env var
   inside the container — the app code just reads `process.env.X` same
   as always; it has no idea Secrets Manager exists.

Two secrets:
- `umu/prod/app` — one JSON blob, one key per env var (`JWT_SECRET`,
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`,
  `ADMIN_SECRET`, `CORS_ORIGINS`, `PERSONA_*`, `HMLR_*`, `GOOGLE_API_KEY`,
  `OS_API_KEY`, `GROQ_API_KEY`, `SENTRY_DSN`, `S3_UPLOADS_BUCKET`)
- `umu/prod/db-credentials` — `host`, `dbname`, `username`, `password`,
  `port` (auto-generated + rotated by RDS/CDK)

**Important gotcha**: secrets are resolved **once, at container start**
— not polled live. Changing a value in Secrets Manager does nothing
to the already-running instance until you trigger a new deployment:

```powershell
aws apprunner start-deployment --service-arn <arn> --region eu-west-2
```

### How to change one env var value

The whole `umu/prod/app` secret is a single JSON blob, so you can't
edit one field via the console without pasting the whole thing back.
Safest path (get → modify one key → put):

```powershell
aws secretsmanager get-secret-value --secret-id umu/prod/app `
  --region eu-west-2 --query SecretString --output text > current.json
# edit current.json, change only the field you need
aws secretsmanager put-secret-value --secret-id umu/prod/app `
  --secret-string file://current.json --region eu-west-2
Remove-Item current.json   # never leave secrets on disk
aws apprunner start-deployment --service-arn <arn> --region eu-west-2
```

(The AWS Console's Secrets Manager UI has an "Edit" button that opens
the same JSON in a text box if you prefer clicking through it instead.)

## Required env vars (reference)

| Var | Always | Prod only | Format | Notes |
|---|---|---|---|---|
| `DATABASE_URL` / `DB_HOST`+`DB_NAME`+`DB_USER`+`DB_PASSWORD`+`DB_PORT` | ✓ | | | Railway used one `DATABASE_URL`; AWS injects the split `DB_*` vars from `umu/prod/db-credentials` |
| `JWT_SECRET` | ✓ | | string ≥ 16 chars | `openssl rand -hex 32`. Rotating invalidates every existing token |
| `STRIPE_SECRET_KEY` | | ✓ | `sk_test_*` or `sk_live_*` | Production must use a live key |
| `STRIPE_WEBHOOK_SECRET` | | ✓ | `whsec_*` | From Stripe → Webhooks → endpoint signing secret. **Required**: without it the paywall webhook rejects every event |
| `RESEND_API_KEY` | | ✓ | string | Without it, OTP send fails (dev falls back to console.log) |
| `ADMIN_SECRET` | | ✓ | string ≥ 16 chars, not "123" | Used by verifier-api admin endpoints |
| `CORS_ORIGINS` | | ✓ | comma-separated origins | Current prod value: `https://demo-umu-frontend.vercel.app`, `capacitor://localhost` (iOS bundled-mode default scheme), `https://localhost` (**Android** bundled-mode default scheme — easy to forget, missing this silently breaks login/every API call from the Android app with no obvious error beyond a failed fetch), `http://localhost:3000`, `http://localhost:3002` — add real production domains here when they exist |
| `S3_UPLOADS_BUCKET` | | ✓ | bucket name | When set, uploads go to S3 instead of container disk (see below) |

The validator ([src/common/env.validation.ts](src/common/env.validation.ts))
exits the process with a clear error if any required var is missing or
malformed. Run with `NODE_ENV=production` to enable prod-only checks.

## Optional env vars

| Var | Purpose |
|---|---|
| `NODE_ENV` | `development` (default), `production`, `test` |
| `PORT` | Listen port — App Runner uses 3000 |
| `SENTRY_DSN` | Enables Sentry error tracking. No-op when unset |
| `SENTRY_ENV` | Overrides Sentry environment tag (defaults to `NODE_ENV`) |
| `SENTRY_RELEASE` | Build SHA for issue grouping. Recommended in prod |
| `SENTRY_TRACES_SAMPLE_RATE` | `0`–`1`, default `0` (errors only) |
| `GROQ_API_KEY` | Chat + AI passport summaries. Feature disabled when unset |
| `GOOGLE_API_KEY` | Google Maps Street View. Feature disabled when unset |
| `OS_API_KEY` | Ordnance Survey Places. Property search degrades when unset |
| `PERSONA_API_KEY`, `PERSONA_WEBHOOK_SECRET`, `PERSONA_TEMPLATE_ID` | Persona KYC integration |
| `HMLR_PFX_PATH`/`HMLR_CERT_PATH`+`HMLR_KEY_PATH`, `HMLR_PFX_PASSPHRASE`, `HMLR_OV_ENDPOINT`, `HMLR_USERNAME`, `HMLR_PASSWORD` | HM Land Registry ownership verification |
| `FRONTEND_URL` | Used for share-link URL building. Defaults to `http://localhost:3000` |

## Boot sequence

1. `dotenv/config` loads `.env` (local dev only — AWS injects env vars directly, no `.env` file in the image)
2. `validateEnv(process.env)` — exits 1 if any required var missing/malformed
3. `initSentry()` — no-op when `SENTRY_DSN` unset
4. `NestFactory.create(AppModule, { rawBody: true })`
5. `helmet()` + `useGlobalFilters(new AllExceptionsFilter())`
6. Static `/uploads/*` mount — **skipped entirely when `S3_UPLOADS_BUCKET` is set** (prod)
7. `app.enableCors({ origin: CORS_ORIGINS || dev defaults })`
8. `app.listen(PORT)`

## Health checks

- `GET /health` — composite check, returns 200 + JSON when all green, 503
  if any indicator fails. Database ping with 5s timeout. **Use this for
  load-balancer/uptime monitor probes.**
- `GET /health/live` — cheap process-is-up probe. Returns `{ status: 'ok',
  uptime }` immediately. This is what App Runner's own health check hits
  (`HealthCheckConfiguration.Path` on the service).

Both are `@SkipThrottle` so monitor polling doesn't trigger rate limits.

## Shipping a code change (the common case)

```powershell
.\infra\scripts\build-and-push.ps1
```

This builds the image (`--platform linux/amd64` — required, App Runner
won't run arm64), tags it with both `latest` and the current git SHA,
pushes both to ECR. `AutoDeploymentsEnabled` is on for the service, so
App Runner picks up the new `:latest` image and rolls out automatically
(~30s to notice, ~2-3 min total rollout). No manual "deploy" step needed
beyond running the script. See [infra/RUNBOOK.md](infra/RUNBOOK.md) for
rollback (re-tag an old SHA as `latest`, or `apprunner start-deployment`
on a specific revision).

## Docker

```sh
# build
docker build -t umu-backend:local .

# run with local .env
docker run --rm -p 3000:3000 --env-file .env umu-backend:local
```

The image runs as non-root `node` user under `tini` (PID 1, forwards
SIGTERM cleanly). HEALTHCHECK hits `/health` every 30s.

## Migrations

Local/dev schema changes follow the usual Prisma flow:

```sh
# 1. Stop the dev backend (Windows file lock on prisma DLL)
# 2. Edit prisma/schema.prisma
# 3. Push to dev DB
npx prisma db push --accept-data-loss
# 4. Regenerate client
npx prisma generate
# 5. Restart
npm run start:dev
```

**Production (RDS) is in a private subnet** — there's no direct network
path to it from a laptop. To run a migration/`db push` against prod:
spin up a temporary bastion EC2 in the public subnet (or a Lambda in the
same VPC), tunnel through it, run the Prisma command, then tear the
bastion down. Full walkthrough (this is exactly how the Railway → RDS
data migration was done) in
[infra/RUNBOOK.md](infra/RUNBOOK.md#migrating-data-from-railway--rds).

There have been no new `prisma/migrations/*` folders since the RDS
migration, so schema is currently in sync — but this is a manual step,
not part of `build-and-push.ps1`, so check before assuming a deploy
picked up a schema change.

## Backups

RDS point-in-time recovery is enabled with 30-day retention
(`deletionProtection: true`, snapshot-on-destroy). No separate scheduled
`pg_dump` job is set up beyond that — acceptable for now, revisit before
a large volume of real user data accumulates.

## File uploads (S3)

Resolved — [src/common/storage.ts](src/common/storage.ts) switches
automatically based on whether `S3_UPLOADS_BUCKET` is set:
- **Set (prod/AWS)**: uploads stream straight to S3 via `multer-s3`.
  Public buckets (`avatars`, `job-photos`, `property-images`) are
  `public-read`; everything else (documents, passport docs) stays
  private and is served through the existing HMAC-signed `/files/...`
  route.
- **Unset (local dev)**: falls back to disk at `./uploads/<bucket>/...`,
  no AWS credentials needed.

This is what fixes the old "uploads disappear on every redeploy"
problem App Runner's ephemeral container disk would otherwise cause.

## Secrets management

- Production secrets live in AWS Secrets Manager (`umu/prod/app`,
  `umu/prod/db-credentials`) — never in the repo, never in `.env`.
- The `.claude/settings.local.json` file (per-developer Claude
  permissions) is gitignored and **must never be committed** — it can
  capture raw credential strings verbatim from command history.
- A `gitleaks` pre-commit hook lives at `.githooks/pre-commit`. Activate
  per-developer with `git config core.hooksPath .githooks`. GitHub
  Actions also runs gitleaks on every push/PR (see [.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Logs

App Runner ships stdout/stderr to CloudWatch Logs automatically
(`/aws/apprunner/umu-backend/.../application`). Pair with `SENTRY_DSN`
for unhandled error grouping + release tracking.

There are still ~74 `console.log` calls scattered across the codebase
(DF4 hygiene finding). Replace with `this.logger.debug(...)`
opportunistically when touching the file — once they're all on the
NestJS logger, structured logging shipping (Datadog, Better Stack)
becomes a one-config change.

## Stripe webhook setup (required before live)

1. Stripe Dashboard → Developers → Webhooks → **Add endpoint**
2. URL: `https://ijfai9mgwj.eu-west-2.awsapprunner.com/payment/webhook`
   (or the custom domain once associated)
3. Events to send:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `payment_intent.canceled`
   - `charge.refunded`
4. Save → copy the signing secret (`whsec_...`)
5. Update `STRIPE_WEBHOOK_SECRET` in the `umu/prod/app` secret (see
   "How to change one env var value" above), then `start-deployment`.

Without this, the paywall **gracefully degrades** because
`createBuyerAccess` falls back to a synchronous Stripe API re-fetch —
but you lose the async webhook safety net. Set it before flipping to
`sk_live_*`.

## Mobile (iOS/Android) build modes

Today's TestFlight/Play builds run in **REMOTE** mode: the Capacitor
shell opens a WebView pointing at the Vercel deployment
(`demo-umu-frontend.vercel.app`). Apple/Google may flag this as
"minimum functionality" (Apple Guideline 4.2) since it's effectively a
wrapped website rather than a bundled app.

For real store submission, switch to **BUNDLED** mode:

```sh
# build the SPA bundle into .output/public + sync to native shells
npm run mobile:build:bundled

# both env vars are required together — the npm script above only
# sets CAPACITOR_BUILD, not CAPACITOR_USE_REMOTE:
$env:CAPACITOR_USE_REMOTE = "false"

# then re-sync so capacitor.config.ts picks up the remote=false branch
npx cap sync

# Android: open Android Studio, build a signed .aab
npx cap open android
# iOS: no ios/ project is currently checked into this repo — it needs
# `npx cap add ios` run fresh on a Mac (or macOS CI), then Xcode for
# signing + archive + submit.
npx cap open ios
```

Both modes coexist via env vars:
- `CAPACITOR_BUILD=true` → nuxt.config.ts disables SSR (SPA bundle)
- `CAPACITOR_USE_REMOTE=false` → capacitor.config.ts drops `server.url`

The default (no env vars) keeps remote-mode behaviour so the existing
TestFlight pipeline doesn't break until this is explicitly switched.

Whichever mode, `NUXT_PUBLIC_API_BASE` needs to point at the real AWS
URL (`https://ijfai9mgwj.eu-west-2.awsapprunner.com` or the custom
domain) for a store-submitted build — not `localhost`.

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
- **Sensitive uploads bucket-by-bucket**: `documents/` is gated via
  signed URLs (commit `f90e25b`). `kyc/` (when created) and marketplace
  `evidence/` (currently sharing `job-photos/`) should follow the same
  pattern.
- **Land Registry Price Paid import** — `pricePaidTransaction` table
  is queried but never populated.
- **Land Registry Title Number Discovery** — `Property.titleNumber`
  is now null until HMLR confirms (commit `46e4c1b`). Adding the
  paid HMLR Title Number Discovery subscription (~£40/mo) populates
  it for unclaimed properties too.
- **HMLR live account** — mTLS cert + username (`OpenProperty`) are
  confirmed working against the production Business Gateway, but the
  account isn't fully provisioned for the Online Owner Verification
  product yet (generic `System Error occurred` fault after a
  successful login). Needs a support ticket to HMLR to activate OOV
  on the account.
- **No CloudWatch alarms configured yet** — RUNBOOK has the
  `put-metric-alarm` command for a 5xx-rate alarm; not yet run.
- **OS_API_KEY is on an exhausted OS Data Hub free-trial plan** —
  confirmed by calling the OS Places API directly with the deployed
  key: `{"faultstring":"Free Trial allowance exceeded"}` (also hits a
  50-req/min rate limit on top of that). This is why property search
  returns empty results even though the NAT gateway fix (below)
  restored real network connectivity. Needs an OS Data Hub plan
  upgrade or a new key — not something fixable from this repo/infra.
- **Outbound internet from App Runner requires the VPC's NAT gateway**
  (fixed 2026-07-27, commit `20fc758`) — the VPC connector needed for
  RDS access routes ALL outbound traffic through the VPC, not just DB
  calls. `natGateways: 0` meant every third-party API call (OS Places,
  EPC, Resend, Stripe, Groq, HMLR, Persona) failed with a connect
  timeout. Now `natGateways: 1` (~£30-35/mo) via a `private-egress`
  subnet group; RDS stays in `isolated` (still no internet route).
  Also added the missing `RESEND_FROM` secret value (was silently
  falling back to Resend's sandbox sender). If OTP emails are still
  not arriving after this, check `RESEND_API_KEY`'s own quota/domain
  verification status on Resend's dashboard next — the "silent
  failure" pattern in `sendOtpEmail` (see AuthService) doesn't check
  the SDK's `{data, error}` return, so a rejected send is invisible in
  logs. Worth fixing to `if (error) { throw ... }` so future failures
  actually surface.
