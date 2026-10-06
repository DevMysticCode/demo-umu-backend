// Fills the remaining gaps in the Solar power systems coverage under
// Alterations and Planning (client request, 2026-10-06, following the TA6
// 5.6(a)-(h) structure). Three tasks already existed here from the earlier
// content-pack import (solar_panels, solar_panels_ownership,
// solar_panel_roof_lease — 5.6/5.6(b)/(c)/(d)); this adds the rest:
//   (a) hot water/heating only, not generating electricity
//   (e) maintenance agreement in place
//   (f) battery for storing solar power
//   (g)+(i)-(iv) feeds the National Grid / FIT or SEG / its paperwork
//   (h) building regulations completion / compliance certificate
//
// Each is its own task, same as the three existing solar tasks (this app
// has no cross-task conditional mechanism - MultipartQuestion.vue's
// conditionalOn only sees answers within its own question's parts - so
// these can't be gated on "5.6 = yes" from a different task, exactly like
// solar_panels_ownership and solar_panel_roof_lease already aren't).
// (g)'s own sub-items (i)-(iv) ARE gated on each other, all within the one
// solar_national_grid task.
//
// Creates the QuestionTemplate rows, then retrofits every EXISTING
// passport's alterationsAndPlanning section with the new tasks (new
// passports get them automatically via seedPassportContent, which reads
// QuestionTemplate live - but anyone already mid-passport needs this
// backfill to see them without starting over).
//
// Run manually: npx ts-node -r tsconfig-paths/register src/scripts/add-solar-power-system-questions.ts
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TASK_ORDERS, TASK_DESCRIPTIONS } from '../constants/task-metadata';

const prisma = new PrismaClient();

const ATTACHED_TO_FOLLOW = [
  { label: 'Attached', value: 'attached' },
  { label: 'To follow', value: 'to_follow' },
];

const NEW_TASKS: Array<{
  taskKey: string;
  order: number;
  points: number;
  parts: any[];
}> = [
  {
    taskKey: 'solar_hot_water_only',
    order: 1,
    points: 25,
    parts: [
      {
        type: 'RADIO',
        order: 1,
        title:
          'Is the solar system used only to provide hot water or heating, and not to generate electricity?',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        partKey: 'hot_water_or_heating_only',
        helpText:
          'Some solar installations are solar thermal panels that only heat water or provide heating, rather than photovoltaic (PV) panels that generate electricity. This affects what paperwork and follow-up questions apply.',
      },
    ],
  },
  {
    taskKey: 'solar_maintenance_agreement',
    order: 1,
    points: 25,
    parts: [
      {
        type: 'RADIO',
        order: 1,
        title:
          'Do you have a maintenance agreement in place for the solar power system?',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        partKey: 'maintenance_agreement_in_place',
        helpText:
          'A maintenance agreement covers servicing, cleaning or repair of the system, usually with the installer or another specialist provider.',
      },
      {
        type: 'RADIO',
        order: 2,
        title: 'If yes, supply a copy of the agreement',
        options: ATTACHED_TO_FOLLOW,
        partKey: 'maintenance_agreement_doc',
        conditionalOn: 'maintenance_agreement_in_place',
        showOnValues: ['yes'],
      },
    ],
  },
  {
    taskKey: 'solar_battery_storage',
    order: 1,
    points: 25,
    parts: [
      {
        type: 'RADIO',
        order: 1,
        title: 'Is there a battery for storing solar power?',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        partKey: 'has_battery',
        helpText:
          'A storage battery lets electricity generated during the day be used later, rather than only exported or used as it is generated.',
      },
      {
        type: 'text',
        order: 2,
        title: 'If yes, provide the make, model and storage capacity (kWh) of the battery',
        partKey: 'battery_details',
        placeholder: 'e.g. Tesla Powerwall 2, 13.5 kWh',
        conditionalOn: 'has_battery',
        showOnValues: ['yes'],
        required: true,
      },
    ],
  },
  {
    taskKey: 'solar_national_grid',
    order: 1,
    points: 50,
    parts: [
      {
        type: 'RADIO',
        order: 1,
        title: 'Does the system feed into the National Grid?',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        partKey: 'feeds_national_grid',
        helpText:
          'Some systems export unused electricity back to the grid, usually in exchange for payment under a Feed-in Tariff (FIT) or Smart Export Guarantee (SEG) scheme.',
      },
      {
        type: 'RADIO',
        order: 2,
        title: 'Is there a Feed-in Tariff (FIT) or Smart Export Guarantee (SEG) in place?',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        partKey: 'fit_seg_in_place',
        conditionalOn: 'feeds_national_grid',
        showOnValues: ['yes'],
      },
      {
        type: 'RADIO',
        order: 3,
        title: 'Supply a copy of the agreement',
        options: ATTACHED_TO_FOLLOW,
        partKey: 'fit_seg_agreement_doc',
        conditionalOn: 'fit_seg_in_place',
        showOnValues: ['yes'],
      },
      {
        type: 'RADIO',
        order: 4,
        title: 'Provide a copy of the electricity bill showing the credit paid for the generation',
        options: ATTACHED_TO_FOLLOW,
        partKey: 'fit_seg_bill_doc',
        conditionalOn: 'fit_seg_in_place',
        showOnValues: ['yes'],
      },
      {
        type: 'text',
        order: 5,
        title:
          'Provide details of the procedure for assigning the benefit of the FIT or SEG agreement on completion of the purchase to the buyer',
        partKey: 'fit_seg_transfer_details',
        placeholder: 'Start typing here.....',
        conditionalOn: 'fit_seg_in_place',
        showOnValues: ['yes'],
        required: true,
      },
    ],
  },
  {
    taskKey: 'solar_building_regs_certificate',
    order: 1,
    points: 25,
    parts: [
      {
        type: 'RADIO',
        order: 1,
        title:
          'Provide a copy of the building regulations completion certificate or compliance certificate (e.g. MCS) for the installation of the system.',
        options: [
          { label: 'Attached', value: 'attached' },
          { label: 'To follow', value: 'to_follow' },
          { label: 'Not available', value: 'not_available' },
        ],
        partKey: 'building_regs_cert',
        helpText:
          'MCS (Microgeneration Certification Scheme) is the industry body certifying installer competence and equipment quality for solar installations in the UK.',
      },
    ],
  },
];

async function main() {
  // 1. Create the QuestionTemplate rows (skip any that already exist, so
  // this is safe to re-run).
  const createdIds: Record<string, string> = {};
  for (const task of NEW_TASKS) {
    const existing = await prisma.questionTemplate.findFirst({
      where: { sectionKey: 'alterationsAndPlanning', taskKey: task.taskKey },
    });
    if (existing) {
      console.log(`QuestionTemplate for ${task.taskKey} already exists - skipping create`);
      createdIds[task.taskKey] = existing.id;
      continue;
    }
    const created = await prisma.questionTemplate.create({
      data: {
        sectionKey: 'alterationsAndPlanning',
        taskKey: task.taskKey,
        title: '',
        description: '',
        type: 'MULTIPART',
        parts: task.parts,
        points: task.points,
        order: task.order,
        readiness: [{ order: 1, milestone: 40, blockerTrigger: null, blocksPublication: 'no' }],
      },
    });
    createdIds[task.taskKey] = created.id;
    console.log(`Created QuestionTemplate for ${task.taskKey} (${created.id})`);
  }

  // 2. Retrofit every existing passport's alterationsAndPlanning section
  // with the new tasks, so already-in-progress passports see them too.
  const sections = await prisma.passportSection.findMany({
    where: { key: 'alterationsAndPlanning' },
    select: { id: true, passportId: true },
  });
  console.log(`Found ${sections.length} existing alterationsAndPlanning section(s) to backfill.`);

  const sectionOrders = TASK_ORDERS.alterationsAndPlanning;

  for (const section of sections) {
    const existingTasks = await prisma.passportSectionTask.findMany({
      where: { passportSectionId: section.id },
      select: { id: true, key: true, order: true },
    });
    const existingTaskKeys = new Set(existingTasks.map((t) => t.key));

    // Resequence the tasks already in this section to match the updated
    // TASK_ORDERS (listed_building etc. moved from 9-11 to 14-16 to make
    // room for the 5 new solar tasks slotting in at 9-13) - otherwise the
    // new tasks would collide with/interleave oddly against stale order
    // values frozen at this passport's original creation time.
    for (const t of existingTasks) {
      const newOrder = sectionOrders[t.key];
      if (newOrder != null && newOrder !== t.order) {
        await prisma.passportSectionTask.update({ where: { id: t.id }, data: { order: newOrder } });
      }
    }

    for (const task of NEW_TASKS) {
      if (existingTaskKeys.has(task.taskKey)) continue;
      const taskId = randomUUID();
      await prisma.passportSectionTask.create({
        data: {
          id: taskId,
          passportSectionId: section.id,
          key: task.taskKey,
          title: task.taskKey
            .split('_')
            .map((w) => w[0].toUpperCase() + w.slice(1))
            .join(' '),
          description: TASK_DESCRIPTIONS.alterationsAndPlanning?.[task.taskKey] ?? null,
          order: sectionOrders[task.taskKey] ?? 999,
        },
      });
      await prisma.passportQuestion.create({
        data: {
          passportSectionTaskId: taskId,
          questionTemplateId: createdIds[task.taskKey],
        },
      });
    }
  }

  console.log('Backfill complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
