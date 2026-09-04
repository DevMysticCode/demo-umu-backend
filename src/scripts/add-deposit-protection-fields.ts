/**
 * Deposit Protection — adds the "Scheme", "Date PI served" and "Method"
 * fields the prototype has (landlord-passport.html's depositBody: a
 * Scheme/Date-protected row plus a Date-PI-served/Method row) that our
 * build was missing — client feedback: "check UI for deposit protection
 * against the prototype". "Date protected" already exists (the generic
 * expiry-date question every landlord section gets); this only adds the
 * three genuinely missing fields, attached to the same existing
 * deposit_upload task so no new task/section plumbing is needed.
 *
 * Deliberately NOT part of prisma/seed.ts — that file's main() clears
 * and fully re-seeds every passport's live data on every run (see its
 * `deleteMany()` calls), which would destroy real in-progress passports.
 * This script only ever creates rows that don't already exist.
 *
 * Idempotent — safe to re-run.
 *
 * Usage:
 *   npm run add:deposit-protection-fields
 */

import { PrismaClient, QuestionType } from '@prisma/client';

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
  type: QuestionType;
  order: number;
}

const SECTION_KEY = 'landlord_deposit';
const TASK_KEY = 'deposit_upload';

const NEW_TEMPLATES: NewTemplate[] = [
  {
    sectionKey: SECTION_KEY,
    taskKey: TASK_KEY,
    title: 'Scheme',
    description: 'e.g. mydeposits, DPS, TDS.',
    type: 'TEXT',
    order: 3,
  },
  {
    sectionKey: SECTION_KEY,
    taskKey: TASK_KEY,
    title: 'Date PI served',
    description: 'The date you served the prescribed information on the tenant.',
    type: 'DATE',
    order: 4,
  },
  {
    sectionKey: SECTION_KEY,
    taskKey: TASK_KEY,
    title: 'Method',
    description: 'How the prescribed information was served, e.g. Email + hard copy.',
    type: 'TEXT',
    order: 5,
  },
];

async function main() {
  console.log('Adding new QuestionTemplate rows...');
  const createdTemplateIds: string[] = [];

  for (const t of NEW_TEMPLATES) {
    const existing = await prisma.questionTemplate.findFirst({
      where: { sectionKey: t.sectionKey, taskKey: t.taskKey, title: t.title },
    });
    if (existing) {
      createdTemplateIds.push(existing.id);
      console.log(`  already exists: ${t.title}`);
      continue;
    }
    const created = await prisma.questionTemplate.create({
      data: {
        sectionKey: t.sectionKey,
        taskKey: t.taskKey,
        title: t.title,
        description: t.description,
        type: t.type,
        points: 10,
        order: t.order,
      },
    });
    createdTemplateIds.push(created.id);
    console.log(`  created: ${t.title}`);
  }

  console.log('\nBackfilling existing passports...');
  const tasks = await prisma.passportSectionTask.findMany({
    where: {
      key: TASK_KEY,
      passportSection: { key: SECTION_KEY },
    },
    select: { id: true },
  });

  let questionsCreated = 0;
  for (const task of tasks) {
    for (const templateId of createdTemplateIds) {
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

  console.log(`  ${tasks.length} deposit-protection tasks checked across all passports`);
  console.log(`  ${questionsCreated} questions created`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
