// Wires the two "worked flow" exceptions the client's content handoff calls
// out by name (see UMU_Full_Question_Engine_Developer_Handoff_DRAFT.md,
// "worked_flow_overrides") to real live questions, and replaces their
// pathway content with the deeper flows the client actually specified for
// them - full B0-B5 branching for boundaries, the equivalent evidence-search
// flow for replacement glazing. Every other one of the 614 source nodes
// keeps the flat per-answer guidance already imported by
// import-passport-content.ts; only these two get a bespoke step tree,
// because only these two have bespoke source material behind them:
//   - UMU_Boundary_Question_Flow_Developer_Guide.md (client handoff,
//     2026-09-30) - B0-B5 steps, the 8-row outcome priority table, case
//     states and acceptance tests. Followed closely below.
//   - UMU_Pilot_Answer_Rules.json was never supplied; instead this reuses
//     the old interactive prototype's renderWindows() logic
//     (D:/downloads_moved/Downloads/passportQuestionUpdate/old/
//     UMU_Passport_Question_Flow_Interactive.html), cross-checked against
//     the one paragraph the handoff draft gives for source child 212 - same
//     branches, same time bands, same FENSA/competent-person-scheme/council
//     checklist. Flag to the client that this is a reconstruction, not a
//     transcription of an authored document, if UMU_Pilot_Answer_Rules.json
//     later turns up with different wording.
//
// Both live questions are MULTIPART (parts, not a single RADIO), which the
// pathway trigger-matching in pathway.service.ts previously couldn't see
// into at all (it stringified the whole answer object) - see the
// checkTriggersForAnswer fix alongside this script.
//
// Run manually: npx ts-node -r tsconfig-paths/register src/scripts/wire-boundary-glazing-pathways.ts
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const BOUNDARY_LIVE_QUESTION_TEMPLATE_ID = 'bb4fbfa5-3899-4c41-b9b3-01bb8c51caf8'; // irregular_boundaries
const BOUNDARY_LIVE_PART_KEY = 'Are_irregular_boundaries';
const GLAZING_LIVE_QUESTION_TEMPLATE_ID = '32bd7780-70f3-480a-95f0-ae0e16408b64'; // building_works
const GLAZING_LIVE_PART_KEY = 'installation_of_replacement';

async function main() {
  // ─── Boundary (source paragraph 133) ────────────────────────────────────

  await prisma.questionSourceMapping.update({
    where: { sourceParagraph: 133 },
    data: {
      liveQuestionTemplateId: BOUNDARY_LIVE_QUESTION_TEMPLATE_ID,
      matchConfidence: 'manual',
      matchNotes: `Matched to the "irregular_boundaries" MULTIPART template's "${BOUNDARY_LIVE_PART_KEY}" part (Yes/No only - the live form has no "I'm not sure" option, unlike the source export/prototype). Deep flow authored from UMU_Boundary_Question_Flow_Developer_Guide.md, client handoff 2026-09-30.`,
      confirmedAt: new Date(),
    },
  });

  await prisma.pathwayQuestionLink.updateMany({
    where: { pathwayId: 'P09', sourceParagraph: 133 },
    data: {
      // Live value, not the workbook's descriptive "clean answer" text -
      // this is what actually gets saved for the live Yes/No part.
      triggerAnswer: 'yes',
    },
  });

  await prisma.resolutionPathway.update({
    where: { id: 'P09' },
    data: {
      name: 'Irregular boundary',
      issue: 'The boundary is irregular in shape, may not match the title plan, or has been questioned by a neighbour.',
      whyItMatters:
        "Buyers and lenders rely on the title plan. HM Land Registry title plans generally show a general boundary, not an exact legal line, so a visual difference isn't automatically a legal problem - but an unresolved mismatch or a live dispute can hold up a sale.",
      timeNow: 'A documentary explanation can usually be assembled in 1-3 weeks',
      timeAtSale: 'A title correction, land transfer or contested boundary can take months',
      checkFirst: 'Your current title plan and register (UMU pulls this automatically); any older transfer, deed or boundary agreement; dated photos of the fence/garden.',
      startStep: 'type',
      steps: BOUNDARY_STEPS as unknown as Prisma.InputJsonValue,
      stopPoint:
        'Whether the general boundary is consistent with the title, whether the title plan needs correcting, whether land lies outside the title and needs a formal transfer route, or whether a dispute needs agreement, a survey or a formal process.',
      toValidate: 'Question wording, conditions, owner actions, privacy treatment, disclosure wording and time bands, by a qualified England & Wales conveyancer, before release.',
      sourceFileVersion: 'UMU_Boundary_Question_Flow_Developer_Guide.md (client handoff, 2026-09-30)',
      status: 'draft',
      contentVersion: { increment: 1 },
    },
  });

  // ─── Replacement glazing (source child 212) ─────────────────────────────

  await prisma.questionSourceMapping.update({
    where: { sourceParagraph: 212 },
    data: {
      liveQuestionTemplateId: GLAZING_LIVE_QUESTION_TEMPLATE_ID,
      matchConfidence: 'manual',
      matchNotes: `Matched to the "building_works" MULTIPART template's "${GLAZING_LIVE_PART_KEY}" part (one of four date-based checklist rows on that question; live form captures only "Yes, select year" / "No", with no separate evidence question). Deep flow reconstructed from the old prototype's renderWindows() (UMU_Passport_Question_Flow_Interactive.html) - UMU_Pilot_Answer_Rules.json, named in the client's export as the authoritative source, was not supplied.`,
      confirmedAt: new Date(),
    },
  });

  await prisma.resolutionPathway.upsert({
    where: { id: 'P39' },
    create: {
      id: 'P39',
      name: 'Replacement glazing since April 2002',
      issue: 'Windows, roof windows or glazed doors were replaced on or after 1 April 2002, which usually needs Building Regulations compliance evidence.',
      whyItMatters:
        'A FENSA certificate (or another competent person scheme record, or building control approval) is the usual evidence a buyer\u2019s conveyancer expects for glazing work from this date. Missing paperwork is not proof the work is non-compliant, but it is something a buyer will ask about.',
      timeNow: '1-2 weeks to search for an existing record',
      timeAtSale: 'Several weeks if a regularisation assessment or remedial work is needed; a council can take up to 8 weeks to issue a certificate after a satisfactory inspection',
      checkFirst: 'The installer\u2019s invoice or guarantee; whether FENSA (or another competent person scheme) has a certificate for the address; whether local building control holds a record.',
      startStep: 'when',
      steps: GLAZING_STEPS as unknown as Prisma.InputJsonValue,
      handover: Prisma.JsonNull,
      stopPoint: 'Whether a compliance record was actually required for this work, and if not, what route (e.g. a local authority regularisation assessment) a buyer or lender might accept.',
      toValidate: 'Question wording, time bands and FENSA/competent-person-scheme links, by a qualified reviewer, before release.',
      status: 'draft',
      validatedBy: null,
      validatedOn: null,
      contentVersion: 1,
      sourceFileVersion: 'Reconstructed from UMU_Passport_Question_Flow_Interactive.html renderWindows() + UMU_Full_Question_Engine_Developer_Handoff_DRAFT.md worked example (client handoff, 2026-09-30) - UMU_Pilot_Answer_Rules.json not supplied',
    },
    update: {
      steps: GLAZING_STEPS as unknown as Prisma.InputJsonValue,
      contentVersion: { increment: 1 },
    },
  });

  await prisma.pathwayQuestionLink.upsert({
    where: { id: 'glazing-source-212-link' },
    create: {
      id: 'glazing-source-212-link',
      pathwayId: 'P39',
      sourceParagraph: 212,
      sourceQuestionId: null,
      section: 'Alterations and Planning',
      sourceQuestionText: 'Installation of replacement windows, roof windows, roof lights, glazed doors since 1 April 2002',
      cleanAnswer: 'Work done since 1 April 2002',
      triggerAnswer: 'selected', // live value for "Yes, select year"
      pdtfPath: null,
      baspi5Ref: null,
      ta6Ref: null,
      ta7Ref: null,
      ta10Ref: null,
    },
    update: { triggerAnswer: 'selected' },
  });

  console.log('Boundary (P09) and glazing (P39) pathways wired to live questions.');
}

// ─── Boundary steps (B0 is the live Yes/No answer that opens this journey) ─

const BOUNDARY_STEPS = [
  {
    id: 'type',
    kind: 'question',
    title: 'What makes the boundary irregular?',
    body: "An unusual shape can be perfectly normal - we need to understand what's different before showing the right guidance.",
    time: '1 minute',
    cost: 'Free',
    options: [
      { label: 'Just an unusual shape', next: 'matches' },
      { label: 'A fence or feature has moved', next: 'moved_detail' },
      { label: 'The land I use looks different from the plan', next: 'matches' },
      { label: "I'm not sure", next: 'matches' },
    ],
    warning: null,
  },
  {
    id: 'moved_detail',
    kind: 'form',
    title: 'What moved, and when?',
    body: "Briefly note what moved (a fence, wall or hedge) and roughly when, in your passport. This is your account, not proof on its own - a moved feature doesn't by itself show a title problem.",
    time: '2 minutes',
    cost: 'Free',
    options: [{ label: 'Continue', next: 'matches' }],
    warning: null,
  },
  {
    id: 'matches',
    kind: 'question',
    title: 'Looking at the title plan and the land you use, do they appear to match?',
    body: 'Title plans usually show a general boundary, not an exact legal line. If you haven\u2019t checked, say so - an unviewed plan is not the same as "No".',
    time: '5 minutes',
    cost: 'Free',
    options: [
      { label: 'Yes, it matches', next: 'dispute_match' },
      { label: 'No, it looks different', next: 'dispute_mismatch' },
      { label: "I haven't checked / not sure", next: 'dispute_unsure' },
    ],
    warning: null,
  },
  {
    id: 'dispute_match',
    kind: 'question',
    title: 'Has a neighbour or anyone else questioned or disputed this boundary?',
    body: 'This is about whether anyone has actually raised it, not whether one could in theory.',
    time: '1 minute',
    cost: 'Free',
    options: [
      { label: 'No', next: 'RESOLVED' },
      { label: "I'm not sure", next: 'CHECK' },
      { label: 'Yes', next: 'dispute_status_match' },
    ],
    warning: null,
  },
  {
    id: 'dispute_mismatch',
    kind: 'question',
    title: 'Has a neighbour or anyone else questioned or disputed this boundary?',
    body: 'This is about whether anyone has actually raised it, not whether one could in theory.',
    time: '1 minute',
    cost: 'Free',
    options: [
      { label: 'No', next: 'extent_evidence' },
      { label: "I'm not sure", next: 'extent_evidence' },
      { label: 'Yes', next: 'dispute_status_mismatch' },
    ],
    warning: null,
  },
  {
    id: 'dispute_unsure',
    kind: 'question',
    title: 'Has a neighbour or anyone else questioned or disputed this boundary?',
    body: 'This is about whether anyone has actually raised it, not whether one could in theory.',
    time: '1 minute',
    cost: 'Free',
    options: [
      { label: 'No', next: 'CHECK' },
      { label: "I'm not sure", next: 'CHECK' },
      { label: 'Yes', next: 'dispute_status_unsure' },
    ],
    warning: null,
  },
  {
    id: 'extent_evidence',
    kind: 'upload',
    title: 'Build the boundary case file',
    body: 'A visual difference is not proof of a legal mistake - gather the documents and show precisely what looks different. Add your current title plan and register, any older transfer or deed plan, dated photos of the fence/garden, and a short note of what looks different and when you first noticed it.',
    time: '30 minutes',
    cost: 'Free',
    options: [{ label: 'Evidence added', next: 'FLAG', requiresUpload: true }],
    warning: "Don't move a fence or send a legal notice on the basis of this screen.",
  },
  {
    id: 'dispute_status_match',
    kind: 'question',
    title: 'What happened with the disagreement?',
    body: 'Note when it began, what each side says, and what has already been discussed.',
    time: '5 minutes',
    cost: 'Free',
    options: [
      { label: 'Still ongoing', next: 'dispute_evidence_match' },
      { label: 'Discussed but not settled in writing', next: 'dispute_evidence_match' },
      { label: "I don't know its current status", next: 'dispute_evidence_match' },
      { label: 'Resolved in writing', next: 'dispute_resolved_match' },
    ],
    warning: null,
  },
  {
    id: 'dispute_status_mismatch',
    kind: 'question',
    title: 'What happened with the disagreement?',
    body: 'Note when it began, what each side says, and what has already been discussed. This sits alongside the plan/land difference you already flagged - it will be tracked as one boundary case with two concerns.',
    time: '5 minutes',
    cost: 'Free',
    options: [
      { label: 'Still ongoing', next: 'dispute_evidence_mismatch' },
      { label: 'Discussed but not settled in writing', next: 'dispute_evidence_mismatch' },
      { label: "I don't know its current status", next: 'dispute_evidence_mismatch' },
      { label: 'Resolved in writing', next: 'dispute_resolved_mismatch' },
    ],
    warning: null,
  },
  {
    id: 'dispute_status_unsure',
    kind: 'question',
    title: 'What happened with the disagreement?',
    body: 'Note when it began, what each side says, and what has already been discussed.',
    time: '5 minutes',
    cost: 'Free',
    options: [
      { label: 'Still ongoing', next: 'dispute_evidence_match' },
      { label: 'Discussed but not settled in writing', next: 'dispute_evidence_match' },
      { label: "I don't know its current status", next: 'dispute_evidence_match' },
      { label: 'Resolved in writing', next: 'dispute_resolved_match' },
    ],
    warning: null,
  },
  {
    id: 'dispute_evidence_match',
    kind: 'upload',
    title: 'Record the dispute',
    body: "Write down what each person says the boundary is, when the disagreement began, and what has already been discussed. Keep letters, messages, any survey and photographs. Only give the neighbour's details if you choose to - it's optional and used only for a professional's review, not to contact them automatically.",
    time: '30 minutes',
    cost: 'Free',
    options: [{ label: 'Evidence added', next: 'ESCALATE', requiresUpload: true }],
    warning: "Don't move a fence or raise it with the neighbour to fix it before taking advice.",
  },
  {
    id: 'dispute_evidence_mismatch',
    kind: 'upload',
    title: 'Record the dispute',
    body: "Write down what each person says the boundary is, when the disagreement began, and what has already been discussed. Keep letters, messages, any survey and photographs, plus the title plan/older deeds for the plan-mismatch concern already flagged - this is tracked as one boundary case.",
    time: '30 minutes',
    cost: 'Free',
    options: [{ label: 'Evidence added', next: 'ESCALATE', requiresUpload: true }],
    warning: "Don't move a fence or raise it with the neighbour to fix it before taking advice.",
  },
  {
    id: 'dispute_resolved_match',
    kind: 'upload',
    title: 'Keep the written resolution with your passport',
    body: 'Upload the agreement or correspondence and record when it was agreed. A buyer may still ask about a past dispute, so a conveyancer can check what the document settles and how it should be disclosed.',
    time: '10 minutes',
    cost: 'Free',
    options: [{ label: 'Agreement added', next: 'CHECK', requiresUpload: true }],
    warning: null,
  },
  {
    id: 'dispute_resolved_mismatch',
    kind: 'upload',
    title: 'Keep the written resolution with your passport',
    body: 'Upload the agreement or correspondence and record when it was agreed. The plan/land difference you flagged earlier is a separate, still-open concern - add the title plan, older deeds and dated photos for that alongside it.',
    time: '20 minutes',
    cost: 'Free',
    options: [{ label: 'Documents added', next: 'FLAG', requiresUpload: true }],
    warning: null,
  },
] as const;

// ─── Glazing steps (reconstructed from the old prototype's renderWindows())

const GLAZING_STEPS = [
  {
    id: 'when',
    kind: 'question',
    title: 'When was the work done?',
    body: 'An invoice or guarantee may show the date. You can update this answer later if you\u2019re not sure yet.',
    time: '1 minute',
    cost: 'Free',
    options: [
      { label: 'Before 1 April 2002', next: 'RESOLVED' },
      { label: 'On or after 1 April 2002', next: 'evidence' },
      { label: "I'm not sure of the date", next: 'CHECK' },
    ],
    warning: null,
  },
  {
    id: 'evidence',
    kind: 'question',
    title: 'Do you have evidence of Building Regulations compliance?',
    body: 'This means a FENSA (or other competent person scheme) certificate, or a building control approval.',
    time: '2 minutes',
    cost: 'Free',
    options: [
      { label: 'Yes, a scheme certificate', next: 'upload_evidence' },
      { label: 'Yes, building control evidence', next: 'upload_evidence' },
      { label: "I'm not sure", next: 'CHECK' },
      { label: 'I cannot find one', next: 'search_records' },
    ],
    warning: null,
  },
  {
    id: 'upload_evidence',
    kind: 'upload',
    title: 'Add your evidence',
    body: 'Upload the certificate or building control document so it\u2019s ready for a buyer enquiry.',
    time: '10 minutes',
    cost: 'Free',
    options: [{ label: 'Evidence added', next: 'RESOLVED', requiresUpload: true }],
    warning: null,
  },
  {
    id: 'search_records',
    kind: 'action',
    title: "Let's look for the record",
    body: 'Missing paperwork is not proof the windows fail Building Regulations. Start with the installer and the certificate schemes, then check local building control: find the invoice, guarantee and installer name; search FENSA by address (forms.fensa.org.uk/fensa-certificate) and ask for a replacement if registered; check another competent person scheme such as Certass if relevant; ask local building control whether approval was recorded.',
    time: '1-2 weeks to search',
    cost: 'Free',
    options: [
      { label: 'Found a record', next: 'upload_evidence' },
      { label: 'Checked these sources, found no record', next: 'no_record_found' },
    ],
    warning: null,
  },
  {
    id: 'no_record_found',
    kind: 'info',
    title: 'If no record turns up',
    body: 'Keep the invoice, search results and the dates in your passport. A reviewer can check whether a record was actually required and discuss the available routes - one possible route is a local authority building control regularisation assessment (gov.uk/building-regulations-approval/how-to-apply), which can involve inspection or remedial work. It is not retrospective planning permission. A council can take up to 8 weeks to issue a certificate after a satisfactory inspection.',
    time: 'Several weeks or longer if regularisation is needed',
    cost: 'Varies - a regularisation application has a fee',
    options: [{ label: 'Noted, keep this open', next: 'FLAG' }],
    warning: null,
  },
] as const;

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
