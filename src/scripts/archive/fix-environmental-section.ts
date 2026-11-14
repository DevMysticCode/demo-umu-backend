// Environmental section fixes (client feedback, 2026-10-06):
//
// 1. "Flooding" had a duplicate question row (order=2) with the exact
//    same title as order=1, and mismatched buyerGuidance content (about
//    insurance claims history, not flooding) - clearly a content-import
//    mix-up. Deleted.
// 2. Radon's helpText on all 3 rows had a content-author's editing note
//    leaked into the live copy ("- also bottom bit is wrong remove this
//    ...", "- please remove text answer yes or no", "- remove please
//    answer yes or no"). Stripped.
// 3. Missing TA6 8.2 "Are you aware of any defences installed at the
//    property to prevent flooding?" - added as a new Flooding question
//    (reusing the order=2 slot freed up by the deleted duplicate).
// 4. Radon's "below action level" (8.3b) and "remedial measures" (8.4)
//    only offered Yes/No - TA6 offers Yes/No/Not known. Added the third
//    option.
// 5. Green Deal (8.5) only had a free-text "give details" follow-up - TA6
//    also asks for the electricity bill as Attached/To follow. Added.
// 6. Japanese knotweed (8.6) only asked the single top-level question -
//    missing the "management and treatment plan in place?" sub-question
//    and its "supply a copy" follow-up, and entirely missing 8.7 ("has a
//    survey been carried out?"). Added both.
//
// Run manually: npx ts-node -r tsconfig-paths/register src/scripts/fix-environmental-section.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const NOT_KNOWN = { label: 'Not known', value: 'not_known' };
const ATTACHED_TO_FOLLOW = [
  { label: 'Attached', value: 'attached' },
  { label: 'To follow', value: 'to_follow' },
];

async function main() {
  // 1. Delete the duplicate Flooding row - first its in-passport instances
  // (31 existing passports already got this question seeded), since
  // PassportQuestion.questionTemplateId has no cascading delete from this
  // side.
  const DUP_ID = 'f5739fc8-5b76-4cf9-ade9-d071c782aafb';
  const dupQuestions = await prisma.passportQuestion.findMany({
    where: { questionTemplateId: DUP_ID },
    select: { id: true },
  });
  if (dupQuestions.length) {
    // All 3 Flooding QuestionTemplate rows share ONE PassportSectionTask
    // per passport (seedPassportContent groups by taskKey) - delete just
    // this one orphaned PassportQuestion row, not the whole task, or the
    // valid order=1/order=3 Flooding questions would go with it.
    await prisma.questionAnswer.deleteMany({
      where: { passportQuestionId: { in: dupQuestions.map((q) => q.id) } },
    });
    await prisma.passportQuestion.deleteMany({
      where: { id: { in: dupQuestions.map((q) => q.id) } },
    });
    console.log(`Removed the duplicate question from ${dupQuestions.length} existing passport(s).`);
  }
  const deleted = await prisma.questionTemplate.delete({ where: { id: DUP_ID } });
  console.log(`Deleted duplicate Flooding row (order ${deleted.order}).`);

  // 2. Strip the leaked editing notes from radon helpText.
  const radonFixes: Array<{ id: string; clean: string }> = [
    {
      id: '0cd6a8df-5b52-483a-b858-c67d9471e88f',
      clean:
        'This helps show whether the property has ever been checked for radon levels. Having this information can reassure buyers about safety and may avoid the need for extra tests or delays later on.',
    },
    {
      id: 'c07401ee-fec1-4872-9595-413e16d0392d',
      clean:
        'This helps show whether the property meets recommended safety guidelines. Knowing this upfront can reassure buyers and avoid extra checks, concerns, or delays later in the process.',
    },
    {
      id: 'b7c6ba87-af37-44ba-badf-359cf63efd97',
      clean:
        'This helps show whether any steps were taken to manage or reduce radon levels when the property was built. Sharing this can reassure buyers about safety and help avoid extra questions or delays later on.',
    },
  ];
  for (const fix of radonFixes) {
    await prisma.questionTemplate.update({ where: { id: fix.id }, data: { helpText: fix.clean } });
  }
  console.log(`Cleaned leftover editing notes from ${radonFixes.length} radon helpText fields.`);

  // 3. Add the missing flood defences question, at the order=2 slot
  // freed up by the deleted duplicate.
  const created = await prisma.questionTemplate.create({
    data: {
      sectionKey: 'environmental',
      taskKey: 'Flooding',
      title: '',
      description: '',
      type: 'MULTIPART',
      order: 2,
      points: 25,
      readiness: [{ order: 1, milestone: 40, blockerTrigger: null, blocksPublication: 'no' }],
      parts: [
        {
          type: 'RADIO',
          order: 1,
          title: 'Are you aware of any defences installed at the property to prevent flooding?',
          options: [
            { label: 'Yes', value: 'yes' },
            NOT_KNOWN,
            { label: 'No', value: 'no' },
          ],
          partKey: 'flood_defences',
          helpText:
            'Flood defences include barriers, non-return valves, sumps or pumps installed to reduce the risk or impact of flooding.',
        },
        {
          type: 'text',
          order: 2,
          title: 'If yes, please give details',
          display: 'both',
          partKey: 'flood_defences_details',
          required: true,
          placeholder: 'Start typing here.....',
          conditionalOn: 'flood_defences',
          showOnValues: ['yes'],
        },
      ],
    },
  });
  console.log(`Created flood defences question (${created.id}).`);

  // 4. Add "Not known" to radon's below-action-level and remedial-measures
  // questions (top-level `options` column, since these are plain RADIO
  // rows, not MULTIPART).
  for (const id of ['c07401ee-fec1-4872-9595-413e16d0392d', 'b7c6ba87-af37-44ba-badf-359cf63efd97']) {
    const q = await prisma.questionTemplate.findUniqueOrThrow({ where: { id } });
    const options = Array.isArray(q.options) ? (q.options as any[]) : [];
    if (options.some((o) => o.value === 'not_known')) continue;
    await prisma.questionTemplate.update({
      where: { id },
      data: { options: [...options, NOT_KNOWN] },
    });
  }
  console.log(`Added "Not known" option to radon's two follow-up questions.`);

  // 5. Green Deal - add the Attached/To follow electricity bill part.
  const greenDeal = await prisma.questionTemplate.findUniqueOrThrow({
    where: { id: '016c7798-b182-4810-a377-7432c0050063' },
  });
  const gdParts = greenDeal.parts as any[];
  if (!gdParts.some((p) => p.partKey === 'green_deal_bill_doc')) {
    gdParts.push({
      type: 'RADIO',
      order: 3,
      title: 'Supply a copy of your latest electricity bill',
      options: ATTACHED_TO_FOLLOW,
      partKey: 'green_deal_bill_doc',
      conditionalOn: 'have_any_part',
      showOnValues: ['yes'],
    });
    await prisma.questionTemplate.update({ where: { id: greenDeal.id }, data: { parts: gdParts } });
    console.log('Added electricity bill (Attached/To follow) to Green Deal question.');
  }

  // 6. Japanese knotweed - add the management/treatment-plan sub-question
  // to the existing task, and a new standalone "has a survey been
  // carried out" question.
  const knotweed = await prisma.questionTemplate.findUniqueOrThrow({
    where: { id: '17b4a485-3198-4a57-ab27-c0ebf3f6df0e' },
  });
  const kwParts = knotweed.parts as any[];
  // Add "Not known" to the main question too (top-level type is MULTIPART
  // here, so its options live in parts[0], not the top-level column).
  const mainKwPart = kwParts.find((p) => p.partKey === 'have_any_part');
  if (mainKwPart && !mainKwPart.options.some((o: any) => o.value === 'not_known')) {
    mainKwPart.options.push(NOT_KNOWN);
  }
  if (!kwParts.some((p) => p.partKey === 'knotweed_plan_in_place')) {
    kwParts.push(
      {
        type: 'RADIO',
        order: 3,
        title: 'Is there a Japanese knotweed management and treatment plan in place?',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
          NOT_KNOWN,
        ],
        partKey: 'knotweed_plan_in_place',
        conditionalOn: 'have_any_part',
        showOnValues: ['yes'],
      },
      {
        type: 'RADIO',
        order: 4,
        title: 'If yes, provide a copy of the plan with any insurance cover linked to the plan',
        options: ATTACHED_TO_FOLLOW,
        partKey: 'knotweed_plan_doc',
        conditionalOn: 'knotweed_plan_in_place',
        showOnValues: ['yes'],
      },
    );
    await prisma.questionTemplate.update({ where: { id: knotweed.id }, data: { parts: kwParts } });
    console.log('Added management/treatment-plan follow-up to Japanese knotweed question.');
  }

  const knotweedSurveyExists = await prisma.questionTemplate.findFirst({
    where: { sectionKey: 'environmental', taskKey: 'japanese_knotweed', order: 2 },
  });
  if (!knotweedSurveyExists) {
    const survey = await prisma.questionTemplate.create({
      data: {
        sectionKey: 'environmental',
        taskKey: 'japanese_knotweed',
        title: '',
        description: '',
        type: 'MULTIPART',
        order: 2,
        points: 25,
        readiness: [{ order: 1, milestone: 40, blockerTrigger: null, blocksPublication: 'no' }],
        parts: [
          {
            type: 'RADIO',
            order: 1,
            title: 'Has a Japanese knotweed survey been carried out in relation to the property?',
            options: [
              { label: 'Yes', value: 'yes' },
              { label: 'No', value: 'no' },
              NOT_KNOWN,
            ],
            partKey: 'knotweed_survey_done',
            helpText:
              'A professional survey identifies whether knotweed is present and assesses the extent of any infestation.',
          },
          {
            type: 'RADIO',
            order: 2,
            title: 'If yes, provide a copy of the survey',
            options: ATTACHED_TO_FOLLOW,
            partKey: 'knotweed_survey_doc',
            conditionalOn: 'knotweed_survey_done',
            showOnValues: ['yes'],
          },
        ],
      },
    });
    console.log(`Created Japanese knotweed survey question (${survey.id}).`);
  }

  // 7. Retrofit: both new QuestionTemplate rows (flood defences, knotweed
  // survey) need a PassportQuestion added under their task's EXISTING
  // PassportSectionTask for every already-in-progress passport - a brand
  // new QuestionTemplate is otherwise invisible to a passport whose
  // sections were seeded before this script ran.
  const retrofits: Array<{ sectionKey: string; taskKey: string; templateId: string }> = [
    { sectionKey: 'environmental', taskKey: 'Flooding', templateId: created.id },
  ];
  const surveyTemplate = await prisma.questionTemplate.findFirst({
    where: { sectionKey: 'environmental', taskKey: 'japanese_knotweed', order: 2 },
  });
  if (surveyTemplate) {
    retrofits.push({ sectionKey: 'environmental', taskKey: 'japanese_knotweed', templateId: surveyTemplate.id });
  }

  for (const r of retrofits) {
    const tasks = await prisma.passportSectionTask.findMany({
      where: {
        key: r.taskKey,
        passportSection: { key: r.sectionKey },
      },
      select: { id: true },
    });
    let addedCount = 0;
    for (const task of tasks) {
      const already = await prisma.passportQuestion.findFirst({
        where: { passportSectionTaskId: task.id, questionTemplateId: r.templateId },
      });
      if (already) continue;
      await prisma.passportQuestion.create({
        data: { passportSectionTaskId: task.id, questionTemplateId: r.templateId },
      });
      addedCount++;
    }
    console.log(`Retrofitted ${r.taskKey}/${r.templateId} onto ${addedCount} existing passport(s).`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
