// Imports the client's resolution-pathways / answer-guidance content
// (handoff, 2026-09-29) into the DB content store. Re-run this any time the
// client sends an updated source file — it's the entire review/update loop
// (client decision, 2026-09-30: no in-app content-admin UI; the source file
// IS the source of truth, re-import is how a revision reaches the app).
//
// Sources (prisma/content/source/ — copied in from the client's files):
//   UMU_Question_Bank_BASPI_Mapping.xlsx  — 38 pathways, 117 steps, 267
//     question-to-pathway links, and the 278-question BASPI/TA/PDTF mapping.
//   UMU_All_Question_Answer_Paths_Review.html — 614 questions/child-prompts,
//     1842 per-answer guidance branches, embedded as JSON in a <script
//     type="application/json" id="data"> tag.
//
// NOT sourced from umu_resolution_pathways.json / the developer-handoff PDF:
// several long text fields (issue/why_it_matters/check_first) were cut off
// mid-string by the PDF's page-width text extraction — genuinely corrupted,
// not just visually wrapped. The xlsx's "Resolution pathways"/"Pathway
// steps" tabs carry the same content cleanly and completely, so those are
// used instead. One real gap from that substitution: the xlsx has no
// separate structured "handover" (name/what/time/notes per option) column —
// it's folded into the free-text "stop_point" column instead. `handover` is
// therefore left empty here; if the client can supply the raw .json file
// (not a PDF) it can be backfilled without touching anything else.
//
// Every row lands with status "draft" — none of the client's 1842 answer
// branches were marked deployment-ready by their own review tool. The
// frontend shows draft content with a "Draft guidance" label rather than
// hiding it (client decision, 2026-09-30).
//
// Run manually: npx ts-node -T src/scripts/import-passport-content.ts
import { PrismaClient, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

const CONTENT_DIR = join(__dirname, '..', '..', 'prisma', 'content', 'source');
const WORKBOOK_PATH = join(CONTENT_DIR, 'UMU_Question_Bank_BASPI_Mapping.xlsx');
const GUIDANCE_HTML_PATH = join(CONTENT_DIR, 'UMU_All_Question_Answer_Paths_Review.html');

const OUTCOME_KEY_BY_LABEL: Record<string, string> = {
  Resolved: 'RESOLVED',
  'Check before you sell': 'CHECK',
  'For a conveyancer': 'FLAG',
  'Needs a conveyancer': 'ESCALATE',
};

function normaliseText(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/^\s*\d+\.\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[?.:]+$/, '');
}

function normaliseSection(s: string | null | undefined): string {
  return (s ?? '').replace(/^\s*\d+\.\s*/, '').trim().toLowerCase();
}

// ─── Guidance HTML ──────────────────────────────────────────────────────────

interface GuidanceBranch {
  answer_value: string;
  answer_value_provenance?: string;
  outcome_code?: string;
  owner_explanation: string;
  owner_next_step?: string;
  evidence_to_add?: string | null;
  time_if_unresolved?: string | null;
  // Usually references a real child node by source_paragraph. Two nodes
  // (the boundary/glazing "worked flow" examples) instead reference
  // synthetic_id placeholders with no real node behind them yet — stored
  // as-is rather than dropped, so that distinction stays visible.
  next_prompts?: Array<{ source_paragraph?: number; synthetic_id?: string; [key: string]: unknown }>;
  copy_depth?: string;
  block_reason?: string;
}

interface GuidanceNode {
  node_id: string;
  source_paragraph: number;
  parent_node_id: string | null;
  node_type: 'main' | 'child';
  section: string;
  source_question: string;
  branches: GuidanceBranch[];
}

interface GuidanceData {
  version: string;
  nodes: GuidanceNode[];
}

function loadGuidanceData(): GuidanceData {
  const html = readFileSync(GUIDANCE_HTML_PATH, 'utf-8');
  const marker = '<script type="application/json" id="data">';
  const start = html.indexOf(marker) + marker.length;
  const end = html.indexOf('</script>', start);
  if (start < marker.length || end === -1) {
    throw new Error(`Could not find embedded #data JSON in ${GUIDANCE_HTML_PATH}`);
  }
  return JSON.parse(html.slice(start, end));
}

// ─── Workbook ───────────────────────────────────────────────────────────────

interface MappingRow {
  questionId: number;
  section: string;
  question: string;
  pdtfPath: string | null;
  baspi5: string | null;
  ta6: string | null;
  ta7: string | null;
  ta10: string | null;
}

interface BranchLogicRow {
  questionId: number;
  sectionQNo: string;
  pathwayRef: string | null;
  section: string;
  question: string;
  cleanAnswer: string;
  triggerAnswer: string;
}

interface PathwayStepRow {
  pathwayId: string;
  pathwayName: string | null;
  timeNow: string | null;
  timeAtSale: string | null;
  stepId: string;
  kind: string;
  title: string;
  body: string;
  time: string | null;
  cost: string | null;
  warning: string | null;
  options: Array<{ label: string; goesTo: string }>;
}

interface ResolutionPathwaySummaryRow {
  id: string;
  name: string;
  questionsText: string;
  issue: string;
  whyItMatters: string;
  nowOrAtSale: string;
  checkFirst: string;
  stepsProse: string;
  stopPoint: string;
  passportShows: string;
  toValidate: string;
}

function cell(row: unknown[], i: number): string | null {
  const v = row[i];
  return v === undefined || v === null || v === '' ? null : String(v);
}

function loadWorkbook() {
  const wb = XLSX.readFile(WORKBOOK_PATH);
  const sheetRows = (name: string) =>
    XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: false });

  const mapping: MappingRow[] = sheetRows('Mapping')
    .slice(1)
    .map((r) => ({
      questionId: Number(r[0]),
      section: String(r[1] ?? ''),
      question: String(r[3] ?? ''),
      pdtfPath: cell(r, 5),
      baspi5: cell(r, 6),
      ta6: cell(r, 7),
      ta7: cell(r, 8),
      ta10: cell(r, 9),
    }))
    .filter((r) => Number.isFinite(r.questionId));

  const branchLogic: BranchLogicRow[] = sheetRows('Branch logic')
    .slice(1)
    .map((r) => ({
      questionId: Number(r[0]),
      sectionQNo: String(r[1] ?? ''),
      pathwayRef: cell(r, 2),
      section: String(r[3] ?? ''),
      question: String(r[4] ?? ''),
      cleanAnswer: String(r[5] ?? ''),
      triggerAnswer: String(r[6] ?? ''),
    }))
    .filter((r) => Number.isFinite(r.questionId) && r.pathwayRef);

  const pathwaySteps: PathwayStepRow[] = [];
  let lastPathwayId = '';
  for (const r of sheetRows('Pathway steps').slice(1)) {
    const pathwayId = cell(r, 0) ?? lastPathwayId;
    lastPathwayId = pathwayId;
    const options: Array<{ label: string; goesTo: string }> = [];
    for (const [labelIdx, goesToIdx] of [
      [11, 12],
      [13, 14],
      [15, 16],
      [17, 18],
    ]) {
      const label = cell(r, labelIdx);
      const goesTo = cell(r, goesToIdx);
      if (label && goesTo) options.push({ label, goesTo });
    }
    pathwaySteps.push({
      pathwayId,
      pathwayName: cell(r, 1),
      timeNow: cell(r, 2),
      timeAtSale: cell(r, 3),
      stepId: String(r[4]),
      kind: String(r[5]),
      title: String(r[6]),
      body: String(r[7] ?? ''),
      time: cell(r, 8),
      cost: cell(r, 9),
      warning: cell(r, 10),
      options,
    });
  }

  const resolutionPathways: ResolutionPathwaySummaryRow[] = sheetRows('Resolution pathways')
    .slice(1)
    .map((r) => ({
      id: String(r[0]),
      name: String(r[1]),
      questionsText: String(r[2] ?? ''),
      issue: String(r[3] ?? ''),
      whyItMatters: String(r[4] ?? ''),
      nowOrAtSale: String(r[5] ?? ''),
      checkFirst: String(r[6] ?? ''),
      stepsProse: String(r[7] ?? ''),
      stopPoint: String(r[8] ?? ''),
      passportShows: String(r[9] ?? ''),
      toValidate: String(r[10] ?? ''),
    }));

  return { mapping, branchLogic, pathwaySteps, resolutionPathways };
}

function parseOption(o: { label: string; goesTo: string }) {
  const requiresUpload = /\(upload\)\s*$/i.test(o.label);
  const label = o.label.replace(/\s*\(upload\)\s*$/i, '').trim();
  const next = OUTCOME_KEY_BY_LABEL[o.goesTo] ?? o.goesTo;
  return { label, next, requiresUpload };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const guidance = loadGuidanceData();
  const { mapping, branchLogic, pathwaySteps, resolutionPathways } = loadWorkbook();

  console.log(`Loaded ${guidance.nodes.length} guidance nodes (version ${guidance.version}).`);
  console.log(`Loaded ${mapping.length} mapping rows, ${branchLogic.length} branch-logic rows, ${pathwaySteps.length} step rows, ${resolutionPathways.length} pathway summaries.`);

  // Bridge: Mapping-tab question_id (1-278) <-> guidance HTML source_paragraph,
  // joined by (section, normalised question text) — validated 278/278 match
  // during scoping.
  const mainNodesByKey = new Map<string, GuidanceNode>();
  for (const n of guidance.nodes) {
    if (n.node_type !== 'main') continue;
    mainNodesByKey.set(`${normaliseSection(n.section)}|${normaliseText(n.source_question)}`, n);
  }
  const paragraphByQuestionId = new Map<number, number>();
  for (const m of mapping) {
    const node = mainNodesByKey.get(`${normaliseSection(m.section)}|${normaliseText(m.question)}`);
    if (node) paragraphByQuestionId.set(m.questionId, node.source_paragraph);
  }
  console.log(`Bridged ${paragraphByQuestionId.size}/${mapping.length} question_id -> source_paragraph.`);

  // ── 1. QuestionSourceMapping (all 614 nodes) + best-effort live-template match
  const liveTemplates = await prisma.questionTemplate.findMany({
    select: { id: true, title: true },
  });
  const titleIndex = new Map<string, string[]>();
  for (const t of liveTemplates) {
    const key = normaliseText(t.title);
    if (!key) continue;
    const list = titleIndex.get(key) ?? [];
    list.push(t.id);
    titleIndex.set(key, list);
  }
  const mappingByQuestionId = new Map(mapping.map((m) => [m.questionId, m]));

  let autoMatched = 0;
  let ambiguous = 0;
  for (const node of guidance.nodes) {
    const mainQid = [...paragraphByQuestionId.entries()].find(([, p]) => p === node.source_paragraph)?.[0];
    const m = mainQid ? mappingByQuestionId.get(mainQid) : undefined;

    const candidates = titleIndex.get(normaliseText(node.source_question)) ?? [];
    let liveQuestionTemplateId: string | null = null;
    let matchConfidence: string | null = null;
    let matchNotes: string | null = null;
    if (candidates.length === 1) {
      liveQuestionTemplateId = candidates[0];
      matchConfidence = 'exact_title_unique';
      autoMatched++;
    } else if (candidates.length > 1) {
      matchNotes = `Ambiguous exact-title match, candidates: ${candidates.join(', ')}`;
      ambiguous++;
    }

    await prisma.questionSourceMapping.upsert({
      where: { sourceParagraph: node.source_paragraph },
      create: {
        sourceParagraph: node.source_paragraph,
        sourceQuestionId: mainQid ?? null,
        section: node.section,
        sourceQuestionText: node.source_question,
        pdtfPath: m?.pdtfPath ?? null,
        baspi5Ref: m?.baspi5 ?? null,
        ta6Ref: m?.ta6 ?? null,
        ta7Ref: m?.ta7 ?? null,
        ta10Ref: m?.ta10 ?? null,
        liveQuestionTemplateId,
        matchConfidence,
        matchNotes,
      },
      update: {
        sourceQuestionId: mainQid ?? null,
        section: node.section,
        sourceQuestionText: node.source_question,
        pdtfPath: m?.pdtfPath ?? null,
        baspi5Ref: m?.baspi5 ?? null,
        ta6Ref: m?.ta6 ?? null,
        ta7Ref: m?.ta7 ?? null,
        ta10Ref: m?.ta10 ?? null,
        // Never overwrite a manually confirmed mapping with a re-run of the
        // automatic guess.
        ...(matchConfidence === 'manual'
          ? {}
          : { liveQuestionTemplateId, matchConfidence, matchNotes }),
      },
    });
  }
  console.log(`QuestionSourceMapping: ${guidance.nodes.length} rows upserted (${autoMatched} auto-matched, ${ambiguous} ambiguous, ${guidance.nodes.length - autoMatched - ambiguous} unmapped).`);

  // ── 2. QuestionAnswerGuidance (1842 branches)
  let guidanceCount = 0;
  for (const node of guidance.nodes) {
    for (const branch of node.branches) {
      const nextPrompts = (branch.next_prompts ?? []) as unknown as Prisma.InputJsonValue;
      await prisma.questionAnswerGuidance.upsert({
        where: { sourceParagraph_answerValue: { sourceParagraph: node.source_paragraph, answerValue: branch.answer_value } },
        create: {
          sourceParagraph: node.source_paragraph,
          parentSourceParagraph: node.parent_node_id
            ? guidance.nodes.find((n) => n.node_id === node.parent_node_id)?.source_paragraph ?? null
            : null,
          nodeType: node.node_type,
          section: node.section,
          sourceQuestionText: node.source_question,
          answerValue: branch.answer_value,
          answerValueProvenance: branch.answer_value_provenance ?? null,
          outcomeCode: branch.outcome_code ?? null,
          ownerExplanation: branch.owner_explanation,
          ownerNextStep: branch.owner_next_step ?? null,
          evidenceToAdd: branch.evidence_to_add ?? null,
          timeIfUnresolved: branch.time_if_unresolved ?? null,
          nextPromptParagraphs: nextPrompts,
          copyDepth: branch.copy_depth ?? null,
          status: 'draft',
          blockReason: branch.block_reason ?? null,
          sourceFileVersion: guidance.version,
        },
        update: {
          outcomeCode: branch.outcome_code ?? null,
          ownerExplanation: branch.owner_explanation,
          ownerNextStep: branch.owner_next_step ?? null,
          evidenceToAdd: branch.evidence_to_add ?? null,
          timeIfUnresolved: branch.time_if_unresolved ?? null,
          nextPromptParagraphs: nextPrompts,
          copyDepth: branch.copy_depth ?? null,
          blockReason: branch.block_reason ?? null,
          sourceFileVersion: guidance.version,
          contentVersion: { increment: 1 },
        },
      });
      guidanceCount++;
    }
  }
  console.log(`QuestionAnswerGuidance: ${guidanceCount} branches upserted.`);

  // ── 3. ResolutionPathway (38) + PathwayQuestionLink (267)
  const stepsByPathway = new Map<string, PathwayStepRow[]>();
  for (const s of pathwaySteps) {
    const list = stepsByPathway.get(s.pathwayId) ?? [];
    list.push(s);
    stepsByPathway.set(s.pathwayId, list);
  }

  const workbookVersion = 'UMU_Question_Bank_BASPI_Mapping.xlsx (client handoff 2026-09-29)';
  for (const summary of resolutionPathways) {
    const steps = stepsByPathway.get(summary.id) ?? [];
    if (!steps.length) {
      console.warn(`No steps found for pathway ${summary.id} - skipping.`);
      continue;
    }
    const stepsJson = steps.map((s) => ({
      id: s.stepId,
      kind: s.kind,
      title: s.title,
      body: s.body,
      time: s.time,
      cost: s.cost,
      warning: s.warning,
      options: s.options.map(parseOption),
    }));
    const first = steps[0];

    await prisma.resolutionPathway.upsert({
      where: { id: summary.id },
      create: {
        id: summary.id,
        name: summary.name,
        issue: summary.issue,
        whyItMatters: summary.whyItMatters,
        timeNow: first.timeNow ?? summary.nowOrAtSale,
        timeAtSale: first.timeAtSale ?? summary.nowOrAtSale,
        checkFirst: summary.checkFirst,
        startStep: first.stepId,
        steps: stepsJson,
        handover: undefined, // see file header — not cleanly available from this source
        stopPoint: summary.stopPoint,
        toValidate: summary.toValidate,
        status: 'draft',
        sourceFileVersion: workbookVersion,
      },
      update: {
        name: summary.name,
        issue: summary.issue,
        whyItMatters: summary.whyItMatters,
        timeNow: first.timeNow ?? summary.nowOrAtSale,
        timeAtSale: first.timeAtSale ?? summary.nowOrAtSale,
        checkFirst: summary.checkFirst,
        startStep: first.stepId,
        steps: stepsJson,
        stopPoint: summary.stopPoint,
        toValidate: summary.toValidate,
        sourceFileVersion: workbookVersion,
        contentVersion: { increment: 1 },
      },
    });
  }
  console.log(`ResolutionPathway: ${resolutionPathways.length} pathways upserted.`);

  await prisma.pathwayQuestionLink.deleteMany({
    where: { pathwayId: { in: resolutionPathways.map((p) => p.id) } },
  });
  let linkCount = 0;
  for (const row of branchLogic) {
    const pathwayId = row.pathwayRef?.match(/^P\d+/)?.[0];
    if (!pathwayId) continue;
    const m = mappingByQuestionId.get(row.questionId);
    await prisma.pathwayQuestionLink.create({
      data: {
        pathwayId,
        sourceParagraph: paragraphByQuestionId.get(row.questionId) ?? null,
        sourceQuestionId: row.questionId,
        section: row.section,
        sourceQuestionText: row.question,
        cleanAnswer: row.cleanAnswer,
        triggerAnswer: row.triggerAnswer,
        pdtfPath: m?.pdtfPath ?? null,
        baspi5Ref: m?.baspi5 ?? null,
        ta6Ref: m?.ta6 ?? null,
        ta7Ref: m?.ta7 ?? null,
        ta10Ref: m?.ta10 ?? null,
      },
    });
    linkCount++;
  }
  console.log(`PathwayQuestionLink: ${linkCount} links created.`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
