/**
 * UMU Stamp Reward System V1 — adds the new QuestionTemplate rows the
 * stamp catalogue needs (5 search questions + the title register/plan
 * upload) and backfills matching PassportSectionTask/PassportQuestion
 * rows onto every EXISTING passport that already has the relevant
 * section but not the new task yet.
 *
 * Deliberately NOT part of prisma/seed.ts — that file's main() clears
 * and fully re-seeds every passport's live data on every run (see its
 * `deleteMany()` calls), which would destroy real in-progress passports.
 * This script only ever creates rows that don't already exist.
 *
 * Idempotent — safe to re-run.
 *
 * Usage:
 *   npm run add:stamp-v1-questions
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

interface NewTemplate {
  sectionKey: string;
  taskKey: string;
  title: string;
  description: string;
  helpText: string;
  points: number;
  order: number;
}

const NEW_TEMPLATES: NewTemplate[] = [
  {
    sectionKey: 'titleDeedsAndPlan',
    taskKey: 'title_deeds_review',
    title: 'Please upload the Title Register and Title Plan.',
    description: 'Retrieved from HM Land Registry or supplied directly.',
    helpText: 'The official Title Register and Title Plan for this property, from HM Land Registry.',
    points: 75,
    order: 2,
  },
  {
    sectionKey: 'searches',
    taskKey: 'local_authority_search',
    title: 'Please upload your Local Authority Search.',
    description: 'A LLC1/CON29 or equivalent Local Authority Search result.',
    helpText: 'Order this from your local council (or a search provider) and upload the result once received.',
    points: 75,
    order: 1,
  },
  {
    sectionKey: 'searches',
    taskKey: 'drainage_water_search',
    title: 'Please upload your Drainage & Water Search.',
    description: 'Confirms how the property connects to public sewers and water supply.',
    helpText: 'Order this from your water authority (or a search provider) and upload the result once received.',
    points: 75,
    order: 1,
  },
  {
    sectionKey: 'searches',
    taskKey: 'environmental_search',
    title: 'Please upload your Environmental Search.',
    description: 'Covers contaminated land, flood risk and other environmental factors.',
    helpText: 'Order this from an environmental search provider and upload the result once received.',
    points: 75,
    order: 1,
  },
  {
    sectionKey: 'searches',
    taskKey: 'flood_search',
    title: 'Please upload your Flood Search.',
    description: 'A dedicated flood-risk search for the property.',
    helpText: 'Order this from a search provider and upload the result once received.',
    points: 75,
    order: 1,
  },
  {
    sectionKey: 'searches',
    taskKey: 'mining_risk_search',
    title: 'Please upload your Mining / Local Risk Search.',
    description: 'Relevant where the property sits in a coalfield or other mining-affected area.',
    helpText: 'Only relevant if the property is in a known mining or local-risk area - order from the Coal Authority or a search provider and upload the result once received.',
    points: 75,
    order: 1,
  },
];

function formatTaskKey(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function main() {
  console.log('Adding new QuestionTemplate rows...');
  const createdTemplateIds: Record<string, string> = {};

  for (const t of NEW_TEMPLATES) {
    const existing = await prisma.questionTemplate.findFirst({
      where: { sectionKey: t.sectionKey, taskKey: t.taskKey, title: t.title },
    });
    if (existing) {
      createdTemplateIds[`${t.sectionKey}.${t.taskKey}`] = existing.id;
      console.log(`  already exists: ${t.sectionKey}.${t.taskKey}`);
      continue;
    }
    const created = await prisma.questionTemplate.create({
      data: {
        sectionKey: t.sectionKey,
        taskKey: t.taskKey,
        title: t.title,
        description: t.description,
        helpText: t.helpText,
        type: 'UPLOAD',
        points: t.points,
        order: t.order,
      },
    });
    createdTemplateIds[`${t.sectionKey}.${t.taskKey}`] = created.id;
    console.log(`  created: ${t.sectionKey}.${t.taskKey}`);
  }

  console.log('\nBackfilling existing passports...');
  const sections = await prisma.passportSection.findMany({
    where: { key: { in: ['titleDeedsAndPlan', 'searches'] } },
    select: { id: true, key: true, passportId: true },
  });

  let tasksCreated = 0;
  let questionsCreated = 0;

  for (const section of sections) {
    // Which new taskKeys apply to this section.
    const relevantTemplates = NEW_TEMPLATES.filter((t) => t.sectionKey === section.key);
    const taskKeys = [...new Set(relevantTemplates.map((t) => t.taskKey))];

    for (const taskKey of taskKeys) {
      let task = await prisma.passportSectionTask.findFirst({
        where: { passportSectionId: section.id, key: taskKey },
      });
      if (!task) {
        task = await prisma.passportSectionTask.create({
          data: {
            passportSectionId: section.id,
            key: taskKey,
            title: formatTaskKey(taskKey),
            order: 999,
          },
        });
        tasksCreated++;
      }

      const templatesForTask = relevantTemplates.filter((t) => t.taskKey === taskKey);
      for (const t of templatesForTask) {
        const templateId = createdTemplateIds[`${t.sectionKey}.${t.taskKey}`];
        const existingQuestion = await prisma.passportQuestion.findFirst({
          where: { passportSectionTaskId: task.id, questionTemplateId: templateId },
        });
        if (existingQuestion) continue;
        await prisma.passportQuestion.create({
          data: { passportSectionTaskId: task.id, questionTemplateId: templateId },
        });
        questionsCreated++;
      }
    }
  }

  console.log(`  ${sections.length} sections checked across all passports`);
  console.log(`  ${tasksCreated} tasks created, ${questionsCreated} questions created`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
