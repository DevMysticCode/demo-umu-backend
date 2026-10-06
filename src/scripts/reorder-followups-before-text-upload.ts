// Global fix (client feedback, 2026-10-06): wherever a MULTIPART question's
// free-text/upload part ("combined-input-wrapper", display:'both' - the
// textarea + Or + Upload/Scan widget) is followed by ANOTHER conditional
// part gated on the same answer (e.g. a "what kind of flooding occurred"
// checkbox after the flood yes/no), the text/upload widget rendered first
// and pushed the actual follow-up question below the fold - the user had
// to scroll down past a whole textarea+upload box to discover there was
// more to answer.
//
// Fix: within each group of parts sharing the same `conditionalOn`, any
// part with display:'both' (or type 'upload') moves to the END of that
// group, so real follow-up questions always render before the free-text/
// upload box - applied globally across every QuestionTemplate, not just
// one section.
//
// Run manually: npx ts-node -r tsconfig-paths/register src/scripts/reorder-followups-before-text-upload.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function isInputWidget(part: any): boolean {
  const display = (part.display || '').toString().toLowerCase();
  const type = (part.type || '').toString().toLowerCase();
  return display === 'both' || type === 'upload';
}

function reorderParts(parts: any[]): { changed: boolean; parts: any[] } {
  // Group parts by conditionalOn (undefined/null -> its own bucket, never reordered).
  const byGate = new Map<string, any[]>();
  const order: string[] = [];
  for (const p of parts) {
    const gate = p.conditionalOn || `__ungated_${p.partKey}`;
    if (!byGate.has(gate)) {
      byGate.set(gate, []);
      order.push(gate);
    }
    byGate.get(gate)!.push(p);
  }

  let changed = false;
  const result: any[] = [];
  for (const gate of order) {
    const group = byGate.get(gate)!;
    if (group.length > 1) {
      const widgets = group.filter(isInputWidget);
      const rest = group.filter((p) => !isInputWidget(p));
      if (widgets.length && rest.length) {
        const reordered = [...rest, ...widgets];
        if (reordered.some((p, i) => p !== group[i])) changed = true;
        result.push(...reordered);
        continue;
      }
    }
    result.push(...group);
  }

  if (!changed) return { changed: false, parts };

  // Renumber `order` sequentially to match the new sequence (parts.order
  // is what sortedParts actually sorts on - the array position here
  // doesn't matter to the frontend, only this field does).
  const renumbered = result.map((p, i) => ({ ...p, order: i + 1 }));
  return { changed: true, parts: renumbered };
}

async function main() {
  const rows = await prisma.questionTemplate.findMany({
    where: { type: 'MULTIPART' },
    select: { id: true, sectionKey: true, taskKey: true, order: true, parts: true },
  });

  const dryRun = process.argv.includes('--dry-run');
  let fixedCount = 0;
  for (const row of rows) {
    if (!Array.isArray(row.parts) || row.parts.length < 2) continue;
    const { changed, parts } = reorderParts(row.parts as any[]);
    if (!changed) continue;
    if (!dryRun) {
      await prisma.questionTemplate.update({ where: { id: row.id }, data: { parts } });
    }
    fixedCount++;
    const before = (row.parts as any[]).map((p) => p.partKey).join(' -> ');
    const after = parts.map((p) => p.partKey).join(' -> ');
    console.log(`${dryRun ? '[dry-run] would reorder' : 'Reordered'} ${row.sectionKey}/${row.taskKey} (order ${row.order}):`);
    console.log(`  before: ${before}`);
    console.log(`  after:  ${after}`);
  }
  console.log(`\n${dryRun ? 'Would reorder' : 'Done - reordered'} ${fixedCount} of ${rows.length} MULTIPART questions.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
