// One-off seed for the History feature's rule engine (client handoff,
// 2026-09-25). Seeds exactly ONE demo rule, matching the spec's own
// "illustrative example" in spirit — deliberately not attempting the full
// ~500-question rule catalogue, which the client's own handoff document
// says "cannot be mapped accurately until the seller-question document and
// any current database/export are reconciled" and needs legal/content
// review before real rule copy ships (see HISTORY_FEATURE_PLAN.md §4.3).
//
// This rule watches the real "Windows, Roof Lights or Glazed Doors
// guarantees/warranties" question (guaranteesAndWarranties /
// window_roof_light_door) and creates a guidance action when the seller
// answers "No" — no documented warranty/compliance evidence on file,
// mirroring the spec's windows/FENSA example without inventing a question
// that doesn't exist in the live catalogue.
//
// Run manually: npx ts-node -T src/scripts/seed-passport-rules.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const WINDOW_QUESTION_ID = 'babed250-efa2-4625-b178-5a7536fc0be9';
const RULE_KEY = 'windows_warranty_evidence';

async function main() {
  const question = await prisma.questionTemplate.findUnique({
    where: { id: WINDOW_QUESTION_ID },
  });
  if (!question) {
    console.error(`Question template ${WINDOW_QUESTION_ID} not found — has the catalogue changed? Skipping seed.`);
    await prisma.$disconnect();
    return;
  }

  const existing = await prisma.passportRule.findUnique({
    where: { ruleKey_version: { ruleKey: RULE_KEY, version: 1 } },
  });
  if (existing) {
    console.log('Demo rule already seeded, nothing to do.');
    await prisma.$disconnect();
    return;
  }

  await prisma.passportRule.create({
    data: {
      ruleKey: RULE_KEY,
      version: 1,
      enabled: true,
      jurisdiction: null,
      questionIds: [WINDOW_QUESTION_ID],
      conditionExpression: JSON.stringify({
        questionId: WINDOW_QUESTION_ID,
        partKey: 'glazed_doors_guarantees',
        answerEquals: 'no',
      }),
      severity: 'advisory',
      userTitle: 'Find your window/door paperwork',
      userExplanation:
        "You said there's no warranty or guarantee on file for the property's windows, roof lights or glazed doors. A buyer's conveyancer may ask for evidence that any past replacement work complied with Building Regulations. Look for a FENSA, CERTASS or Glass and Glazing Federation (GGF) certificate, or a Local Authority Building Control completion certificate, from when the windows/doors were installed. If you can't find one, it's worth discussing your options with your conveyancer.",
      acceptedEvidenceTypes: ['fensa_certificate', 'certass_certificate', 'ggf_certificate', 'building_control_certificate', 'warranty_document'],
      suggestedSteps: [
        'Search your records for a FENSA, CERTASS or GGF certificate',
        'Ask the installer for their registration/certificate details',
        'Check for Local Authority Building Control paperwork',
        'If none is available, discuss your circumstances with your conveyancer',
      ],
      actionType: 'FIND_EVIDENCE',
      professionalReviewFlag: true,
      sourceReference: 'UMU_Passport_History_Developer_Handoff.md §4, illustrative example',
      contentReviewedAt: null, // deliberately unset — flagged for legal/content review before this copy is treated as final
    },
  });

  console.log('Seeded demo rule:', RULE_KEY);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
