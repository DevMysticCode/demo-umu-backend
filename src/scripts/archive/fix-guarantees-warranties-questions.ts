// Guarantees and Warranties section fixes (client feedback, 2026-10-06):
//
// 1. Three tasks (central_heating, roofing, underpinning) had their part's
//    title left as the generic "Does the property benefit from any of the
//    following guarantees or warranties:" with the actual topic ("Central
//    Heating" / "Roofing" / "Underpinning") stuffed into the description
//    field instead - every other task in this section already phrases the
//    topic into a self-contained question ("...any Timber Treatment
//    guarantees...", etc). This fixes those three to match.
//
// 2. None of the 8 guarantee-type tasks had the TA6's own two follow-up
//    questions (claims under the guarantee, anything that might breach its
//    terms) - this adds both, as two more RADIO+conditional-text part
//    pairs, gated on the task's main question being answered "yes".
//
// Run manually: npx ts-node -r tsconfig-paths/register src/scripts/fix-guarantees-warranties-questions.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const STANDARD_DESCRIPTION =
  'If yes, please provide details of the provider, policy number, start and end date, a copy of the certificate and any claims made under the warranty with details and outcomes.';

// taskKey -> corrected self-contained title (only the 3 broken ones).
const TITLE_FIXES: Record<string, string> = {
  central_heating: 'Does the property benefit from any central heating guarantees or warranties?',
  roofing: 'Does the property benefit from any roofing guarantees or warranties?',
  underpinning: 'Does the property benefit from any underpinning guarantees or warranties?',
};

const GUARANTEE_TASK_KEYS = [
  'central_heating',
  'damp_proofing',
  'electrical_work',
  'new_home_warranty',
  'roofing',
  'timber_treatment',
  'underpinning',
  'window_roof_light_door',
];

async function main() {
  for (const taskKey of GUARANTEE_TASK_KEYS) {
    const q = await prisma.questionTemplate.findFirst({
      where: { sectionKey: 'guaranteesAndWarranties', taskKey },
    });
    if (!q) {
      console.log(`SKIP ${taskKey} - not found`);
      continue;
    }
    const parts = Array.isArray(q.parts) ? (q.parts as any[]) : [];
    const mainPart = parts.find((p) => p.order === 1);
    if (!mainPart) {
      console.log(`SKIP ${taskKey} - no order:1 part found`);
      continue;
    }
    const mainPartKey = mainPart.partKey;

    // 1. Fix the three broken titles.
    if (TITLE_FIXES[taskKey]) {
      mainPart.title = TITLE_FIXES[taskKey];
      mainPart.description = STANDARD_DESCRIPTION;
    }

    // 2. Skip if the claims/breach follow-ups already exist (idempotent re-run).
    const alreadyHasClaims = parts.some((p) => p.partKey === 'claims_aware');
    if (alreadyHasClaims) {
      console.log(`${taskKey}: title fixed, claims/breach already present - updating title/description only`);
      await prisma.questionTemplate.update({ where: { id: q.id }, data: { parts } });
      continue;
    }

    const maxOrder = Math.max(...parts.map((p) => p.order ?? 0));

    const newParts = [
      {
        type: 'RADIO',
        order: maxOrder + 1,
        title: 'Are you aware of any claims under any of these guarantees or warranties?',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        partKey: 'claims_aware',
        conditionalOn: mainPartKey,
        showOnValues: ['yes'],
      },
      {
        type: 'text',
        order: maxOrder + 2,
        title: 'If yes, please give details',
        display: 'both',
        partKey: 'claims_details',
        required: true,
        placeholder: 'Start typing here.....',
        conditionalOn: 'claims_aware',
        showOnValues: ['yes'],
      },
      {
        type: 'RADIO',
        order: maxOrder + 3,
        title:
          'Are you aware of anything that may breach the terms and conditions of any of these guarantees or warranties?',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        partKey: 'breach_aware',
        conditionalOn: mainPartKey,
        showOnValues: ['yes'],
      },
      {
        type: 'text',
        order: maxOrder + 4,
        title: 'If yes, please give details',
        display: 'both',
        partKey: 'breach_details',
        required: true,
        placeholder: 'Start typing here.....',
        conditionalOn: 'breach_aware',
        showOnValues: ['yes'],
      },
    ];

    const updatedParts = [...parts, ...newParts];
    await prisma.questionTemplate.update({
      where: { id: q.id },
      data: { parts: updatedParts },
    });
    console.log(`${taskKey}: ${TITLE_FIXES[taskKey] ? 'title fixed, ' : ''}added claims + breach follow-ups (${updatedParts.length} parts total)`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
