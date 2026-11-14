// Applies the UMU_278 content pack's 19 named source/control corrections
// (UMU_Source_Control_Corrections.json, developer handoff 2 Oct 2026) to
// the live QuestionTemplate rows they identify. These are field-shape
// fixes, not copy changes - import-278-question-content.ts already handled
// the guidance text; this script is the "the live control itself was
// wrong" half of the pack.
//
// Of the 19, this script applies 14 directly-identified ones plus the
// curtains fix's 1 extra room (Bedroom 3) found by task+title instead of
// source-paragraph mapping, since 3 of its 3 occurrences (paragraphs 1105,
// 1369, 1404) were left unmapped by the importer (duplicate headings the
// pack itself flagged as ambiguous). The remaining corrections (#556, #559
// - duplicate "vacant possession" headings) are still unmapped and are NOT
// touched here - guessing which live template a duplicate heading means
// risks editing the wrong question.
//
// Also NOT applied: #1655's "remove obsolete eligibility gate" - that
// describes some downstream gating behaviour this script didn't locate
// with confidence; changing the template's own options (already a plain
// Yes/No) wouldn't address it, and guessing at hidden gating logic risks
// breaking something real. Left as a flagged follow-up.
//
// Run manually: npx ts-node -r tsconfig-paths/register src/scripts/apply-19-source-corrections.ts
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function updateParts(templateId: string, mutate: (parts: any[]) => any[]) {
  const t = await prisma.questionTemplate.findUnique({ where: { id: templateId } });
  if (!t) throw new Error(`Template ${templateId} not found`);
  const parts = mutate(JSON.parse(JSON.stringify(t.parts ?? [])));
  await prisma.questionTemplate.update({
    where: { id: templateId },
    data: { parts: parts as unknown as Prisma.InputJsonValue },
  });
}

async function updateOptions(templateId: string, options: any[], extra: Record<string, unknown> = {}) {
  await prisma.questionTemplate.update({
    where: { id: templateId },
    data: { options: options as unknown as Prisma.InputJsonValue, ...extra },
  });
}

const ADD_UNKNOWN = { label: "I'm not sure", value: 'unknown' };

async function main() {
  // #75 - service charge: remove the "years" entry, add a real frequency
  // choice, charging basis, keep the working currency-amount mechanism and
  // the existing evidence upload.
  await updateParts('64506834-fcec-4808-aaa7-36c1de35f121', () => [
    {
      type: 'date',
      order: 1,
      title: 'If your lease includes a service charge, it will set out the way the service charge is organised and what can be charged.',
      options: [
        { label: 'Service charges amount', value: 'service_charge', hasDate: true, inputType: 'currency', datePlaceholder: '£ 1500' },
      ],
      partKey: 'expiry_length',
      description: 'Service charges are usually for the maintenance and upkeep of the property, including common areas and gardens. ',
      externalLink: { url: 'https://www.google.com', label: 'Find out more about service charges' },
    },
    {
      type: 'radio',
      order: 2,
      partKey: 'service_charge_frequency',
      title: 'How often is the service charge paid?',
      options: [
        { label: 'Monthly', value: 'monthly' },
        { label: 'Quarterly', value: 'quarterly' },
        { label: 'Annually', value: 'annually' },
        { label: 'Other', value: 'other' },
      ],
    },
    {
      type: 'radio',
      order: 3,
      partKey: 'service_charge_basis',
      title: 'How is the service charge calculated?',
      options: [
        { label: 'Fixed amount', value: 'fixed' },
        { label: 'Variable - reviewed each year', value: 'variable' },
        { label: 'Percentage of service costs', value: 'percentage' },
        { label: 'Not sure', value: 'unsure' },
      ],
    },
    {
      type: 'upload',
      order: 4,
      title: 'Please upload supporting document.',
      partKey: 'photos',
      uploadInstruction: 'Please upload supporting document.',
    },
  ]);
  console.log('#75 service charge - done');

  // #207 - "Building works" part only, inside the shared building_works
  // MULTIPART template that also carries the live P39 glazing trigger
  // (installation_of_replacement) - every other part is left byte-for-byte
  // unchanged. Adds the missing "I'm not sure" option; a full dated
  // multi-work schedule is a bigger structural change on a
  // pathway-sensitive template, left as a flagged follow-up rather than
  // risked here.
  await updateParts('32bd7780-70f3-480a-95f0-ae0e16408b64', (parts) => {
    const buildingWorks = parts.find((p: any) => p.partKey === 'Are_irregular_boundaries');
    if (buildingWorks && !buildingWorks.options.some((o: any) => o.value === 'unknown')) {
      buildingWorks.options.push({ label: "I'm not sure", value: 'unknown' });
    }
    return parts;
  });
  console.log('#207 building works - done (Unknown option added; dated multi-work schedule left as follow-up)');

  // #241 - solar panels installed: add Unknown; installation date already
  // collected via the existing "Yes, select year" option.
  {
    const t = await prisma.questionTemplate.findUnique({ where: { id: 'b621e006-a7ac-4aae-94fe-2c7fbc134fb3' } });
    const options = JSON.parse(JSON.stringify(t?.options ?? []));
    if (!options.some((o: any) => o.value === 'unknown')) options.push(ADD_UNKNOWN);
    await updateOptions('b621e006-a7ac-4aae-94fe-2c7fbc134fb3', options);
  }
  console.log('#241 solar panels installed - done');

  // #246 - solar panels owned outright: add Unknown, and a conditional
  // detail field for the ownership/finance/lease arrangement when not
  // owned outright - today this question has no way to say HOW it's
  // financed, only whether it's outright.
  await updateParts('df156325-e99f-490e-bd7d-3862ffee9d26', () => [
    {
      type: 'radio',
      order: 1,
      partKey: 'solar_panels_owned_outright',
      title: 'Are the solar panels owned outright?',
      options: [
        { label: 'Yes', value: 'yes' },
        { label: 'No', value: 'no' },
        ADD_UNKNOWN,
      ],
    },
    {
      type: 'text',
      order: 2,
      partKey: 'solar_panels_finance_details',
      title: 'How are the solar panels financed (e.g. lease, loan, rent-a-roof agreement)?',
      placeholder: 'Describe the ownership or finance arrangement',
      showOnValues: ['no'],
      conditionalOn: 'solar_panels_owned_outright',
    },
  ]);
  console.log('#246 solar panels ownership - done');

  // #573 - electrical installation tested: add Unknown. Test date and
  // report/certificate upload already exist and are left unchanged.
  await updateParts('42efb508-a729-4745-b2a3-72900ad3d5e3', (parts) => {
    const main = parts.find((p: any) => p.partKey === 'electrical_installation');
    if (main && !main.options.some((o: any) => o.value === 'unknown')) {
      main.options.push({ label: "I'm not sure", value: 'unknown', hasDate: false });
    }
    return parts;
  });
  console.log('#573 electrical installation tested - done');

  // #578 - property rewired: add Unknown, plus a conditional work schedule
  // (one row per piece of work, with its own date) so more than one
  // rewiring event can be recorded instead of a single Yes/No. The
  // existing certificate upload is left unconditional/unchanged.
  await updateParts('be8ce14b-f45e-4d29-8e9e-c223cf1fd452', (parts) => {
    const main = parts.find((p: any) => p.partKey === 'property_rewired');
    if (main && !main.options.some((o: any) => o.value === 'unknown')) {
      main.options.push({ label: "I'm not sure", value: 'unknown' });
    }
    const scheduleIndex = parts.findIndex((p: any) => p.partKey === 'photos');
    const schedulePart = {
      type: 'multifieldform',
      order: 1.5,
      partKey: 'rewiring_work_schedule',
      title: 'Tell us about each piece of electrical work',
      repeatable: true,
      buttonText: 'Add another',
      showOnValues: ['yes'],
      conditionalOn: 'property_rewired',
      fields: [
        { key: 'description', label: 'What work was done', type: 'text' },
        { key: 'date', label: 'When (approximate date is fine)', type: 'date' },
      ],
    };
    if (!parts.some((p: any) => p.partKey === 'rewiring_work_schedule')) {
      parts.splice(scheduleIndex >= 0 ? scheduleIndex : parts.length, 0, schedulePart);
    }
    return parts;
  });
  console.log('#578 property rewired - done');

  // #1655 - deliberately NOT changed; see file header.
  console.log('#1655 owned 2+ years - skipped (see file header: hidden eligibility-gate logic not located)');

  // #1681 - this was the actual bug the correction describes: the template
  // asks for a document upload in its title but its only control was a
  // Current/Previous Leaseholder choice, with nowhere to attach a file at
  // all. Converts to MULTIPART: upload + the provenance choice alongside
  // it, instead of in place of it.
  await prisma.questionTemplate.update({
    where: { id: '11ac92e4-dda7-4f7b-babf-2a1dc9aec011' },
    data: {
      type: 'MULTIPART',
      options: Prisma.JsonNull,
      parts: [
        {
          type: 'upload',
          order: 1,
          partKey: 'deed_certificate',
          title: 'Please supply a copy of the leaseholder deed of certificate and the accompanying evidence.',
          uploadInstruction: 'Upload the certificate and evidence',
        },
        {
          type: 'radio',
          order: 2,
          partKey: 'certificate_provenance',
          title: 'Is this certificate for the current leaseholder or a previous leaseholder?',
          options: [
            { label: 'Current leaseholder', value: 'current_leaseholder' },
            { label: 'Previous leaseholder', value: 'previous_leaseholder' },
          ],
        },
      ] as unknown as Prisma.InputJsonValue,
    },
  });
  console.log('#1681 leaseholder deed of certificate - done (now actually collects the document)');

  // Curtains - #1105/#1115/#1118/#1121/#1124/#1127/#1142: a bare Yes/No is
  // ambiguous between "present" and "included in the sale". All 7 room
  // templates found live under taskKey curtains_and_curtain_rails (6
  // resolved by source mapping + Bedroom 3, found directly since its 3
  // source occurrences were all left unmapped as duplicate headings).
  const CURTAIN_TEMPLATE_IDS = [
    '5eb96503-8907-4a0c-8f95-0faba72bed2d', // Hall, Stairs and Landing
    '7736bb0f-0b13-40db-b12f-4d589bbe3dfc', // Kitchen
    '364fffc6-cf3c-4ee2-aa16-1fc40a5e0cbb', // Dining Room
    'e68469b6-0c14-44d6-bd5d-91cac103f145', // Bedroom 1
    '8aa1bf13-1110-4aa1-81c9-15be2998e762', // Bedroom 2
    '746500f5-52f7-4a26-adec-88e72e42ff7b', // Living Room
    '1dacc6c4-916e-48bb-9f9f-5e968de93793', // Bedroom 3
  ];
  const CURTAIN_OPTIONS = [
    { label: 'Included in the sale', value: 'included' },
    { label: 'Present, but not included', value: 'present_not_included' },
    { label: 'Not present in this room', value: 'not_present' },
  ];
  for (const id of CURTAIN_TEMPLATE_IDS) {
    await updateOptions(id, CURTAIN_OPTIONS);
  }
  console.log(`Curtains - ${CURTAIN_TEMPLATE_IDS.length} room templates updated with explicit inclusion options`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
