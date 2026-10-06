// Insurance section: reword every question from third-person ("Has any...
// been... by the seller") to speak directly to the owner ("Have you...",
// "Are you aware...", "Do you...") - client feedback, 2026-10-06. Also
// folds "ever been refused" into the broader, TA6-style phrasing the
// client asked for directly.
//
// Run manually: npx ts-node -r tsconfig-paths/register src/scripts/reword-insurance-questions.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// id -> new title (edits parts[0].title for MULTIPART rows whose single
// part is the real question - same pattern as every other section fixed
// this session).
const REWORDS: Record<string, string> = {
  abnormal_premium_rise: 'Have you ever had an abnormal rise in your buildings insurance premiums?',
  high_excesses: 'Have you ever been asked to pay a high excess on your buildings insurance?',
  unusual_conditions: 'Have you ever had unusual conditions attached to your buildings insurance?',
  insurance_refused:
    "Are you aware of the property's insurance ever being difficult to obtain or subject to special conditions?",
  insurance_issue: 'Have you made any buildings insurance claims?',
  insure_property: 'Do you insure the property?',
  landlord_insures_building: 'If the property is a flat, does your landlord insure the building?',
};

async function main() {
  const rows = await prisma.questionTemplate.findMany({
    where: { sectionKey: 'insurance' },
  });

  for (const row of rows) {
    if (!Array.isArray(row.parts)) continue;
    const parts = row.parts as any[];
    const mainPart = parts.find((p) => p.partKey && REWORDS[p.partKey]);
    if (!mainPart) continue;
    const oldTitle = mainPart.title;
    mainPart.title = REWORDS[mainPart.partKey];
    await prisma.questionTemplate.update({ where: { id: row.id }, data: { parts } });
    console.log(`${row.taskKey} (order ${row.order}): "${oldTitle}" -> "${mainPart.title}"`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
