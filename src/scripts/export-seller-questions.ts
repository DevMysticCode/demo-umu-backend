// One-off export: dumps the full SELLER question set, grouped and ordered
// exactly as passport.service.ts's seedPassportContent() would seed a real
// seller passport, to JSON for building a client-facing document. Not part
// of the app's runtime — run manually with ts-node.
import { PrismaClient, QuestionTemplate } from '@prisma/client';
import { TASK_DESCRIPTIONS, TASK_ORDERS } from '../constants/task-metadata';
import * as fs from 'fs';

const prisma = new PrismaClient();

function formatTaskKey(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function main() {
  const sectionTemplates = await prisma.sectionTemplate.findMany({
    where: { type: 'SELLER' },
    orderBy: { order: 'asc' },
  });

  const allTemplates = await prisma.questionTemplate.findMany({
    orderBy: [{ sectionKey: 'asc' }, { taskKey: 'asc' }, { order: 'asc' }],
  });

  const sellerSectionKeys = new Set(sectionTemplates.map((s) => s.key));
  const sellerTemplates = allTemplates.filter((t) => sellerSectionKeys.has(t.sectionKey));

  const bySection: Record<string, QuestionTemplate[]> = {};
  for (const t of sellerTemplates) {
    (bySection[t.sectionKey] ??= []).push(t);
  }

  const out: any[] = [];

  for (const section of sectionTemplates) {
    const templates = bySection[section.key] ?? [];
    const byTask = new Map<string, QuestionTemplate[]>();
    for (const t of templates) {
      if (!byTask.has(t.taskKey)) byTask.set(t.taskKey, []);
      byTask.get(t.taskKey)!.push(t);
    }
    const sortedTaskKeys = [...byTask.keys()].sort((a, b) => {
      const orderA = TASK_ORDERS[section.key]?.[a] ?? 999;
      const orderB = TASK_ORDERS[section.key]?.[b] ?? 999;
      return orderA - orderB;
    });

    const tasks = sortedTaskKeys.map((taskKey) => {
      const qs = (byTask.get(taskKey) ?? []).sort((a, b) => a.order - b.order);
      return {
        key: taskKey,
        title: formatTaskKey(taskKey),
        description: TASK_DESCRIPTIONS[section.key]?.[taskKey] ?? null,
        questions: qs.map((q) => ({
          id: q.id,
          title: q.title,
          description: q.description,
          instructionText: q.instructionText,
          helpText: q.helpText,
          type: q.type,
          options: q.options,
          placeholder: q.placeholder,
          prewrittenTemplates: q.prewrittenTemplates,
          dateFields: q.dateFields,
          parts: q.parts,
          fields: q.fields,
          scaleType: q.scaleType,
          scaleMin: q.scaleMin,
          scaleMax: q.scaleMax,
          scaleStep: q.scaleStep,
          scaleFormat: q.scaleFormat,
          scaleMaxLabel: q.scaleMaxLabel,
          otherPlaceholder: q.otherPlaceholder,
        })),
      };
    });

    out.push({
      key: section.key,
      title: section.title,
      subtitle: section.subtitle,
      description: section.description,
      conditionalKey: section.conditionalKey,
      tasks,
    });
  }

  fs.writeFileSync(
    'C:/Users/prade/AppData/Local/Temp/claude/d--ReactProjects-op-nuxt-umu-backend/9ae09456-2bb4-46b0-97fc-f7baa64890e7/scratchpad/seller_questions_ordered.json',
    JSON.stringify(out, null, 2),
  );
  console.log('Sections:', out.length, '| Total questions:', out.reduce((n, s) => n + s.tasks.reduce((m: number, t: any) => m + t.questions.length, 0), 0));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
