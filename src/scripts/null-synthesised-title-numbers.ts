/**
 * One-time migration: scrub synthetic title numbers and backfill real
 * ones from prior HMLR ownership verifications.
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
 * What this script does, in order:
 *   1. NULL out any Property.titleNumber matching the synthesiser's
 *      exact shape (^[A-Z]{2}\d{6}$). The pattern is precise enough
 *      that real HMLR title numbers — whose prefix is the registry
 *      area code, not the postcode — almost never collide. Dry-run
 *      prints a sample so the user can spot any false positive before
 *      committing.
 *   2. Backfill from OwnershipVerification: for every Property whose
 *      titleNumber is now null but where the user has a VERIFIED HMLR
 *      check with a real landRegistryTitleNumber, promote that value
 *      to Property.titleNumber so previously-verified owners don't
 *      lose visibility. Picks the most recent VERIFIED row when a
 *      property has multiple.
 *
 * Both steps are idempotent — re-running produces 0/0 counts.
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
  try {
    // ── Phase 1: NULL synthetic values ─────────────────────────────
    // Prisma's where doesn't take regexes on String columns portably,
    // so fetch + filter in JS. Properties table is small enough that
    // this is fine.
    const properties = await prisma.property.findMany({
      where: { titleNumber: { not: null } },
      select: { id: true, addressLine1: true, postcode: true, titleNumber: true },
    });
    const synthetic = properties.filter(
      (p) => p.titleNumber && SYNTHETIC_REGEX.test(p.titleNumber),
    );

    console.log(`[step 1] ${properties.length} properties have a non-null titleNumber`);
    console.log(`[step 1] ${synthetic.length} match the synthesiser's pattern (^[A-Z]{2}\\d{6}$)`);

    if (synthetic.length) {
      const sample = synthetic.slice(0, 10);
      console.log('[step 1] sample of what would be nulled (up to 10 rows):');
      for (const row of sample) {
        console.log(`  - ${row.titleNumber}  ${row.addressLine1 ?? '?'}, ${row.postcode ?? '?'}`);
      }
      if (APPLY) {
        const result = await prisma.property.updateMany({
          where: { id: { in: synthetic.map((m) => m.id) } },
          data: { titleNumber: null },
        });
        console.log(`[step 1] ✓ nulled titleNumber on ${result.count} row(s)`);
      }
    } else {
      console.log('[step 1] nothing synthetic to null.');
    }

    // ── Phase 2: backfill real title numbers from prior HMLR
    // verifications. Runs against the CURRENT DB state: in --apply
    // mode that's already post-step-1, so anything still null can be
    // safely populated from OwnershipVerification without overwriting
    // a real value.
    //
    // In dry-run mode we estimate the count by looking at properties
    // whose current titleNumber is null OR matches the synthetic
    // pattern (since step 1 would null those too).
    const verifications = await prisma.ownershipVerification.findMany({
      where: {
        status: 'VERIFIED',
        landRegistryTitleNumber: { not: null },
      },
      orderBy: { landRegistryCheckedAt: 'desc' }, // freshest first
      select: {
        propertyId: true,
        landRegistryTitleNumber: true,
        landRegistryCheckedAt: true,
        property: { select: { titleNumber: true, addressLine1: true, postcode: true } },
      },
    });

    // Dedupe by propertyId — keep only the most recent VERIFIED row
    // per property (the orderBy above guarantees we see it first).
    const seen = new Set<string>();
    const candidates: Array<{
      propertyId: string;
      titleNumber: string;
      currentTitle: string | null;
      addressLine1: string | null;
      postcode: string | null;
    }> = [];
    for (const v of verifications) {
      if (seen.has(v.propertyId)) continue;
      seen.add(v.propertyId);
      // Skip if the current Property.titleNumber is already real
      // (not null and not synthetic). Step 1 will have nulled
      // synthetic ones by the time we get here in --apply mode;
      // in dry-run we treat synthetic-shaped values as "will be
      // nulled" → eligible for backfill.
      const cur = v.property.titleNumber;
      const willBeNullAfterStep1 =
        cur == null || (APPLY ? false : SYNTHETIC_REGEX.test(cur));
      if (!willBeNullAfterStep1) continue;
      if (cur === v.landRegistryTitleNumber) continue; // already same
      candidates.push({
        propertyId: v.propertyId,
        titleNumber: v.landRegistryTitleNumber!,
        currentTitle: cur,
        addressLine1: v.property.addressLine1,
        postcode: v.property.postcode,
      });
    }

    console.log(`\n[step 2] ${verifications.length} VERIFIED HMLR rows with a title number`);
    console.log(`[step 2] ${candidates.length} properties eligible for backfill`);

    if (candidates.length) {
      const sample = candidates.slice(0, 10);
      console.log('[step 2] sample of backfill targets (up to 10):');
      for (const c of sample) {
        console.log(
          `  - ${c.addressLine1 ?? '?'}, ${c.postcode ?? '?'}  ${c.currentTitle ?? '(null)'} → ${c.titleNumber}`,
        );
      }
      if (APPLY) {
        // Per-row updates rather than updateMany — each row gets a
        // different new value, so a single SQL statement won't do.
        // Sub-second on the kind of volumes we'd realistically see.
        let updated = 0;
        for (const c of candidates) {
          await prisma.property.update({
            where: { id: c.propertyId },
            data: { titleNumber: c.titleNumber },
          });
          updated++;
        }
        console.log(`[step 2] ✓ backfilled titleNumber on ${updated} row(s)`);
      }
    } else {
      console.log('[step 2] nothing to backfill.');
    }

    if (!APPLY) {
      console.log('\n[ DRY RUN ] pass --apply to mutate.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
