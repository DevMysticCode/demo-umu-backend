/**
 * One-off backfill for the PassportAchievement celebration feature.
 *
 * `UserStamp.celebratedAt` was added after stamps already existed in the
 * database. Null means "not yet shown to the user" — without this backfill,
 * every pre-existing stamp (earned before the celebration feature shipped)
 * would surface as a brand-new celebration the next time each of those
 * users opens the app, even though they already know about it.
 *
 * Sets celebratedAt = awardedAt for every row where celebratedAt is still
 * null, i.e. treats "already existed before this feature shipped" as
 * "already seen." Idempotent — safe to re-run (only touches null rows).
 *
 * Usage:
 *   npm run backfill:stamp-celebrated-at
 */

import { PrismaClient } from '@prisma/client';

const path = require('path');
const fs = require('fs');
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (match) {
      const [, key, value] = match;
      if (!process.env[key]) process.env[key] = value.trim().replace(/^"|"$/g, '');
    }
  }
}

const prisma = new PrismaClient();

async function main() {
  const uncelebrated = await prisma.userStamp.findMany({
    where: { celebratedAt: null },
    select: { id: true, awardedAt: true },
  });

  if (!uncelebrated.length) {
    console.log('No uncelebrated stamps found — nothing to backfill.');
    return;
  }

  let updated = 0;
  for (const stamp of uncelebrated) {
    await prisma.userStamp.update({
      where: { id: stamp.id },
      data: { celebratedAt: stamp.awardedAt },
    });
    updated += 1;
  }

  console.log(`Backfilled celebratedAt on ${updated} pre-existing stamp(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
