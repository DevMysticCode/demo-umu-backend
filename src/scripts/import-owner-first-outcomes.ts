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

function bucketText(row: OutcomeRow, bucket: Bucket): string {
  return bucket === 'ordinary' ? row.ifOrdinary : bucket === 'attention' ? row.ifAttention : row.ifUnsure;
}

async function main() {
  const rows = loadOutcomeRows();
  console.log(`Loaded ${rows.length} question-outcome rows.`);

  const mappings = await prisma.questionSourceMapping.findMany({
    where: { sourceParagraph: { in: rows.map((r) => r.sourceParagraph) } },
  });
  const mappingByParagraph = new Map(mappings.map((m) => [m.sourceParagraph, m]));

  let matchedQuestions = 0;
  let unmatchedQuestions = 0;
  let rowsWritten = 0;
  let confidentOptions = 0;
  let defaultedOptions = 0;
  const needsReview: string[] = [];

  for (const row of rows) {
    const mapping = mappingByParagraph.get(row.sourceParagraph);
    if (!mapping?.liveQuestionTemplateId) {
      unmatchedQuestions++;
      continue;
    }
    matchedQuestions++;

    const template = await prisma.questionTemplate.findUnique({ where: { id: mapping.liveQuestionTemplateId } });
    if (!template) continue;

    // Find the primary decision control: the template's own options for a
    // plain RADIO/CHECKBOX question, or the first RADIO/CHECKBOX part of a
    // MULTIPART question - same "primary part" convention already used for
    // the boundary/glazing pathway triggers.
    let options: Array<{ label: string; value: string }> = [];
    if ((template.type === 'RADIO' || template.type === 'CHECKBOX') && Array.isArray(template.options)) {
      options = template.options as any[];
    } else if (template.type === 'MULTIPART' && Array.isArray(template.parts)) {
      const decisionPart = (template.parts as any[]).find(
        (p) => p?.type === 'RADIO' || p?.type === 'CHECKBOX',
      );
      if (decisionPart?.options) options = decisionPart.options;
    }

    // Replace whatever the old 1842-row import wrote for this paragraph.
    await prisma.questionAnswerGuidance.deleteMany({ where: { sourceParagraph: row.sourceParagraph } });

    const toWrite: Prisma.QuestionAnswerGuidanceCreateManyInput[] = [];
    const seenValues = new Set<string>();

    for (const opt of options) {
      if (!opt?.value || seenValues.has(opt.value)) continue;
      seenValues.add(opt.value);
      const { bucket, confident } = classifyOption(opt.label ?? '', row.question);
      if (confident) confidentOptions++;
      else {
        defaultedOptions++;
        needsReview.push(`${row.sourceParagraph} | ${row.section} | ${row.question} | option "${opt.label}"`);
      }
      toWrite.push({
        sourceParagraph: row.sourceParagraph,
        nodeType: 'main',
        section: row.section,
        sourceQuestionText: row.question,
        answerValue: opt.value,
        answerValueProvenance: 'source',
        outcomeCode: bucket,
        ownerExplanation: bucketText(row, bucket),
        ownerNextStep: row.whatOwnerCanDo,
        evidenceToAdd: row.evidenceToGather,
        timeIfUnresolved: bucket === 'ordinary' ? null : row.timeIfUnresolved,
        copyDepth: row.ruleFamily,
        status: 'draft',
        sourceFileVersion: SOURCE_FILE_VERSION,
      });
    }

    // Always add a catch-all row (ordinary-bucket text) so a question with
    // no discrete options - or an option value this pass didn't see - still
    // shows something, once getGuidanceForQuestion() falls back to it.
    toWrite.push({
      sourceParagraph: row.sourceParagraph,
      nodeType: 'main',
      section: row.section,
      sourceQuestionText: row.question,
      answerValue: DEFAULT_ANSWER_VALUE,
      answerValueProvenance: 'proposed_composite',
      outcomeCode: 'ordinary',
      ownerExplanation: row.ifOrdinary,
      ownerNextStep: row.whatOwnerCanDo,
      evidenceToAdd: row.evidenceToGather,
      timeIfUnresolved: null,
      copyDepth: row.ruleFamily,
      status: 'draft',
      sourceFileVersion: SOURCE_FILE_VERSION,
    });

    await prisma.questionAnswerGuidance.createMany({ data: toWrite, skipDuplicates: true });
    rowsWritten += toWrite.length;
  }

  console.log(`\nMatched questions (have a live template): ${matchedQuestions}`);
  console.log(`Unmatched questions (no live template yet - skipped): ${unmatchedQuestions}`);
  console.log(`QuestionAnswerGuidance rows written: ${rowsWritten}`);
  console.log(`Options classified with confidence: ${confidentOptions}`);
  console.log(`Options defaulted to "ordinary" (needs manual review): ${defaultedOptions}`);
  console.log(`\nSample needing manual review (first 25 of ${needsReview.length}):`);
  needsReview.slice(0, 25).forEach((s) => console.log('  ' + s));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
