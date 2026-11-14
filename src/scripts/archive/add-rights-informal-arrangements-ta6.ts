// Rights and Informal Arrangements: adds a clean TA6 9.1-9.9 structure
// (client feedback, 2026-10-06, matching the attached TA6 scan exactly -
// second-person wording, matching the convention established this session
// for Insurance etc). The existing rightsAndInformalArrangements content
// (14 rows across several oddly-named tasks, e.g. "hidden_rights_and_
// histonic_responsibilities", some near-duplicates of each other) is left
// untouched - it overlaps with some of this in places and would need its
// own dedicated cleanup pass to merge or retire safely, which is bigger
// than this one script. Flagging that as a known follow-up rather than
// risking data loss by deleting things blind.
//
// Three new tasks, matching the TA6 page's own groupings:
//   rights_benefiting_the_property        (9.1-9.3)
//   rights_benefiting_other_properties    (9.4-9.6)
//   facilities_crossing_the_property      (9.7-9.9)
//
// Run manually: npx ts-node -r tsconfig-paths/register src/scripts/add-rights-informal-arrangements-ta6.ts
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

const NOT_KNOWN = { label: 'Not known', value: 'not_known' };
const NOT_APPLICABLE = { label: 'Not applicable', value: 'not_applicable' };
const ATTACHED_TO_FOLLOW = [
  { label: 'Attached', value: 'attached' },
  { label: 'To follow', value: 'to_follow' },
];

function yesNoDetails(detailsTitle: string, partKeyPrefix: string, extraOptions: any[] = []) {
  return [
    {
      type: 'RADIO',
      order: 1,
      title: '', // filled per-question below
      options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }, ...extraOptions],
      partKey: `${partKeyPrefix}_main`,
    },
    {
      type: 'text',
      order: 2,
      title: detailsTitle,
      display: 'both',
      partKey: `${partKeyPrefix}_details`,
      placeholder: 'Start typing here.....',
      conditionalOn: `${partKeyPrefix}_main`,
      showOnValues: ['yes'],
    },
  ];
}

const TASKS: Array<{ taskKey: string; order: number; questions: Array<{ title: string; parts: any[] }> }> = [
  {
    taskKey: 'rights_benefiting_the_property',
    order: 1,
    questions: [
      {
        title: 'Do you exercise any rights or arrangements over any other properties?',
        parts: (() => {
          const p = yesNoDetails('If yes, please give details', 'exercise_rights');
          p[0].title = 'Do you exercise any rights or arrangements over any other properties?';
          return p;
        })(),
      },
      {
        title: 'Have you been asked to contribute towards the cost of the jointly used facilities?',
        parts: (() => {
          const p = yesNoDetails('If yes, give details of how much, how often and who you pay', 'contribute_cost', [NOT_APPLICABLE]);
          p[0].title = 'Have you been asked to contribute towards the cost of the jointly used facilities?';
          return p;
        })(),
      },
      {
        title: 'Are you aware of any disagreement or complaint about any such right or arrangement?',
        parts: (() => {
          const p = yesNoDetails('If yes, please give details', 'rights_disagreement', [NOT_KNOWN]);
          p[0].title = 'Are you aware of any disagreement or complaint about any such right or arrangement?';
          return p;
        })(),
      },
    ],
  },
  {
    taskKey: 'rights_benefiting_other_properties',
    order: 2,
    questions: [
      {
        title: 'Do the owners of any other properties exercise any rights or arrangements over the property?',
        parts: (() => {
          const p = yesNoDetails('If yes, please give details', 'others_exercise_rights');
          p[0].title = 'Do the owners of any other properties exercise any rights or arrangements over the property?';
          return p;
        })(),
      },
      {
        title: 'Have you asked the owner of any other properties to contribute towards the cost of the jointly used facilities?',
        parts: (() => {
          const p = yesNoDetails(
            'If yes, specify whether you receive this payment or if it is made to a third party. Include details about how much is paid and how often payments are made',
            'asked_others_contribute',
            [NOT_APPLICABLE],
          );
          p[0].title =
            'Have you asked the owner of any other properties to contribute towards the cost of the jointly used facilities?';
          return p;
        })(),
      },
      {
        title: 'Are you aware of any disagreement or complaint about any such right or arrangement?',
        parts: (() => {
          const p = yesNoDetails('If yes, please give details', 'others_rights_disagreement', [NOT_KNOWN]);
          p[0].title = 'Are you aware of any disagreement or complaint about any such right or arrangement?';
          return p;
        })(),
      },
    ],
  },
  {
    taskKey: 'facilities_crossing_the_property',
    order: 3,
    questions: [
      {
        title: 'Are you aware of any drains, pipes or wires serving the property that cross any other property?',
        parts: [
          {
            type: 'RADIO',
            order: 1,
            title: 'Are you aware of any drains, pipes or wires serving the property that cross any other property?',
            options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }, NOT_KNOWN],
            partKey: 'drains_serving_cross',
          },
        ],
      },
      {
        title: 'Are you aware of any drains, pipes or wires leading to any other property that cross the property?',
        parts: [
          {
            type: 'RADIO',
            order: 1,
            title: 'Are you aware of any drains, pipes or wires leading to any other property that cross the property?',
            options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }, NOT_KNOWN],
            partKey: 'drains_leading_cross',
          },
        ],
      },
      {
        title: 'Is there any agreement or arrangement about drains, pipes or wires?',
        parts: [
          {
            type: 'RADIO',
            order: 1,
            title: 'Is there any agreement or arrangement about drains, pipes or wires?',
            options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }, NOT_KNOWN],
            partKey: 'drains_agreement',
          },
          {
            type: 'text',
            order: 2,
            title: 'If yes, supply a copy or give details',
            display: 'both',
            partKey: 'drains_agreement_details',
            placeholder: 'Start typing here.....',
            conditionalOn: 'drains_agreement',
            showOnValues: ['yes'],
          },
          {
            type: 'RADIO',
            order: 3,
            title: 'Supply a copy of the agreement',
            options: ATTACHED_TO_FOLLOW,
            partKey: 'drains_agreement_doc',
            conditionalOn: 'drains_agreement',
            showOnValues: ['yes'],
          },
        ],
      },
    ],
  },
];

async function main() {
  const createdTemplateIds: string[] = [];

  for (const task of TASKS) {
    let order = 1;
    for (const q of task.questions) {
      const existing = await prisma.questionTemplate.findFirst({
        where: { sectionKey: 'rightsAndInformalArrangements', taskKey: task.taskKey, order },
      });
      if (existing) {
        console.log(`SKIP ${task.taskKey} order=${order} - already exists.`);
        order++;
        continue;
      }
      const created = await prisma.questionTemplate.create({
        data: {
          sectionKey: 'rightsAndInformalArrangements',
          taskKey: task.taskKey,
          title: '',
          description: '',
          type: 'MULTIPART',
          order,
          points: 25,
          readiness: [{ order: 1, milestone: 40, blockerTrigger: null, blocksPublication: 'no' }],
          parts: q.parts,
        },
      });
      createdTemplateIds.push(created.id);
      console.log(`Created ${task.taskKey} order=${order}: "${q.title}"`);
      order++;
    }
  }

  // Retrofit: these are brand-new taskKeys, so existing passports need a
  // new PassportSectionTask (not just a PassportQuestion on an existing
  // one) - same pattern as the earlier solar-power-systems backfill.
  const sections = await prisma.passportSection.findMany({
    where: { key: 'rightsAndInformalArrangements' },
    select: { id: true },
  });
  console.log(`\nBackfilling ${sections.length} existing rightsAndInformalArrangements section(s)...`);

  for (const task of TASKS) {
    const templates = await prisma.questionTemplate.findMany({
      where: { sectionKey: 'rightsAndInformalArrangements', taskKey: task.taskKey },
      orderBy: { order: 'asc' },
    });
    if (!templates.length) continue;

    for (const section of sections) {
      let sectionTask = await prisma.passportSectionTask.findFirst({
        where: { passportSectionId: section.id, key: task.taskKey },
      });
      if (!sectionTask) {
        sectionTask = await prisma.passportSectionTask.create({
          data: {
            id: randomUUID(),
            passportSectionId: section.id,
            key: task.taskKey,
            title: task.taskKey
              .split('_')
              .map((w) => w[0].toUpperCase() + w.slice(1))
              .join(' '),
            description: null,
            order: 100 + task.order, // after the section's existing tasks, in TA6 order among themselves
          },
        });
      }
      for (const template of templates) {
        const already = await prisma.passportQuestion.findFirst({
          where: { passportSectionTaskId: sectionTask.id, questionTemplateId: template.id },
        });
        if (already) continue;
        await prisma.passportQuestion.create({
          data: { passportSectionTaskId: sectionTask.id, questionTemplateId: template.id },
        });
      }
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
