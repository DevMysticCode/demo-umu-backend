/**
 * Drops the "Replaced the How to Rent guide (1 May 2026)" subtitle from
 * the landlord_how_to_rent section — client feedback: redundant now that
 * the withdrawn-guide link has also been removed from the drawer's
 * legislation-link list (INFO_SHEET_LINKS in
 * pages/passportview/landlord/[id].vue). The title itself ("Renters'
 * Rights Act Information Sheet") and the in-drawer "law changed" callout
 * explaining the withdrawal are untouched — only this one redundant
 * subtitle line goes.
 *
 * Same two-pass pattern as update-landlord-legal-copy.ts (which this
 * follows and does not duplicate — see that file's header for why both
 * SectionTemplate and PassportSection need updating). Idempotent.
 *
 * Usage:
 *   npm run remove:how-to-rent-subtitle
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
const SECTION_KEY = 'landlord_how_to_rent';

async function main() {
  const st = await prisma.sectionTemplate.findUnique({ where: { key: SECTION_KEY } });
  if (!st) {
    console.warn(`  SKIPPED SectionTemplate - not found: ${SECTION_KEY}`);
  } else {
    await prisma.sectionTemplate.update({
      where: { key: SECTION_KEY },
      data: { subtitle: '' },
    });
    console.log(`SectionTemplate updated: ${SECTION_KEY} subtitle cleared`);
  }

  const result = await prisma.passportSection.updateMany({
    where: { key: SECTION_KEY },
    data: { subtitle: '' },
  });
  console.log(`  PassportSection rows updated: ${result.count} (existing passports)`);

  console.log('\nDone.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
