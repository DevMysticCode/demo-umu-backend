// Client feedback, 2026-10-06 (round 4):
//  1. occupiers/vacant_possession had the vacant-possession question
//     duplicated 3 times - order=2 is an exact duplicate of order=1
//     (deleted); order=3's own part title was ALSO wrongly overwritten
//     with "Is the property being sold with vacant possession?" when it's
//     really TA6 13.6 ("have all occupiers agreed to sign..."), with the
//     real question text stuffed into its description (same recurring
//     bug). Fixed the title, and added TA6 13.7 (tenancy agreement
//     details if not vacant possession), which didn't exist at all.
//  2. transactionInformation/seller_obligations had the same "generic
//     title + real question in description" bug across all 4 of its rows.
//  3. services/connection_to_services_and_utilities was missing "Small
//     sewage treatment plant" and "Shared ground/air source heat pumps"
//     from TA6's Connection to Services list.
//
// Run manually: npx ts-node -r tsconfig-paths/register src/scripts/fix-occupiers-transaction-services.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function deleteOrphanedInstances(templateId: string) {
  const instances = await prisma.passportQuestion.findMany({
    where: { questionTemplateId: templateId },
    select: { id: true },
  });
  if (!instances.length) return;
  await prisma.questionAnswer.deleteMany({ where: { passportQuestionId: { in: instances.map((i) => i.id) } } });
  await prisma.passportQuestion.deleteMany({ where: { id: { in: instances.map((i) => i.id) } } });
  console.log(`  removed from ${instances.length} existing passport(s)`);
}

async function main() {
  // ── 1. vacant_possession ──────────────────────────────────────────
  console.log('--- vacant_possession ---');
  const dupId = '77a4b993-5c86-47ab-b48d-b67f307157ee'; // order=2, exact duplicate of order=1
  await deleteOrphanedInstances(dupId);
  await prisma.questionTemplate.delete({ where: { id: dupId } });
  console.log('Deleted duplicate "Is the property being sold with vacant possession?" (order 2).');

  const signId = 'b68214ec-dce2-47a0-a3fd-2115887152c9'; // order=3
  const signRow = await prisma.questionTemplate.findUniqueOrThrow({ where: { id: signId } });
  const signParts = signRow.parts as any[];
  signParts[0].title = 'Have all occupiers aged 17 or over agreed to sign the sale contract and to complete?';
  signParts[0].description = '';
  signParts[1].title = 'If no, please supply other evidence that the property will be vacant on completion.';
  await prisma.questionTemplate.update({ where: { id: signId }, data: { parts: signParts } });
  console.log('Fixed order=3\'s title (was a duplicate of the main question; TA6 13.6 is about occupiers signing).');

  const tenancyExists = await prisma.questionTemplate.findFirst({
    where: { sectionKey: 'occupiers', taskKey: 'vacant_possession', title: { contains: 'tenancy agreements' } },
  });
  let tenancyTemplateId: string;
  if (tenancyExists) {
    tenancyTemplateId = tenancyExists.id;
    console.log('13.7 tenancy-agreement question already exists - skipping create.');
  } else {
    const created = await prisma.questionTemplate.create({
      data: {
        sectionKey: 'occupiers',
        taskKey: 'vacant_possession',
        title: 'If the property is not being sold with vacant possession, provide details of their tenancy agreements.',
        type: 'RADIO',
        options: [
          { label: 'Attached', value: 'attached' },
          { label: 'To follow', value: 'to_follow' },
        ],
        order: 4,
        points: 25,
        readiness: [{ order: 1, milestone: 40, blockerTrigger: null, blocksPublication: 'no' }],
      },
    });
    tenancyTemplateId = created.id;
    console.log('Created TA6 13.7 "tenancy agreements" question.');
  }
  // Retrofit onto existing passports' vacant_possession task.
  {
    const tasks = await prisma.passportSectionTask.findMany({
      where: { key: 'vacant_possession', passportSection: { key: 'occupiers' } },
      select: { id: true },
    });
    let added = 0;
    for (const task of tasks) {
      const already = await prisma.passportQuestion.findFirst({
        where: { passportSectionTaskId: task.id, questionTemplateId: tenancyTemplateId },
      });
      if (already) continue;
      await prisma.passportQuestion.create({ data: { passportSectionTaskId: task.id, questionTemplateId: tenancyTemplateId } });
      added++;
    }
    console.log(`  retrofitted onto ${added} existing passport(s)`);
  }

  // ── 2. seller_obligations ─────────────────────────────────────────
  console.log('\n--- seller_obligations ---');
  const obligationFixes: Array<{ id: string; title: string }> = [
    {
      id: 'c22f6f60-0768-46b6-8f4c-3eb385466d38',
      title:
        'Will the seller ensure that all rubbish is removed from the property (including from the loft, garden, outbuildings, garages and sheds) and that the property will be left in a clean and tidy condition?',
    },
    {
      id: 'bfb11576-1ee9-4fe7-89b7-171cbd6f1c51',
      title:
        'Will the seller ensure that, if light fittings are removed, the fittings will be replaced with a ceiling rose, flex, bulb holder and bulb?',
    },
    {
      id: '57c160c0-3462-458c-9c55-58bf5604b522',
      title: 'Will the seller ensure that reasonable care will be taken when removing any other fittings or contents?',
    },
    {
      id: '21fd3e94-b252-4baf-8d3d-103c4e89f2e1',
      title:
        'Will the seller ensure that keys to all windows and doors and details of alarm codes will be left at the property or with the estate agent?',
    },
  ];
  for (const fix of obligationFixes) {
    await prisma.questionTemplate.update({ where: { id: fix.id }, data: { title: fix.title, description: '' } });
    console.log(`Fixed: "${fix.title}"`);
  }

  // ── 3. connection_to_services_and_utilities ───────────────────────
  console.log('\n--- connection_to_services_and_utilities ---');
  const NEW_UTILITIES: Array<{ partKey: string; title: string; fields: Array<{ key: string; placeholder: string }> }> = [
    {
      partKey: 'small_sewage_treatment_plant',
      title: 'Small sewage treatment plant - is this service/utility connected to the property?',
      fields: [
        { key: 'provide_name', placeholder: 'Provider name' },
        { key: 'make_model', placeholder: 'Make / model' },
        { key: 'service_provider_name', placeholder: "Service provider's name" },
      ],
    },
    {
      partKey: 'shared_ground_air_source_heat_pumps',
      title: 'Shared ground / air source heat pumps - is this service/utility connected to the property?',
      fields: [
        { key: 'provide_name', placeholder: 'Provider name' },
        { key: 'make_model', placeholder: 'Make / model' },
        { key: 'service_provider_name', placeholder: "Service provider's name" },
      ],
    },
  ];

  const existingOrders = (
    await prisma.questionTemplate.findMany({
      where: { sectionKey: 'services', taskKey: 'connection_to_services_and_utilities' },
      select: { order: true },
    })
  ).map((r) => r.order);
  let nextOrder = Math.max(...existingOrders) + 1;

  const createdUtilityIds: string[] = [];
  for (const utility of NEW_UTILITIES) {
    const exists = await prisma.questionTemplate.findFirst({
      where: { sectionKey: 'services', taskKey: 'connection_to_services_and_utilities', title: utility.title },
    });
    if (exists) {
      console.log(`SKIP "${utility.title}" - already exists.`);
      createdUtilityIds.push(exists.id);
      continue;
    }
    const created = await prisma.questionTemplate.create({
      data: {
        sectionKey: 'services',
        taskKey: 'connection_to_services_and_utilities',
        title: '',
        description: '',
        type: 'MULTIPART',
        order: nextOrder++,
        points: 25,
        readiness: [{ order: 1, milestone: 40, blockerTrigger: null, blocksPublication: 'no' }],
        parts: [
          {
            type: 'RADIO',
            order: 1,
            title: utility.title,
            options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }],
            partKey: utility.partKey,
            description: 'Please answer Yes or No and provide details of any providers.',
          },
          {
            type: 'multifieldform',
            order: 2,
            title: 'Please specify the following provider details.',
            fields: utility.fields,
            display: 'both',
            partKey: `${utility.partKey}_details`,
            required: true,
            repeatable: false,
            showOnValues: ['yes'],
            conditionalOn: utility.partKey,
          },
        ],
      },
    });
    createdUtilityIds.push(created.id);
    console.log(`Created: "${utility.title}"`);
  }

  // Retrofit onto existing passports.
  {
    const tasks = await prisma.passportSectionTask.findMany({
      where: { key: 'connection_to_services_and_utilities', passportSection: { key: 'services' } },
      select: { id: true },
    });
    for (const templateId of createdUtilityIds) {
      let added = 0;
      for (const task of tasks) {
        const already = await prisma.passportQuestion.findFirst({
          where: { passportSectionTaskId: task.id, questionTemplateId: templateId },
        });
        if (already) continue;
        await prisma.passportQuestion.create({ data: { passportSectionTaskId: task.id, questionTemplateId: templateId } });
        added++;
      }
      console.log(`  retrofitted ${templateId} onto ${added} existing passport(s)`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
