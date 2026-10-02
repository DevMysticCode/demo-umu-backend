// Imports the client's UMU_278 content pack (developer handoff, 2 Oct
// 2026) into QuestionSourceMapping / QuestionAnswerGuidance - the same two
// tables import-passport-content.ts already populates from the earlier
// (29 Sep 2026) handoff, see schema.prisma's comment above those models for
// why this is "the whole review loop": re-run this any time the client
// sends a revised UMU_278_Complete_Question_Content.json.
//
// This pack supersedes the earlier one's COPY for the 278 main questions
// and their 336 child/conditional prompts - richer per-answer panels
// (meaning/why_now/owner_actions/possible_outcomes/evidence/time/
// completion/source_ids, plus professional_help/transaction_context for
// the two special_flow questions), an explicit supported/gathering/
// unresolved/unsure "assessment" state per question (267 of 278), and each
// child's own recommended_condition (vs. the earlier pack's parent-driven
// nextPromptParagraphs). It does NOT touch ResolutionPathway/
// PathwayQuestionLink - P09/P39's bespoke step trees are handled by
// wire-boundary-glazing-pathways.ts, which already encodes this pack's
// boundaryCode()/glazingCode() logic as real step transitions; this script
// still imports the special_flow questions' own panels (for q133 "yes/no/
// unsure" etc.) since those are shown before/independent of the deep flow.
//
// Same bridging approach as the 29 Sep importer: match live QuestionTemplate
// by exact (normalised) title, never overwriting a manually-confirmed
// mapping (matchConfidence === 'manual') on re-run.
//
// Run manually: npx ts-node -r tsconfig-paths/register src/scripts/import-278-question-content.ts
import { PrismaClient, Prisma } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

const PACK_PATH = join(__dirname, '..', '..', 'prisma', 'content', 'source', 'UMU_278_Complete_Question_Content.json');

interface PanelLike {
  title?: string | null;
  style?: string | null;
  meaning?: string | null;
  why_now?: string | null;
  owner_actions?: string[];
  steps?: Array<{ text?: string } | string>;
  possible_outcomes?: Array<{ title?: string; explanation?: string; body?: string }>;
  evidence?: string[];
  evidence_label?: string | null;
  time?: { preparation?: string; resolution_or_transaction_impact?: string; basis?: string } | string | null;
  sourced_timing?: string | null;
  completion?: string | null;
  closure?: string | null;
  source_ids?: string[];
  sources?: string[];
  professional_help?: string | null;
  transaction_context?: string | null;
}

interface NormalisedPanel {
  title: string | null;
  style: string | null;
  meaning: string | null;
  why_now: string | null;
  owner_actions: string[];
  possible_outcomes: Array<{ title: string; explanation: string }>;
  evidence: string[];
  time: { preparation?: string; resolution_or_transaction_impact?: string; basis?: string } | string | null;
  completion: string | null;
  source_ids: string[];
  professional_help: string | null;
  transaction_context: string | null;
}

// Handles both panel shapes in the pack: the ordinary per-answer panel
// (owner_actions/evidence/completion/source_ids) and the special_flow
// boundary panel (steps/evidence_label/closure/sources) - see
// UMU_Boundary_Logic.js's normalizeBoundary() for the client's own
// reference version of this same mapping.
function normalisePanel(p: PanelLike | null | undefined): NormalisedPanel | null {
  if (!p) return null;
  return {
    title: p.title ?? null,
    style: p.style === 'attention' ? 'yellow' : (p.style ?? null),
    meaning: p.meaning ?? null,
    why_now: p.why_now ?? null,
    owner_actions: p.owner_actions ?? (p.steps ?? []).map((s) => (typeof s === 'string' ? s : s.text ?? '')).filter(Boolean),
    possible_outcomes: (p.possible_outcomes ?? []).map((o) => ({ title: o.title ?? '', explanation: o.explanation ?? o.body ?? '' })),
    evidence: p.evidence ?? (p.evidence_label ? [p.evidence_label] : []),
    time: p.time ?? (p.sourced_timing ? p.sourced_timing : null),
    completion: p.completion ?? p.closure ?? null,
    source_ids: p.source_ids ?? p.sources ?? [],
    professional_help: p.professional_help ?? null,
    transaction_context: p.transaction_context ?? null,
  };
}

function flatOwnerExplanation(panel: NormalisedPanel): string {
  return panel.meaning ?? panel.title ?? '';
}
function flatOwnerNextStep(panel: NormalisedPanel): string | null {
  return panel.owner_actions.length ? panel.owner_actions.join('; ') : null;
}
function flatEvidence(panel: NormalisedPanel): string | null {
  return panel.evidence.length ? panel.evidence.join('; ') : null;
}
function flatTime(panel: NormalisedPanel): string | null {
  if (!panel.time) return null;
  if (typeof panel.time === 'string') return panel.time;
  return panel.time.resolution_or_transaction_impact ?? panel.time.preparation ?? panel.time.basis ?? null;
}

function normaliseTitle(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/^\s*\d+\.\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[?.:]+$/, '');
}

async function upsertMapping(opts: {
  sourceParagraph: number;
  section: string;
  sourceQuestionText: string;
  titleIndex: Map<string, string[]>;
  recommendedCondition?: unknown;
}) {
  const existing = await prisma.questionSourceMapping.findUnique({ where: { sourceParagraph: opts.sourceParagraph } });
  let liveQuestionTemplateId = existing?.liveQuestionTemplateId ?? null;
  let matchConfidence = existing?.matchConfidence ?? null;
  let matchNotes = existing?.matchNotes ?? null;

  if (matchConfidence !== 'manual') {
    const candidates = opts.titleIndex.get(normaliseTitle(opts.sourceQuestionText)) ?? [];
    if (candidates.length === 1) {
      liveQuestionTemplateId = candidates[0];
      matchConfidence = 'exact_title_unique';
      matchNotes = null;
    } else if (candidates.length > 1) {
      matchNotes = `Ambiguous exact-title match, candidates: ${candidates.join(', ')}`;
    }
  }

  await prisma.questionSourceMapping.upsert({
    where: { sourceParagraph: opts.sourceParagraph },
    create: {
      sourceParagraph: opts.sourceParagraph,
      section: opts.section,
      sourceQuestionText: opts.sourceQuestionText,
      liveQuestionTemplateId,
      matchConfidence,
      matchNotes,
      recommendedCondition: (opts.recommendedCondition as Prisma.InputJsonValue) ?? Prisma.JsonNull,
    },
    update: {
      section: opts.section,
      sourceQuestionText: opts.sourceQuestionText,
      liveQuestionTemplateId,
      matchConfidence,
      matchNotes,
      recommendedCondition: (opts.recommendedCondition as Prisma.InputJsonValue) ?? Prisma.JsonNull,
    },
  });
}

async function upsertGuidance(opts: {
  sourceParagraph: number;
  parentSourceParagraph: number | null;
  nodeType: 'main' | 'child';
  section: string;
  sourceQuestionText: string;
  answerValue: string;
  panel: NormalisedPanel;
  sourceFileVersion: string;
  outcomeCode?: string | null;
}) {
  await prisma.questionAnswerGuidance.upsert({
    where: { sourceParagraph_answerValue: { sourceParagraph: opts.sourceParagraph, answerValue: opts.answerValue } },
    create: {
      sourceParagraph: opts.sourceParagraph,
      parentSourceParagraph: opts.parentSourceParagraph,
      nodeType: opts.nodeType,
      section: opts.section,
      sourceQuestionText: opts.sourceQuestionText,
      answerValue: opts.answerValue,
      outcomeCode: opts.outcomeCode ?? null,
      ownerExplanation: flatOwnerExplanation(opts.panel),
      ownerNextStep: flatOwnerNextStep(opts.panel),
      evidenceToAdd: flatEvidence(opts.panel),
      timeIfUnresolved: flatTime(opts.panel),
      panel: opts.panel as unknown as Prisma.InputJsonValue,
      status: 'draft',
      sourceFileVersion: opts.sourceFileVersion,
    },
    update: {
      parentSourceParagraph: opts.parentSourceParagraph,
      nodeType: opts.nodeType,
      section: opts.section,
      sourceQuestionText: opts.sourceQuestionText,
      outcomeCode: opts.outcomeCode ?? null,
      ownerExplanation: flatOwnerExplanation(opts.panel),
      ownerNextStep: flatOwnerNextStep(opts.panel),
      evidenceToAdd: flatEvidence(opts.panel),
      timeIfUnresolved: flatTime(opts.panel),
      panel: opts.panel as unknown as Prisma.InputJsonValue,
      sourceFileVersion: opts.sourceFileVersion,
      contentVersion: { increment: 1 },
    },
  });
}

async function main() {
  const pack = JSON.parse(readFileSync(PACK_PATH, 'utf-8')) as {
    schema_version: string;
    authored_on?: string;
    questions: any[];
  };
  const sourceFileVersion = `UMU_278_Complete_Question_Content.json (${pack.schema_version}, authored ${pack.authored_on ?? 'unknown'})`;
  console.log(`Loaded ${pack.questions.length} questions from ${sourceFileVersion}.`);

  const liveTemplates = await prisma.questionTemplate.findMany({ select: { id: true, title: true } });
  const titleIndex = new Map<string, string[]>();
  for (const t of liveTemplates) {
    const key = normaliseTitle(t.title);
    if (!key) continue;
    const list = titleIndex.get(key) ?? [];
    list.push(t.id);
    titleIndex.set(key, list);
  }

  let mappingCount = 0;
  let guidanceCount = 0;
  let childCount = 0;

  for (const q of pack.questions) {
    const paragraph: number = q.source.paragraph_index_zero_based;
    await upsertMapping({
      sourceParagraph: paragraph,
      section: q.section,
      sourceQuestionText: q.source.raw_question ?? q.title,
      titleIndex,
    });
    mappingCount++;

    // Primary per-answer panels
    for (const outcome of q.primary?.outcomes ?? []) {
      const panel = normalisePanel(outcome.panel);
      if (!panel) continue;
      await upsertGuidance({
        sourceParagraph: paragraph,
        parentSourceParagraph: null,
        nodeType: 'main',
        section: q.section,
        sourceQuestionText: q.title,
        answerValue: outcome.answer,
        panel,
        sourceFileVersion,
      });
      guidanceCount++;
    }

    // Assessment state panels (supported / gathering / unresolved / unsure)
    for (const a of q.assessment_outcomes ?? []) {
      const panel = normalisePanel(a.panel);
      if (!panel) continue;
      await upsertGuidance({
        sourceParagraph: paragraph,
        parentSourceParagraph: null,
        nodeType: 'main',
        section: q.section,
        sourceQuestionText: q.title,
        answerValue: `assessment:${a.assessment}`,
        panel,
        sourceFileVersion,
      });
      guidanceCount++;
    }

    // Special flow (boundary q133, glazing building-works child) - import
    // the panel copy too, even though the live interactive flow is driven
    // by wire-boundary-glazing-pathways.ts's step graph, not this table.
    const flowOutcomes = q.special_flow?.content?.outcomes ?? q.special_flow?.outcomes;
    if (flowOutcomes) {
      for (const [code, rawPanel] of Object.entries(flowOutcomes)) {
        const panel = normalisePanel(rawPanel as PanelLike);
        if (!panel) continue;
        await upsertGuidance({
          sourceParagraph: paragraph,
          parentSourceParagraph: null,
          nodeType: 'main',
          section: q.section,
          sourceQuestionText: q.title,
          answerValue: `code:${code}`,
          panel,
          sourceFileVersion,
          outcomeCode: code,
        });
        guidanceCount++;
      }
    }

    // Child / conditional prompts
    for (const child of q.conditional_source_prompts ?? []) {
      const childParagraph: number = child.source_paragraph_index_zero_based;
      await upsertMapping({
        sourceParagraph: childParagraph,
        section: q.section,
        sourceQuestionText: child.prompt,
        titleIndex,
        recommendedCondition: child.recommended_condition ?? null,
      });
      childCount++;

      for (const outcome of child.outcomes ?? []) {
        const panel = normalisePanel(outcome.panel);
        if (!panel) continue;
        await upsertGuidance({
          sourceParagraph: childParagraph,
          parentSourceParagraph: paragraph,
          nodeType: 'child',
          section: q.section,
          sourceQuestionText: child.prompt,
          answerValue: outcome.answer,
          panel,
          sourceFileVersion,
        });
        guidanceCount++;
      }
    }
  }

  console.log(`QuestionSourceMapping: ${mappingCount} main + ${childCount} child rows upserted.`);
  console.log(`QuestionAnswerGuidance: ${guidanceCount} branches upserted.`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
