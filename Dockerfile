# syntax=docker/dockerfile:1.7
#
# Multi-stage Dockerfile for the UMU NestJS backend.
#
# Stages:
#   deps    — install ALL deps (incl. devDeps) for build
#   build   — compile TS → JS, run `prisma generate`
#   runtime — slim runtime image with prod deps only + compiled output
#
# Runtime image runs as the non-root `node` user with PORT 3000.
# Healthcheck hits /health (composite check, see HealthController).
#
# Build:
#   docker build -t umu-backend:local .
#
# Run (local):
#   docker run --rm -p 3000:3000 --env-file .env umu-backend:local
#
# Railway: ships an auto-generated Nixpacks build by default; this
# Dockerfile is the explicit override. Add `[build] builder = "DOCKERFILE"`
# to railway.toml to switch.

ARG NODE_VERSION=20-alpine

# ────────────────────────────────────────────────────────────────
# deps — install all deps (dev + prod) for the build stage
# ────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# OpenSSL is required by Prisma's query engine on Alpine.
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
# `--ignore-scripts` skips the prisma postinstall; we run it explicitly
# in the build stage once the schema has been COPYed in.
RUN npm ci --ignore-scripts


# ────────────────────────────────────────────────────────────────
# build — compile TypeScript + generate Prisma client
# ────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS build
WORKDIR /app

RUN apk add --no-cache openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate the Prisma client against the bundled schema, then compile.
RUN npx prisma generate
RUN npm run build


# ────────────────────────────────────────────────────────────────
# runtime — slim image: prod deps + compiled output only
# ────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN apk add --no-cache openssl wget tini

# Prod-only deps (no jest/eslint/etc.) and skip the prisma postinstall
# again — we copy the generated client from the build stage.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Compiled output + Prisma artifacts + the schema (some Prisma calls
# need the schema at runtime).
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/prisma ./prisma

# Persistent uploads dir — created with permissive perms so the
# non-root `node` user can write. A real deployment should mount a
# volume or migrate to S3/R2 instead of relying on container disk.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

# tini = PID 1 → forwards signals, reaps zombies. NestJS handles
# SIGTERM cleanly but tini makes sure it actually receives it under
# orchestrators that send signals to PID 1.
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/src/main.js"]
