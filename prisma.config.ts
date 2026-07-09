// Prisma configuration — replaces the deprecated `package.json#prisma`
// block (Prisma 6 emits a warn, Prisma 7 removes it). Prisma's CLI
// picks this file up automatically because it sits at the project
// root next to package.json.
//
// `dotenv/config` is imported here so scripts run outside of Nest
// (e.g. `prisma db seed` in CI, `prisma migrate deploy` on Railway)
// still see DATABASE_URL from .env / the platform env.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // The old package.json block only registered the seed command; we
  // mirror it here so `prisma db seed` still runs the same script.
  migrations: {
    seed: 'ts-node prisma/seed.ts',
  },
});
