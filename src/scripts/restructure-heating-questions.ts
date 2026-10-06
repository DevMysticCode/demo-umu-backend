// Services/heating restructure (client feedback, 2026-10-06, TA6 11.4):
// "Does the property have a central heating system?" (yes/no) is replaced
// by "How is the property heated? Tick all that apply" - the existing
// "what type of system" checkbox already did almost exactly this, just
// missing a few TA6 options (Heat pumps, Underfloor, Woodburning/multi-fuel
// stove) and the old yes/no gate in front of it was redundant with it (if
// nothing's ticked, there's no heating). Also adds TA6 11.4's still-missing
// sub-questions: boiler install date (b), whether the system's been
// replaced (c), compliance docs as Attached/To follow/None (d), and the
// "more than one heating system" note (h). (e)/(f)/(g) - inspection report,
// working order, last serviced - already existed and are left as-is.
//
// Run manually: npx ts-node -r tsconfig-paths/register src/scripts/restructure-heating-questions.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ATTACHED_TO_FOLLOW_NONE = [
  { label: 'Attached', value: 'attached' },
  { label: 'To follow', value: 'to_follow' },
  { label: 'None', value: 'none' },
];
const NOT_KNOWN = { label: 'Not known', value: 'not_known' };

async function main() {
  // 1. Delete the old yes/no gate (order=1) - its in-passport instances
  // first (PassportQuestion has no cascading delete here).
  const gateId = 'aaf7a127-24ef-4371-a0c1-d62cb3b94090';
  const gateInstances = await prisma.passportQuestion.findMany({
    where: { questionTemplateId: gateId },
    select: { id: true },
  });
  if (gateInstances.length) {
    await prisma.questionAnswer.deleteMany({ where: { passportQuestionId: { in: gateInstances.map((q) => q.id) } } });
    await prisma.passportQuestion.deleteMany({ where: { id: { in: gateInstances.map((q) => q.id) } } });
    console.log(`Removed the old yes/no gate from ${gateInstances.length} existing passport(s).`);
  }
  await prisma.questionTemplate.delete({ where: { id: gateId } });
  console.log('Deleted the old "Does the property have a central heating system?" yes/no question.');

  // 2. Rewrite the checkbox question (was order=2) to TA6's exact wording
  // and full option set, and move it to order=1 (it's now the first
  // question in the task).
  const checklistId = '9457a97b-66c9-4db9-bcde-2a9be454afae';
  await prisma.questionTemplate.update({
    where: { id: checklistId },
    data: {
      title: 'How is the property heated? Tick all that apply:',
      order: 1,
      options: [
        { label: 'Mains gas', value: 'mains_gas' },
        { label: 'Oil', value: 'oil' },
        { label: 'Heat pumps', value: 'heat_pumps' },
        { label: 'Liquid gas', value: 'liquid_gas' },
        { label: 'Electricity', value: 'electricity' },
        { label: 'Underfloor', value: 'underfloor' },
        { label: 'Woodburning / multi-fuel stove', value: 'woodburning_stove' },
        { label: 'Other, specify below', value: 'other_specify_below' },
      ],
    },
  });
  console.log('Rewrote the heating-type checkbox to TA6\'s "tick all that apply" wording and full option set.');

  // 3. "When was the heating system installed?" stays at order=3 - add a
  // (b) boiler-install-date follow-up part to the same question.
  const installedId = '03f4fbb4-e624-488f-9daf-4d848576a9fd';
  const installedRow = await prisma.questionTemplate.findUniqueOrThrow({ where: { id: installedId } });
  const installedParts = installedRow.parts as any[];
  if (!installedParts.some((p) => p.partKey === 'boiler_install_date')) {
    installedParts.push({
      type: 'date',
      order: installedParts.length + 1,
      title: 'If there is a boiler (of any kind), when was it installed?',
      options: [
        { label: 'Select date', value: 'yes', hasDate: true, dateFormat: 'fullDate', datePlaceholder: 'Select date' },
      ],
      partKey: 'boiler_install_date',
    });
    await prisma.questionTemplate.update({ where: { id: installedId }, data: { parts: installedParts } });
    console.log('Added "boiler install date" follow-up to the heating-installed question.');
  }

  // 4. Add the missing (c) replacement and (d) compliance-docs questions,
  // and (h) "more than one heating system" note, as new rows in this task.
  const existingOrders = (
    await prisma.questionTemplate.findMany({
      where: { sectionKey: 'services', taskKey: 'central_heating' },
      select: { order: true },
    })
  ).map((r) => r.order);
  let nextOrder = Math.max(...existingOrders) + 1;

  const replacementExists = await prisma.questionTemplate.findFirst({
    where: { sectionKey: 'services', taskKey: 'central_heating', title: { contains: 'replacement to the heating system' } },
  });
  if (!replacementExists) {
    await prisma.questionTemplate.create({
      data: {
        sectionKey: 'services',
        taskKey: 'central_heating',
        title: 'Has there been any replacement to the heating system (other than replacement of a boiler)?',
        type: 'RADIO',
        options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }, NOT_KNOWN],
        order: nextOrder++,
        points: 25,
        readiness: [{ order: 1, milestone: 40, blockerTrigger: null, blocksPublication: 'no' }],
      },
    });
    console.log('Added "has there been any replacement to the heating system" question.');
  }

  const complianceExists = await prisma.questionTemplate.findFirst({
    where: { sectionKey: 'services', taskKey: 'central_heating', title: { contains: 'compliance certificates' } },
  });
  if (!complianceExists) {
    await prisma.questionTemplate.create({
      data: {
        sectionKey: 'services',
        taskKey: 'central_heating',
        title:
          'Supply compliance certificates or documentation for the installation or alteration of each heating system (such as a building regulation completion certificate).',
        type: 'RADIO',
        options: ATTACHED_TO_FOLLOW_NONE,
        order: nextOrder++,
        points: 25,
        readiness: [{ order: 1, milestone: 40, blockerTrigger: null, blocksPublication: 'no' }],
      },
    });
    console.log('Added "supply compliance certificates" question.');
  }

  const multiSystemExists = await prisma.questionTemplate.findFirst({
    where: { sectionKey: 'services', taskKey: 'central_heating', title: { contains: 'more than one heating system' } },
  });
  if (!multiSystemExists) {
    await prisma.questionTemplate.create({
      data: {
        sectionKey: 'services',
        taskKey: 'central_heating',
        title: 'If there is more than one heating system, attach answers to the above questions separately for each one.',
        type: 'RADIO',
        options: [
          { label: 'Attached', value: 'attached' },
          { label: 'To follow', value: 'to_follow' },
          { label: 'Not applicable', value: 'not_applicable' },
        ],
        order: nextOrder++,
        points: 0,
        readiness: [{ order: 1, milestone: 40, blockerTrigger: null, blocksPublication: 'no' }],
      },
    });
    console.log('Added "more than one heating system" question.');
  }

  // 5. Retrofit the new rows onto every existing passport that already has
  // this task.
  const newRows = await prisma.questionTemplate.findMany({
    where: {
      sectionKey: 'services',
      taskKey: 'central_heating',
      id: { notIn: [checklistId, installedId, '6424ee95-abee-436d-b1d0-4dd433b1bbc0', 'b95a782c-2b57-44a9-a41a-41e03b60d287'] },
    },
  });
  const tasks = await prisma.passportSectionTask.findMany({
    where: { key: 'central_heating', passportSection: { key: 'services' } },
    select: { id: true },
  });
  for (const row of newRows) {
    let added = 0;
    for (const task of tasks) {
      const already = await prisma.passportQuestion.findFirst({
        where: { passportSectionTaskId: task.id, questionTemplateId: row.id },
      });
      if (already) continue;
      await prisma.passportQuestion.create({
        data: { passportSectionTaskId: task.id, questionTemplateId: row.id },
      });
      added++;
    }
    console.log(`Retrofitted "${row.title}" onto ${added} existing passport(s).`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
