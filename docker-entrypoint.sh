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

exec "$@"
