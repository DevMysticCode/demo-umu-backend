/**
 * Redesigns the "Title Deeds and Plan" section down to the two questions
 * the client actually wants — the placeholder "planning notices" RADIO and
 * combined "upload register + plan" UPLOAD get replaced in place with a
 * Title Register question and a Title Plan question, each a RADIO gate
 * (Yes/No) with a conditional upload on Yes, matching the MULTIPART pattern
 * already used elsewhere (see alterationsAndPlanning's listed_building
 * question). Also renames the section to "Title Register and Plan" and
 * simplifies its stored seller guidance to match the narrower scope.
 *
 * Updates the two existing QuestionTemplate rows by id rather than
 * delete+recreate: PassportQuestion.questionTemplateId is a hard FK with no
 * cascade, and 62 PassportQuestion rows across existing test passports
 * already reference these two ids, so deleting them would fail. Updating in
 * place propagates to every existing passport immediately (title/type/parts
 * are read live through the join) with no backfill needed — the task
 * structure (one task, two questions, same order) isn't changing, only the
 * content is. Not part of prisma/seed.ts, which wipes and fully re-seeds
 * live passport data on every run.
 *
 * Idempotent — safe to re-run.
 *
 * Usage:
 *   npm run update:title-deeds-questions
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

const SECTION_KEY = 'titleDeedsAndPlan';
const NEW_SECTION_TITLE = 'Title Register and Plan';

const NEW_SELLER_GUIDANCE =
  "Provide buyer's conveyancer with a copy of the property's Official Copy of the Register (Title Register) and Title Plan, both available from HM Land Registry. If you were given any original deeds when you bought the property - from before it was registered with HM Land Registry - include those in the same upload as the Title Register; they don't need to be uploaded separately. If you don't have current copies to hand, you (or your solicitor) can order them from HM Land Registry.";

const TITLE_REGISTER_QUESTION = {
  id: '5a4060ad-8482-4936-9867-5d9cb105d3bf', // currently the "planning notices" RADIO
  title: '',
  description: null as string | null,
  helpText: null as string | null,
  type: 'MULTIPART',
  options: null,
  parts: [
    {
      type: 'RADIO',
      order: 1,
      title: 'Do you have a copy of the Official Copy of the Register (Title Register)?',
      options: [
        { label: 'Yes', value: 'yes' },
        { label: 'No', value: 'no' },
      ],
      partKey: 'has_title_register',
      helpText:
        "This is HM Land Registry's current record of who owns the property and any registered charges or restrictions. If you also have any older deeds from before the property was registered with HM Land Registry, include those in this same upload - no need to upload them separately.",
      description:
        "If yes, please upload it below. If no, you (or your solicitor) can order an Official Copy from HM Land Registry, then come back and upload it here.",
    },
    {
      type: 'upload',
      order: 2,
      title: 'Please upload your Title Register (Official Copy).',
      display: 'both',
      partKey: 'title_register_upload',
      required: true,
      placeholder: 'Start typing here.....',
      showOnValues: ['yes'],
      conditionalOn: 'has_title_register',
    },
  ],
  autoSaveOn: { value: 'no', partKey: 'has_title_register' },
  points: 75,
  order: 1,
};

const TITLE_PLAN_QUESTION = {
  id: '1d033644-d158-453b-9dc7-508c26083e07', // currently the combined "register + plan" UPLOAD
  title: '',
  description: null as string | null,
  helpText: null as string | null,
  type: 'MULTIPART',
  options: null,
  parts: [
    {
      type: 'RADIO',
      order: 1,
      title: 'Do you have a copy of the Title Plan?',
      options: [
        { label: 'Yes', value: 'yes' },
        { label: 'No', value: 'no' },
      ],
      partKey: 'has_title_plan',
      helpText:
        "The official plan showing the property's registered boundaries, from HM Land Registry - a separate document from the Title Register, though usually ordered together.",
      description:
        "If yes, please upload it below. If no, you (or your solicitor) can order a Title Plan from HM Land Registry, then come back and upload it here.",
    },
    {
      type: 'upload',
      order: 2,
      title: 'Please upload your Title Plan.',
      display: 'both',
      partKey: 'title_plan_upload',
      required: true,
      placeholder: 'Start typing here.....',
      showOnValues: ['yes'],
      conditionalOn: 'has_title_plan',
    },
  ],
  autoSaveOn: { value: 'no', partKey: 'has_title_plan' },
  points: 75,
  order: 2,
};

async function main() {
  const section = await prisma.sectionTemplate.findUnique({ where: { key: SECTION_KEY } });
  if (!section) throw new Error(`SectionTemplate not found: ${SECTION_KEY}`);

  if (section.title !== NEW_SECTION_TITLE || (section.helpContent as any)?.sellerGuidance !== NEW_SELLER_GUIDANCE) {
    await prisma.sectionTemplate.update({
      where: { key: SECTION_KEY },
      data: {
        title: NEW_SECTION_TITLE,
        helpContent: {
          ...(section.helpContent as object),
          sellerGuidance: NEW_SELLER_GUIDANCE,
        },
      },
    });
    console.log(`Updated SectionTemplate.title -> "${NEW_SECTION_TITLE}" and sellerGuidance`);
  } else {
    console.log('SectionTemplate already up to date');
  }

  for (const q of [TITLE_REGISTER_QUESTION, TITLE_PLAN_QUESTION]) {
    const { id, ...data } = q;
    const existing = await prisma.questionTemplate.findUnique({ where: { id } });
    if (!existing) {
      console.warn(`  SKIPPED - QuestionTemplate not found: ${id} (has the seed changed since this script was written?)`);
      continue;
    }
    await prisma.questionTemplate.update({ where: { id }, data: data as any });
    console.log(`  updated: ${id} -> "${q.parts[0].title}"`);
  }

  console.log('\nDone. No backfill needed - task structure (title_deeds_review, order 1 & 2) is unchanged.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
