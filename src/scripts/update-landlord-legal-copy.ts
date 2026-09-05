/**
 * Corrects Landlord Passport content that went stale after the Renters'
 * Rights Act 2025 (in force 1 May 2026):
 *   - "How to Rent Guide" section -> "Renters' Rights Act Information
 *     Sheet" (the How to Rent guide was withdrawn; serving it is no
 *     longer valid). Key stays `landlord_how_to_rent` unchanged — only
 *     display copy changes, so nothing that references the key breaks
 *     (see TENANT_VISIBLE_SECTIONS in passport.service.ts).
 *   - "Tenancy Agreement (AST)" section -> drops the AST framing and the
 *     "blocks Section 21" wording — Section 21 was abolished, and new
 *     tenancies are assured periodic tenancies, not fixed-term ASTs.
 *
 * Two update passes per section, for two different reasons:
 *   1. SectionTemplate — the source of truth for any NEW landlord
 *      passport created from here on (seedPassportContent copies these
 *      values onto a fresh PassportSection at creation time).
 *   2. PassportSection — section title/subtitle/description are a
 *      snapshot taken at creation time, not a live join back to
 *      SectionTemplate (unlike QuestionTemplate, which IS read live
 *      through the join — see update-title-deeds-questions.ts). Without
 *      this pass, every landlord passport created before this script ran
 *      would keep showing the stale wording forever.
 *   3. QuestionTemplate (title/description) — read live through the
 *      join, so one update covers every existing + future
 *      PassportQuestion automatically. No PassportQuestion-level
 *      backfill needed.
 *
 * Idempotent — safe to re-run. Does NOT touch prisma/seed.ts's destructive
 * full reset; this only updates the two affected sections/questions.
 *
 * Usage:
 *   npm run update:landlord-legal-copy
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

const SECTION_UPDATES: {
  key: string;
  title: string;
  subtitle: string;
  description: string;
}[] = [
  {
    key: 'landlord_how_to_rent',
    title: "Renters' Rights Act Information Sheet",
    subtitle: 'Replaced the How to Rent guide (1 May 2026)',
    description:
      "The How to Rent guide was withdrawn under the Renters' Rights Act 2025. Serve the official GOV.UK Renters' Rights Act Information Sheet 2026 - a link on its own isn't valid, it must be a printed copy or a PDF attached to an email/text. Fines reach £7,000 for non-compliance.",
  },
  {
    key: 'landlord_ast',
    title: 'Tenancy Agreement',
    subtitle: 'The signed tenancy agreement',
    description:
      "The signed tenancy agreement setting out the tenant, term, rent and deposit. Fixed-term ASTs were replaced by assured periodic tenancies under the Renters' Rights Act 2025 - Section 21 can no longer be used.",
  },
];

const QUESTION_UPDATES: {
  sectionKey: string;
  taskKey: string;
  title: string;
  description: string;
}[] = [
  {
    sectionKey: 'landlord_how_to_rent',
    taskKey: 'how_to_rent_upload',
    title: "Renters' Rights Act Information Sheet served (PDF)",
    description: 'The signed/served copy given to the tenant - keep proof of service.',
  },
  {
    sectionKey: 'landlord_ast',
    taskKey: 'ast_upload',
    title: 'Signed tenancy agreement (PDF)',
    description:
      "The signed tenancy agreement (assured periodic tenancy since the Renters' Rights Act 2025).",
  },
];

async function main() {
  for (const u of SECTION_UPDATES) {
    const st = await prisma.sectionTemplate.findUnique({ where: { key: u.key } });
    if (!st) {
      console.warn(`  SKIPPED SectionTemplate - not found: ${u.key}`);
    } else {
      await prisma.sectionTemplate.update({
        where: { key: u.key },
        data: { title: u.title, subtitle: u.subtitle, description: u.description },
      });
      console.log(`SectionTemplate updated: ${u.key} -> "${u.title}"`);
    }

    const result = await prisma.passportSection.updateMany({
      where: { key: u.key },
      data: { title: u.title, subtitle: u.subtitle, description: u.description },
    });
    console.log(`  PassportSection rows updated: ${result.count} (existing passports)`);
  }

  for (const q of QUESTION_UPDATES) {
    const result = await prisma.questionTemplate.updateMany({
      where: { sectionKey: q.sectionKey, taskKey: q.taskKey },
      data: { title: q.title, description: q.description },
    });
    console.log(
      `QuestionTemplate updated: ${q.sectionKey}/${q.taskKey} -> "${q.title}" (${result.count} row(s))`,
    );
  }

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
