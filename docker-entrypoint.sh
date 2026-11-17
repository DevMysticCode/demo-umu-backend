#!/bin/sh
# Container entrypoint — runs in production on App Runner.
#
# App Runner injects RDS credentials as separate env vars (DB_HOST,
# DB_PORT, DB_NAME, DB_USER, DB_PASSWORD) because Secrets Manager
# delivers each JSON key individually. Prisma + the env validator
# expect a single libpq URL in DATABASE_URL, so assemble it here
# before exec'ing node.
#
# Production-only: if DATABASE_URL is already set (local docker run
# with a .env file, CI tests, etc.) we leave it alone.

if [ -z "${DATABASE_URL}" ] && [ -n "${DB_HOST}" ]; then
  # URL-encode the password in case it contains special characters —
  # RDS-generated passwords can include /, +, =, etc.
  ENCODED_PASS=$(node -e "process.stdout.write(encodeURIComponent(process.env.DB_PASSWORD || ''))")
  export DATABASE_URL="postgresql://${DB_USER}:${ENCODED_PASS}@${DB_HOST}:${DB_PORT:-5432}/${DB_NAME}?schema=public&sslmode=require"
  echo "[entrypoint] DATABASE_URL assembled from DB_* env vars (host=${DB_HOST})"
fi

# Apply committed, reviewed migrations against the live database on
# every boot. `prisma migrate deploy` only runs migrations that are
# in `prisma/migrations/` and not yet recorded as applied — unlike
# `db push --accept-data-loss` (what this used to run), it never
# infers or applies an un-reviewed destructive schema change on its
# own. Cost is ~1-2 seconds per cold start when there's nothing new
# to apply; App Runner cold-starts are rare in production (only on
# new image deploys + manual restarts).
#
# Why this lives in the entrypoint instead of a separate one-shot
# migration job: RDS is in an isolated subnet with no Internet
# Gateway and no NAT. The only way to reach it is from inside the
# VPC — App Runner via its VPC connector is the simplest such path.
# A separate bastion EC2 or in-VPC Lambda would work but adds
# operational surface.
#
# Set PRISMA_SKIP_DB_PUSH=true to suppress (e.g. for a hotfix deploy
# where the schema hasn't changed and you want a faster cold start).
if [ "${PRISMA_SKIP_DB_PUSH:-false}" != "true" ]; then
  echo "[entrypoint] Applying Prisma migrations (prisma migrate deploy)..."
  if npx --offline prisma migrate deploy 2>&1; then
    echo "[entrypoint] Migrations applied."
  else
    echo "[entrypoint] WARN: prisma migrate deploy failed — continuing anyway, the app may 503 on DB calls."
  fi
fi

exec "$@"
