// Follow-up to reorder-followups-before-text-upload.ts (client feedback,
// 2026-10-06, round 2): that script only reordered parts within the SAME
// conditional group as the text/upload widget. It missed cases like
// Japanese knotweed, where the widget (gated on the top question) sits
// BEFORE a chained follow-up gated on a DIFFERENT, later question
// ("management plan in place?" -> "supply a copy" is its own group,
// appearing after the widget's group) - the widget still rendered in the
// middle of the flow. This version is simpler and catches every case:
// move every text/upload "combined-input-wrapper" part to the very end of
// the whole parts array, wherever it was. Relative order of everything
// else, and of multiple widgets among themselves, is preserved.
//
// Run manually: npx ts-node -r tsconfig-paths/register src/scripts/move-text-upload-widgets-to-end.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function isInputWidget(part: any): boolean {
  const display = (part.display || '').toString().toLowerCase();
  const type = (part.type || '').toString().toLowerCase();
  return display === 'both' || type === 'upload';
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const rows = await prisma.questionTemplate.findMany({
    where: { type: 'MULTIPART' },
    select: { id: true, sectionKey: true, taskKey: true, order: true, parts: true },
  });

  let fixedCount = 0;
  let skippedCount = 0;
  for (const row of rows) {
    if (!Array.isArray(row.parts) || row.parts.length < 2) continue;
    const parts = row.parts as any[];
    const widgets = parts.filter(isInputWidget);
    const rest = parts.filter((p) => !isInputWidget(p));
    if (!widgets.length || !rest.length) continue;
    // Skip rows with a part that has no title at all - a handful of
    // leasehold/documents rows have a stray, empty-titled duplicate
    // partKey (data bug independent of this one) that isn't safe to
    // reorder around without understanding what it's actually for.
    if (parts.some((p) => !((p.title || '').toString().trim()))) {
      skippedCount++;
      console.log(`Skipping ${row.sectionKey}/${row.taskKey} (order ${row.order}) - has a part with no title.`);
      continue;
    }
    // Already in final position?
    if (parts.slice(-widgets.length).every((p, i) => p === widgets[i])) continue;

    const reordered = [...rest, ...widgets].map((p, i) => ({ ...p, order: i + 1 }));
    if (!dryRun) {
      await prisma.questionTemplate.update({ where: { id: row.id }, data: { parts: reordered } });
    }
    fixedCount++;
    console.log(
      `${dryRun ? '[dry-run] would move' : 'Moved'} widget(s) to end in ${row.sectionKey}/${row.taskKey} (order ${row.order}):`,
    );
    console.log(`  before: ${parts.map((p) => p.partKey).join(' -> ')}`);
    console.log(`  after:  ${reordered.map((p) => p.partKey).join(' -> ')}`);
  }
  console.log(`\n${dryRun ? 'Would fix' : 'Fixed'} ${fixedCount} of ${rows.length} MULTIPART questions (${skippedCount} skipped as ambiguous).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
