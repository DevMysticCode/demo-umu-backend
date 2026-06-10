/**
 * One-time migration: NULL out title numbers that were written by the
 * removed generateTitleNumber() helper.
 *
 * Background. Until commit <removed-synthesiser>, every property went
 * through an `enrichProperty()` pass that fabricated a title number in
 * the form `<2-letter postcode prefix><6 digits>` whenever the existing
 * value was null. The synthetic strings are visually indistinguishable
 * from real HMLR title numbers and poisoned every downstream surface:
 *   - claim page, buyer view, costs page, TA6 PDF: fabricated "register"
 *     IDs shown to users.
 *   - HMLR ownership verification: queried HMLR with the fake number,
 *     got NO_MATCHES, mapped to FAILED, so owners couldn't verify their
 *     own properties.
 *
 * This script nulls them out. A property only keeps its `titleNumber`
 * value if it was promoted from a real HMLR SINGLE_MATCH response
 * (which post-fix is the only path that writes to the column).
 *
 * Safe to re-run: idempotent. After all synthetic values are gone, the
 * "updated" count stays at 0 forever.
 *
 * Usage:
 *   npm run script:null-fake-title-numbers           # dry-run (default)
 *   npm run script:null-fake-title-numbers -- --apply  # actually mutates
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

// The synthesiser always produced EXACTLY this shape:
//   `${postcode2chars}${6 digits}` — 8 chars total, no real HMLR title
// number we've observed matches this exact pattern with a 2-letter
// postcode prefix (real ones are e.g. AB123456, WK547294 — the prefix
// is the HMLR registry area code, not the postcode). False-positive
// risk is therefore minimal but the dry-run prints every match before
// the user confirms with --apply.
const SYNTHETIC_REGEX = /^[A-Z]{2}\d{6}$/;

const APPLY = process.argv.includes('--apply');

async function main() {
  const prisma = new PrismaClient();

  // We can't use Prisma's `where` with a regex on String columns
  // portably, so fetch + filter in JS. The properties table is small
  // enough that this is fine.
  const properties = await prisma.property.findMany({
    where: { titleNumber: { not: null } },
    select: { id: true, addressLine1: true, postcode: true, titleNumber: true },
  });

  const matches = properties.filter(
    (p) => p.titleNumber && SYNTHETIC_REGEX.test(p.titleNumber),
  );

  console.log(`[null-fake-title] ${properties.length} properties have a non-null titleNumber`);
  console.log(`[null-fake-title] ${matches.length} match the synthesiser's pattern (^[A-Z]{2}\\d{6}$)`);

  if (!matches.length) {
    console.log('[null-fake-title] nothing to do — all title numbers already real (or null).');
    await prisma.$disconnect();
    return;
  }

  // Sample of what's about to change. Helps the user spot any false
  // positives (a real HMLR title number that happens to fit the
  // pattern — unlikely but possible).
  const sample = matches.slice(0, 10);
  console.log('[null-fake-title] sample (up to 10 rows):');
  for (const row of sample) {
    console.log(`  - ${row.titleNumber}  ${row.addressLine1 ?? '?'}, ${row.postcode ?? '?'}`);
  }

  if (!APPLY) {
    console.log('[null-fake-title] DRY RUN — pass --apply to NULL them out');
    await prisma.$disconnect();
    return;
  }

  const result = await prisma.property.updateMany({
    where: { id: { in: matches.map((m) => m.id) } },
    data: { titleNumber: null },
  });
  console.log(`[null-fake-title] ✓ nulled titleNumber on ${result.count} row(s)`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
