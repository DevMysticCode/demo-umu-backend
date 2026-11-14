// Resolves as much of the remaining 319 unmatched QuestionSourceMapping
// rows (45 main questions + 274 child prompts) as can be done safely: exact
// text matching (improve-question-source-matching.ts) already got 295/614;
// this pass adds section-scoped fuzzy (word-overlap) matching for cases
// where the export's wording and the live schema's wording say the same
// thing differently - the property-agent judgment call is deciding whether
// two differently-worded UK conveyancing questions are actually the same
// disclosure item, which text-only similarity can get most of the way to
// but not all the way.
//
// Safety rails, since a wrong mapping here would attach real guidance
// content to the wrong live question:
//   - Candidates are scoped to the live schema's matching section only
//     (source "Boundaries" -> live sectionKey "boundaries", etc.) - a
//     source/live section-name table is hardcoded below since the two use
//     different casing conventions but correspond 1:1.
//   - A live template already used by a confirmed mapping is excluded from
//     candidacy, so this can't attach two different source paragraphs to
//     the same specific live question/part by accident.
//   - Only commits when the best-scoring candidate is unambiguously ahead
//     of the runner-up AND above a minimum similarity floor - anything
//     closer than that is left for a human decision, not guessed.
//
// Run manually: npx ts-node -r tsconfig-paths/register src/scripts/fuzzy-match-remaining-questions.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SOURCE_TO_LIVE_SECTION: Record<string, string> = {
  'Transaction Information': 'transactionInformation',
  Environmental: 'environmental',
  'Alterations and Planning': 'alterationsAndPlanning',
  'Title Register and Plan': 'titleDeedsAndPlan',
  Services: 'services',
  Searches: 'searches',
  'Fixtures and Fittings': 'fixturesAndFittings',
  'Other Charges': 'otherCharges',
  'Guarantees and Warranties': 'guaranteesAndWarranties',
  'Notices and Proposals': 'noticesAndProposals',
  Leasehold: 'leasehold',
  Parking: 'parking',
  'Disputes and Complaints': 'disputesAndComplaints',
  'Rights and Informal Arrangements': 'rightsAndInformalArrangements',
  Insurance: 'insurance',
  Occupiers: 'occupiers',
  Boundaries: 'boundaries',
  'Ownership Profile': 'ownershipProfile',
};

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'is', 'are', 'this', 'that', 'any', 'have', 'has', 'been', 'to', 'for', 'or', 'and',
  'you', 'your', 'if', 'in', 'on', 'at', 'be', 'it', 'do', 'does', 'did', 'was', 'were', 'will', 'would',
  'please', 'provide', 'details', 'about', 'with', 'from', 'by', 'as', 'not', 'no', 'yes', 'been', 'their',
]);

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/^\d+\.\s*/, '')
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

interface Candidate {
  templateId: string;
  text: string;
}

async function main() {
  const unmatched = await prisma.questionSourceMapping.findMany({ where: { liveQuestionTemplateId: null } });
  console.log(`${unmatched.length} unmatched source paragraphs to attempt.`);

  const usedTemplateIds = new Set(
    (await prisma.questionSourceMapping.findMany({ where: { liveQuestionTemplateId: { not: null } }, select: { liveQuestionTemplateId: true } })).map(
      (m) => m.liveQuestionTemplateId as string,
    ),
  );

  const allTemplates = await prisma.questionTemplate.findMany({ select: { id: true, sectionKey: true, title: true, parts: true } });
  const candidatesBySection = new Map<string, Candidate[]>();
  for (const t of allTemplates) {
    if (usedTemplateIds.has(t.id)) continue; // already claimed by a confirmed mapping - not a candidate
    const list = candidatesBySection.get(t.sectionKey) ?? [];
    if (t.title) list.push({ templateId: t.id, text: t.title });
    if (Array.isArray(t.parts)) {
      for (const p of t.parts as any[]) {
        if (p?.title) list.push({ templateId: t.id, text: p.title });
      }
    }
    candidatesBySection.set(t.sectionKey, list);
  }

  let matched = 0;
  let ambiguous = 0;
  let noSectionCandidates = 0;
  const matchLog: string[] = [];
  const ambiguousLog: string[] = [];

  for (const m of unmatched) {
    const liveSection = SOURCE_TO_LIVE_SECTION[m.section];
    const candidates = liveSection ? candidatesBySection.get(liveSection) ?? [] : [];
    if (!candidates.length) {
      noSectionCandidates++;
      continue;
    }

    const sourceTokens = tokens(m.sourceQuestionText);
    const scored = candidates
      .map((c) => ({ ...c, score: jaccard(sourceTokens, tokens(c.text)) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    const runnerUp = scored[1];
    const gap = runnerUp ? best.score - runnerUp.score : best.score;

    if (best.score >= 0.6 && gap >= 0.15) {
      await prisma.questionSourceMapping.update({
        where: { id: m.id },
        data: {
          liveQuestionTemplateId: best.templateId,
          matchConfidence: 'fuzzy_section_scoped',
          matchNotes: `Fuzzy word-overlap match (score ${best.score.toFixed(2)}) against "${best.text}".`,
          confirmedAt: new Date(),
        },
      });
      usedTemplateIds.add(best.templateId); // claim it so a later row in this same pass can't also grab it
      matched++;
      matchLog.push(`${m.sourceParagraph} | "${m.sourceQuestionText}" -> "${best.text}" (score ${best.score.toFixed(2)})`);
    } else {
      ambiguous++;
      ambiguousLog.push(
        `${m.sourceParagraph} | ${m.section} | "${m.sourceQuestionText}" | best: "${best.text}" (${best.score.toFixed(2)})${
          runnerUp ? `, next: "${runnerUp.text}" (${runnerUp.score.toFixed(2)})` : ''
        }`,
      );
    }
  }

  console.log(`\nMatched: ${matched}`);
  console.log(`Ambiguous / below threshold (left for manual review): ${ambiguous}`);
  console.log(`No live section to search (section name not in the map, or that section has no unused templates): ${noSectionCandidates}`);

  console.log(`\n── Auto-matched (spot-check these) ──`);
  matchLog.forEach((s) => console.log('  ' + s));

  console.log(`\n── Needs manual/property-agent judgment (${ambiguousLog.length}) ──`);
  ambiguousLog.forEach((s) => console.log('  ' + s));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
