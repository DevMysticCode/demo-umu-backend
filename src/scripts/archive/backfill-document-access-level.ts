/**
 * One-off backfill for the Vault per-document access model
 * (QuestionAnswer.accessLevel / UserDocument.accessLevel).
 *
 * Both fields default to PRIVATE. That's already correct for every
 * QuestionAnswer whose section is currently PRIVATE, and for every
 * UserDocument (freestanding uploads were always hardcoded PRIVATE in
 * documents.service.ts before this feature existed — nothing to migrate
 * there). The one case that needs an explicit backfill: a file answer
 * whose PassportSection is currently PUBLIC should start life PUBLISHED,
 * not PRIVATE, so existing published Passports don't suddenly lose every
 * document that was visible yesterday.
 *
 * Idempotent — only touches rows still at the PRIVATE default whose
 * section is PUBLIC.
 *
 * Usage:
 *   npx ts-node src/scripts/backfill-document-access-level.ts
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
  const result = await prisma.questionAnswer.updateMany({
    where: {
      fileUrl: { not: null },
      accessLevel: 'PRIVATE',
      passportQuestion: {
        passportSectionTask: {
          passportSection: { visibility: 'PUBLIC' },
        },
      },
    },
    data: { accessLevel: 'PUBLISHED' },
  });

  console.log(
    `Backfilled accessLevel=PUBLISHED on ${result.count} file answer(s) in PUBLIC sections.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
