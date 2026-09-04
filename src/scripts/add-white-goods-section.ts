/**
 * White Goods & Appliances — a genuinely new Landlord Passport section
 * (client feedback: the prototype has a `whitegoods` card — "Manuals,
 * warranties & appliance cover" — that was never built at all; not part
 * of the original 11-item scope, but fully specified in the prototype's
 * `whitegoodsBody()`).
 *
 * Adds:
 *   - one new SectionTemplate (landlord_white_goods), grouped with
 *     Insurance & HMO on the frontend (see INSURANCE_HINTS)
 *   - two QuestionTemplates on a new `white_goods_upload` task:
 *       UPLOAD — manuals/warranties (multi-copy, kind-scoped: default
 *         kind = manuals, kind='warranties' = warranties — same pattern
 *         as Deposit Protection's cert/PI split)
 *       DATE — record carrier: holds the appliances list, "how things
 *         work" note, and appliance-cover details as one JSON blob in
 *         answerJson, same convention Inventory/Tenancy Agreement use
 *         for their own DATE-question record slot (not an actual date).
 *
 * Backfills the new section/task/questions onto every existing LANDLORD
 * passport that doesn't have it yet — no re-claim needed.
 *
 * Deliberately NOT part of prisma/seed.ts — that file's main() clears
 * and fully re-seeds every passport's live data on every run (see its
 * `deleteMany()` calls), which would destroy real in-progress passports.
 * This script only ever creates rows that don't already exist.
 *
 * Idempotent — safe to re-run.
 *
 * Usage:
 *   npm run add:white-goods-section
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

const SECTION_KEY = 'landlord_white_goods';
const TASK_KEY = 'white_goods_upload';
const SECTION_ORDER = 13; // after PAT testing (order 12)

async function main() {
  console.log('Adding White Goods & Appliances SectionTemplate...');
  let sectionTemplate = await prisma.sectionTemplate.findUnique({
    where: { key: SECTION_KEY },
  });
  if (sectionTemplate) {
    console.log('  SectionTemplate already exists');
  } else {
    sectionTemplate = await prisma.sectionTemplate.create({
      data: {
        type: 'LANDLORD',
        key: SECTION_KEY,
        title: 'White Goods & Appliances',
        subtitle: 'Manuals, warranties & appliance cover',
        description:
          'Keep everything for the white goods you provide — so the tenant can use them, and you’re covered if one fails.',
        icon: 'landlord-insurance', // placeholder — see iconSlugForSection on the frontend; swap once a dedicated icon is generated
        order: SECTION_ORDER,
      },
    });
    console.log('  created SectionTemplate');
  }

  console.log('\nAdding QuestionTemplate rows...');
  const templateDefs: { title: string; description: string; type: QuestionType; order: number }[] = [
    {
      title: 'Appliance manuals & warranties (PDF)',
      description: 'User manuals and warranty/guarantee documents for the white goods you provide.',
      type: 'UPLOAD',
      order: 1,
    },
    {
      title: 'Expiry / next-renewal date',
      description: 'Not used as an expiry here — holds the appliances list, tenant notes and cover details.',
      type: 'DATE',
      order: 2,
    },
  ];
  const templateIds: string[] = [];
  for (const t of templateDefs) {
    const existing = await prisma.questionTemplate.findFirst({
      where: { sectionKey: SECTION_KEY, taskKey: TASK_KEY, title: t.title },
    });
    if (existing) {
      templateIds.push(existing.id);
      console.log(`  already exists: ${t.title}`);
      continue;
    }
    const created = await prisma.questionTemplate.create({
      data: {
        sectionKey: SECTION_KEY,
        taskKey: TASK_KEY,
        title: t.title,
        description: t.description,
        type: t.type,
        points: t.type === 'UPLOAD' ? 100 : 25,
        order: t.order,
      },
    });
    templateIds.push(created.id);
    console.log(`  created: ${t.title}`);
  }

  console.log('\nBackfilling existing landlord passports...');
  const landlordPassports = await prisma.passport.findMany({
    where: { type: 'LANDLORD' },
    select: { id: true },
  });

  let sectionsCreated = 0;
  let questionsCreated = 0;

  for (const passport of landlordPassports) {
    let section = await prisma.passportSection.findFirst({
      where: { passportId: passport.id, key: SECTION_KEY },
    });
    if (!section) {
      section = await prisma.passportSection.create({
        data: {
          passportId: passport.id,
          key: SECTION_KEY,
          title: sectionTemplate.title,
          subtitle: sectionTemplate.subtitle,
          description: sectionTemplate.description,
          imageKey: sectionTemplate.icon,
          order: sectionTemplate.order,
          // Landlord sections aren't gated by a locked/unlocked cascade
          // on the frontend (every compliance card is always tappable),
          // but ACTIVE is the correct/safe status regardless.
          status: 'ACTIVE',
        },
      });
      sectionsCreated++;
    }

    let task = await prisma.passportSectionTask.findFirst({
      where: { passportSectionId: section.id, key: TASK_KEY },
    });
    if (!task) {
      task = await prisma.passportSectionTask.create({
        data: {
          passportSectionId: section.id,
          key: TASK_KEY,
          title: 'White Goods Upload',
          order: 1,
        },
      });
    }

    for (const templateId of templateIds) {
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

  console.log(`  ${landlordPassports.length} landlord passports checked`);
  console.log(`  ${sectionsCreated} sections created, ${questionsCreated} questions created`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
