// Flips today's UMU_278 import (content pack, developer handoff, 2 Oct
// 2026) from 'draft' to 'live', per the client's confirmation that this
// specific pack has already been reviewed. Scoped to rows whose
// sourceFileVersion matches this exact import - this does NOT touch the
// earlier 29 Sep pack's still-unreviewed rows, or anything a future
// revised pack re-imports (a later re-run of import-278-question-content.ts
// resets contentVersion/sourceFileVersion but not status, so those rows
// would need their own explicit live-flip, not silently inherit this one).
//
// Run manually: npx ts-node -r tsconfig-paths/register src/scripts/mark-umu-278-content-live.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const guidance = await prisma.questionAnswerGuidance.updateMany({
    where: { sourceFileVersion: { startsWith: 'UMU_278_Complete_Question_Content.json' } },
    data: { status: 'live' },
  });
  console.log(`QuestionAnswerGuidance: ${guidance.count} rows set to live.`);

  const boundary = await prisma.resolutionPathway.update({
    where: { id: 'P09' },
    data: { status: 'live', validatedBy: 'Client review (UMU_278 handoff, 2 Oct 2026)', validatedOn: new Date() },
  });
  const glazing = await prisma.resolutionPathway.update({
    where: { id: 'P39' },
    data: { status: 'live', validatedBy: 'Client review (UMU_278 handoff, 2 Oct 2026)', validatedOn: new Date() },
  });
  console.log(`ResolutionPathway: ${boundary.id} and ${glazing.id} set to live.`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
