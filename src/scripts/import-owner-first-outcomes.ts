// Imports UMU_Owner_First_Question_Outcomes_DRAFT.xlsx (client handoff,
// 2026-09-28) as the new flat per-answer guidance layer, replacing the
// 1,842-row set import-passport-content.ts pulled from the review tool's
// embedded JSON. Both files cover the identical 614-source-node universe
// (same sourceParagraph numbering throughout - verified against
// QuestionSourceMapping before writing this), but this one is organised
// around three owner-facing outcome buckets per question (ordinary /
// needs attention / unsure) with richer "what to do now" / evidence / time
// fields, rather than one row per literal exported answer string.
//
// The source file's own "Live question ID" column is the placeholder
// TO_MAP for every one of its 279 rows - the client never did this
// mapping. This script does it two ways:
//   1. Reuses QuestionSourceMapping.liveQuestionTemplateId, which by this
//      point already covers 295/614 source paragraphs (see
//      improve-question-source-matching.ts).
//   2. For a matched question, classifies its LIVE answer options
//      (Yes/No, or a RADIO/CHECKBOX part's options for a MULTIPART
//      question) into the three buckets using UK residential-conveyancing
//      judgment (TA6/TA10/BASPI-style disclosure conventions) - see
//      classifyOption() below. "Not sure"/"don't know" style options
//      always go to the unsure bucket. A question with no discrete
//      options (free text, date, upload, address, etc.) still gets one
//      general-purpose guidance row.
//
// Every row lands as status "draft" with a note on how its bucket
// classification was produced, so a conveyancer reviewing this content
// later can see exactly which calls were rule-based vs certain.
//
// Run manually: npx ts-node -r tsconfig-paths/register src/scripts/import-owner-first-outcomes.ts
import { PrismaClient, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { join } from 'path';

const prisma = new PrismaClient();

const WORKBOOK_PATH = join(__dirname, '..', '..', 'prisma', 'content', 'source', 'UMU_Owner_First_Question_Outcomes_DRAFT.xlsx');
const SOURCE_FILE_VERSION = 'UMU_Owner_First_Question_Outcomes_DRAFT.xlsx (client handoff, 2026-09-28) - bucket-to-answer classification by rule-based UK conveyancing heuristic, imported 2026-09-30';
const DEFAULT_ANSWER_VALUE = '__default__';

function cell(row: unknown[], i: number): string | null {
  const v = row[i];
  return v === undefined || v === null || v === '' ? null : String(v).trim();
}

interface OutcomeRow {
  sourceParagraph: number;
  section: string;
  question: string;
  ruleFamily: string | null;
  ifOrdinary: string;
  ifAttention: string;
  ifUnsure: string;
  whatOwnerCanDo: string | null;
  evidenceToGather: string | null;
  timeIfUnresolved: string | null;
}

function loadOutcomeRows(): OutcomeRow[] {
  const wb = XLSX.readFile(WORKBOOK_PATH);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Question outcomes'], { header: 1, blankrows: false });
  return rows
    .slice(1)
    .map((r) => ({
      sourceParagraph: Number(r[0]),
      section: String(r[1] ?? ''),
      question: String(r[3] ?? ''),
      ruleFamily: cell(r, 5),
      ifOrdinary: cell(r, 6) ?? '',
      ifAttention: cell(r, 7) ?? '',
      ifUnsure: cell(r, 8) ?? '',
      whatOwnerCanDo: cell(r, 9),
      evidenceToGather: cell(r, 10),
      timeIfUnresolved: cell(r, 12),
    }))
    .filter((r) => Number.isFinite(r.sourceParagraph));
}

interface ChildPromptRow {
  sourceParagraph: number;
  parentParagraph: number;
  section: string;
  childPrompt: string;
}

// The "Child prompts" tab documents each conditional sub-question (e.g.
// "Are you completing this form on behalf of the seller? [shown only if...
// no]") but carries no bucket text of its own - only the parent's rule
// family. Guidance for a child paragraph therefore reuses its PARENT's
// ordinary/attention/unsure copy (looked up by parentParagraph against the
// "Question outcomes" rows), while classification still runs against the
// CHILD's own prompt text, since a child's Yes/No can mean something
// different from its parent's.
function loadChildPromptRows(): ChildPromptRow[] {
  const wb = XLSX.readFile(WORKBOOK_PATH);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Child prompts'], { header: 1, blankrows: false });
  return rows
    .slice(1)
    .map((r) => ({
      sourceParagraph: Number(r[0]),
      parentParagraph: Number(r[1]),
      section: String(r[2] ?? ''),
      // Strip a trailing "[shown only if ...]" display-condition note - that's
      // about when the field appears, not part of the question text itself.
      childPrompt: String(r[4] ?? '').replace(/\s*\[shown only if.*?\]\s*$/i, '').trim(),
    }))
    .filter((r) => Number.isFinite(r.sourceParagraph) && Number.isFinite(r.parentParagraph));
}

// ─── Bucket classification (UK residential conveyancing judgment) ─────────
// A disclosure-style question ("has X ever happened", "is there a dispute
// about Y") is a problem when the answer is Yes. A requirement-style
// question ("is X in good order", "is X compliant/up to date") is a
// problem when the answer is No. Neither pattern found -> genuinely
// ambiguous, both Yes/No treated as ordinary (safer than wrongly flagging
// a neutral fact as an issue) and reported separately for manual review.
// UK residential disclosure forms (TA6/TA7/TA10, BASPI) overwhelmingly ask
// "has X happened / is the seller aware of X / has X been received" -
// questions phrased that way are near-universally disclosure-style: Yes
// means there is something to tell a buyer about, No is the clean answer.
// This pattern match (aware of / has ... been / have ... been received or
// sent, etc.) catches that whole family regardless of the specific noun,
// which the original noun-keyword-only list kept missing on plurals and
// unlisted phrasing.
const DISCLOSURE_PHRASING =
  /is the seller aware of|are you aware of|aware of any(thing)?|has (any|there been any)|have (any|there been any)|received or sent|been received\b|been sent\b|been (made|raised|brought|issued)\b|taken place\b|been granted\b|been served\b|led to\b|might lead to\b|could (lead|result) in\b/i;

const NEGATIVE_TRIGGER =
  /disputes?|complaints?|breach(es)?|in default|arrears|notices?\b|proceedings?|litigation|claims?|defects?|damages?\b|floods?(ed)?|subsiden|contaminat|knotweed|infestation|asbestos|unauthoris|unauthoriz|\billegal\b|without (planning|building) (permission|consent|regulations)|enforcement|contraven|restrictions?\b|encroach|overhang|project(s|ing)? under\b|adverse possession|boundary (dispute|feature.*moved)|\bmoved\b.*boundary|\bleaks?\b|\bdamp\b|\brot\b|structural (movement|issue|problem|defect)|insolven|bankrupt|struck off|dissolved|forfeit|terminat|repossess|court order|injunction|statutory notice|missing\b|expired\b|lapsed\b|overdue\b|unresolved|outstanding\b|unpaid\b|unfinished|incomplete works|party wall.*(dispute|object)|negotiations? or discussions?|correspondence|proposals? to (develop|alter)|planning or building control issues?|rejected|refused|declined|not (?:been )?complied|non[- ]compliance|\bwithdrawn\b/i;

const POSITIVE_REQUIREMENT =
  /good working order|good condition|\bcompliant\b|complied with|compliance (with|has)|up[ -]to[ -]date|currently valid|\badequate\b|\bsufficient\b|properly (installed|maintained)|correctly registered|\bcovers?\b|\bin place\b|been serviced|been tested|been inspected|valid certificate|protected (in|under)|registered with|been (accepted|approved|granted)\b|terms.*(complied|been met)/i;

const UNSURE_LABEL = /not sure|unsure|don'?t know|do not know|unknown|not certain/i;

type Bucket = 'ordinary' | 'attention' | 'unsure';

function classifyOption(
  label: string,
  questionText: string,
): { bucket: Bucket; confident: boolean } {
  if (UNSURE_LABEL.test(label)) return { bucket: 'unsure', confident: true };

  const isYes = /^yes\b/i.test(label);
  const isNo = /^no\b/i.test(label);
  if (!isYes && !isNo) return { bucket: 'ordinary', confident: false }; // not a binary option - can't apply this heuristic

  const negative = NEGATIVE_TRIGGER.test(questionText) || DISCLOSURE_PHRASING.test(questionText);
  const positive = POSITIVE_REQUIREMENT.test(questionText);

  if (negative && !positive) return { bucket: isYes ? 'attention' : 'ordinary', confident: true };
  if (positive && !negative) return { bucket: isYes ? 'ordinary' : 'attention', confident: true };
  return { bucket: 'ordinary', confident: false }; // ambiguous or both patterns matched
}

function bucketText(texts: { ordinary: string; attention: string; unsure: string }, bucket: Bucket): string {
  return bucket === 'ordinary' ? texts.ordinary : bucket === 'attention' ? texts.attention : texts.unsure;
}

function normaliseText(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/^\d+\.\s*/, '').replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Find the decision control for THIS specific question on a live template:
// its own options for a plain RADIO/CHECKBOX question, or - for MULTIPART -
// the one part whose own title matches this question's text. Several
// unrelated source paragraphs can share one big combined MULTIPART template
// (e.g. one "Lease extension application" form covers status, ground rent,
// rent-increase terms and calculation as five separate parts) - grabbing
// "the first RADIO/CHECKBOX part" regardless of which paragraph was asking
// produced nonsense (a "How is the rent increase calculated?" question
// paired with a sibling part's "Accepted by landlord" options). Only fall
// back to "the one RADIO/CHECKBOX part" when the template has exactly one -
// with several and no title match, there's no safe way to tell which part
// this paragraph means, so return no options rather than guess.
function getLiveOptions(
  template: { type: string; options: unknown; parts: unknown },
  questionText: string,
): Array<{ label: string; value: string }> {
  if ((template.type === 'RADIO' || template.type === 'CHECKBOX') && Array.isArray(template.options)) {
    return template.options as any[];
  }
  if (template.type === 'MULTIPART' && Array.isArray(template.parts)) {
    const decisionParts = (template.parts as any[]).filter((p) => p?.type === 'RADIO' || p?.type === 'CHECKBOX');
    const titleMatch = decisionParts.find((p) => normaliseText(p.title) === normaliseText(questionText));
    if (titleMatch?.options) return titleMatch.options;
    if (decisionParts.length === 1 && decisionParts[0]?.options) return decisionParts[0].options;
  }
  return [];
}

interface Stats {
  matched: number;
  unmatched: number;
  rowsWritten: number;
  confident: number;
  defaulted: number;
  needsReview: string[];
}

async function writeGuidanceForNode(
  liveQuestionTemplateId: string | null | undefined,
  sourceParagraph: number,
  parentSourceParagraph: number | null,
  nodeType: 'main' | 'child',
  section: string,
  questionText: string,
  bucketTexts: { ordinary: string; attention: string; unsure: string },
  whatOwnerCanDo: string | null,
  evidenceToGather: string | null,
  timeIfUnresolved: string | null,
  ruleFamily: string | null,
  stats: Stats,
) {
  if (!liveQuestionTemplateId) {
    stats.unmatched++;
    return;
  }
  const template = await prisma.questionTemplate.findUnique({ where: { id: liveQuestionTemplateId } });
  if (!template) return;
  stats.matched++;

  const options = getLiveOptions(template, questionText);

  // Replace whatever the old 1842-row import wrote for this paragraph.
  await prisma.questionAnswerGuidance.deleteMany({ where: { sourceParagraph } });

  const toWrite: Prisma.QuestionAnswerGuidanceCreateManyInput[] = [];
  const seenValues = new Set<string>();

  for (const opt of options) {
    if (!opt?.value || seenValues.has(opt.value)) continue;
    seenValues.add(opt.value);
    const { bucket, confident } = classifyOption(opt.label ?? '', questionText);
    if (confident) stats.confident++;
    else {
      stats.defaulted++;
      stats.needsReview.push(`${sourceParagraph} | ${section} | ${questionText} | option "${opt.label}"`);
    }
    toWrite.push({
      sourceParagraph,
      parentSourceParagraph,
      nodeType,
      section,
      sourceQuestionText: questionText,
      answerValue: opt.value,
      answerValueProvenance: 'source',
      outcomeCode: bucket,
      ownerExplanation: bucketText(bucketTexts, bucket),
      ownerNextStep: whatOwnerCanDo,
      evidenceToAdd: evidenceToGather,
      timeIfUnresolved: bucket === 'ordinary' ? null : timeIfUnresolved,
      copyDepth: ruleFamily,
      status: 'draft',
      sourceFileVersion: SOURCE_FILE_VERSION,
    });
  }

  // Always add a catch-all row (ordinary-bucket text) so a question with no
  // discrete options - or an option value this pass didn't see - still
  // shows something, once getGuidanceForQuestion() falls back to it.
  toWrite.push({
    sourceParagraph,
    parentSourceParagraph,
    nodeType,
    section,
    sourceQuestionText: questionText,
    answerValue: DEFAULT_ANSWER_VALUE,
    answerValueProvenance: 'proposed_composite',
    outcomeCode: 'ordinary',
    ownerExplanation: bucketTexts.ordinary,
    ownerNextStep: whatOwnerCanDo,
    evidenceToAdd: evidenceToGather,
    timeIfUnresolved: null,
    copyDepth: ruleFamily,
    status: 'draft',
    sourceFileVersion: SOURCE_FILE_VERSION,
  });

  await prisma.questionAnswerGuidance.createMany({ data: toWrite, skipDuplicates: true });
  stats.rowsWritten += toWrite.length;
}

async function main() {
  const outcomeRows = loadOutcomeRows();
  const childRows = loadChildPromptRows();
  console.log(`Loaded ${outcomeRows.length} main question-outcome rows and ${childRows.length} child-prompt rows.`);

  const allParagraphs = [...outcomeRows.map((r) => r.sourceParagraph), ...childRows.map((r) => r.sourceParagraph)];
  const mappings = await prisma.questionSourceMapping.findMany({ where: { sourceParagraph: { in: allParagraphs } } });
  const mappingByParagraph = new Map(mappings.map((m) => [m.sourceParagraph, m]));
  const outcomeByParagraph = new Map(outcomeRows.map((r) => [r.sourceParagraph, r]));

  const mainStats: Stats = { matched: 0, unmatched: 0, rowsWritten: 0, confident: 0, defaulted: 0, needsReview: [] };
  const childStats: Stats = { matched: 0, unmatched: 0, rowsWritten: 0, confident: 0, defaulted: 0, needsReview: [] };

  // ── Phase 1: main questions (each has its own bucket text) ──────────────
  for (const row of outcomeRows) {
    await writeGuidanceForNode(
      mappingByParagraph.get(row.sourceParagraph)?.liveQuestionTemplateId,
      row.sourceParagraph,
      null,
      'main',
      row.section,
      row.question,
      { ordinary: row.ifOrdinary, attention: row.ifAttention, unsure: row.ifUnsure },
      row.whatOwnerCanDo,
      row.evidenceToGather,
      row.timeIfUnresolved,
      row.ruleFamily,
      mainStats,
    );
  }

  // ── Phase 2: child prompts (reuse their PARENT's bucket text - the file
  // gives no bucket text of its own for a child, only its parent's rule
  // family - but classify against the CHILD's own prompt wording, since a
  // child's Yes/No can carry different meaning from its parent's) ────────
  let childrenWithNoParentOutcome = 0;
  for (const row of childRows) {
    const parentOutcome = outcomeByParagraph.get(row.parentParagraph);
    if (!parentOutcome) {
      childrenWithNoParentOutcome++;
      continue;
    }
    await writeGuidanceForNode(
      mappingByParagraph.get(row.sourceParagraph)?.liveQuestionTemplateId,
      row.sourceParagraph,
      row.parentParagraph,
      'child',
      row.section,
      row.childPrompt,
      { ordinary: parentOutcome.ifOrdinary, attention: parentOutcome.ifAttention, unsure: parentOutcome.ifUnsure },
      parentOutcome.whatOwnerCanDo,
      parentOutcome.evidenceToGather,
      parentOutcome.timeIfUnresolved,
      parentOutcome.ruleFamily,
      childStats,
    );
  }

  console.log(`\n── Main questions ──`);
  console.log(`Matched (have a live template): ${mainStats.matched}`);
  console.log(`Unmatched (no live template yet - skipped): ${mainStats.unmatched}`);
  console.log(`Options classified with confidence: ${mainStats.confident} | defaulted: ${mainStats.defaulted}`);

  console.log(`\n── Child prompts ──`);
  console.log(`Matched (have a live template): ${childStats.matched}`);
  console.log(`Unmatched (no live template yet - skipped): ${childStats.unmatched}`);
  console.log(`Skipped - parent has no outcome row: ${childrenWithNoParentOutcome}`);
  console.log(`Options classified with confidence: ${childStats.confident} | defaulted: ${childStats.defaulted}`);

  console.log(`\nTotal QuestionAnswerGuidance rows written: ${mainStats.rowsWritten + childStats.rowsWritten}`);

  console.log(`\nSample main-question rows needing manual review (first 15 of ${mainStats.needsReview.length}):`);
  mainStats.needsReview.slice(0, 15).forEach((s) => console.log('  ' + s));
  console.log(`\nSample child-prompt rows needing manual review (first 15 of ${childStats.needsReview.length}):`);
  childStats.needsReview.slice(0, 15).forEach((s) => console.log('  ' + s));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
