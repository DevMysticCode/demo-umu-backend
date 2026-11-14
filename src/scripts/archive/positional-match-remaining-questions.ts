// Resolves a further slice of the remaining unmatched QuestionSourceMapping
// rows: cases where the export repeats the exact same generic wording for
// several genuinely different questions (e.g. "Does the property benefit
// from any of the following guarantees or warranties:" asked once per
// guarantee type - underpinning, roofing, central heating), and the live
// schema independently has the same number of distinct templates with that
// same generic wording (one per guarantee type, distinguished only by
// taskKey, e.g. "underpinning"/"roofing"/"central_heating"). Neither exact
// nor fuzzy text matching can tell these apart - this is the property-agent
// judgment call that they correspond in the same left-to-right order the
// export lists them and the live schema lists them, the same way a TA6
// guarantee/warranty list or a rights-of-way list is always itemised in a
// fixed sequence.
//
// Only commits when the export's count of a repeated phrase EXACTLY equals
// the count of unused live templates sharing that same wording in the same
// section - any mismatch is left unmapped rather than guessed. Bare
// reusable child-prompt labels ("Please provide written instruction for
// your answer above", "Additional detail", etc.) are excluded entirely,
// since those are follow-up fields bundled into their parent's own
// template, not standalone questions to match 1:1. "Who owns the
// freehold?" is excluded on purpose too - the client's own handoff doc
// flags this exact question as using a control (Yes/No) that doesn't match
// its real answer shape, and says to replace it with the live control
// rather than force a mapping onto the broken export row.
//
// Run manually: npx ts-node -r tsconfig-paths/register src/scripts/positional-match-remaining-questions.ts
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

const EXCLUDED_GENERIC_LABELS = [
  'please provide written instruction for your answer above',
  'please provide written instruction for your answer above and supply copies of the relevant documents',
  'please supply copies of the relevant documents',
  'please specify the following provider details',
  'additional detail',
  'additional comments',
  'additional detail(s)',
  'supporting document',
  'please indicate ownership by written instruction or by reference to a plan',
];

const EXCLUDED_QUESTIONS = ['who owns the freehold?'];

function normaliseText(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/^\d+\.\s*/, '').replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

async function main() {
  const unmatched = await prisma.questionSourceMapping.findMany({
    where: { liveQuestionTemplateId: null, section: { not: 'Fixtures and Fittings' } },
  });

  const normalisedExcludedLabels = EXCLUDED_GENERIC_LABELS.map(normaliseText);
  const normalisedExcludedQuestions = EXCLUDED_QUESTIONS.map(normaliseText);
  const eligible = unmatched.filter((m) => {
    const norm = normaliseText(m.sourceQuestionText);
    return !normalisedExcludedLabels.includes(norm) && !normalisedExcludedQuestions.includes(norm);
  });
  const skippedFreehold = unmatched.filter((m) => normalisedExcludedQuestions.includes(normaliseText(m.sourceQuestionText)));
  const skippedGeneric = unmatched.length - eligible.length - skippedFreehold.length;

  // Group eligible rows by (liveSection, normalisedText)
  const groups = new Map<string, typeof eligible>();
  for (const m of eligible) {
    const liveSection = SOURCE_TO_LIVE_SECTION[m.section];
    if (!liveSection) continue;
    const key = `${liveSection}|${normaliseText(m.sourceQuestionText)}`;
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }

  const usedTemplateIds = new Set(
    (await prisma.questionSourceMapping.findMany({ where: { liveQuestionTemplateId: { not: null } }, select: { liveQuestionTemplateId: true } })).map(
      (m) => m.liveQuestionTemplateId as string,
    ),
  );
  const allTemplates = await prisma.questionTemplate.findMany({
    select: { id: true, sectionKey: true, title: true, parts: true, order: true },
    orderBy: { order: 'asc' },
  });

  let matched = 0;
  let countMismatch = 0;
  const matchLog: string[] = [];
  const mismatchLog: string[] = [];

  for (const [key, members] of groups) {
    const [liveSection, normText] = key.split('|');
    const candidates = allTemplates.filter((t) => {
      if (t.sectionKey !== liveSection || usedTemplateIds.has(t.id)) return false;
      if (normaliseText(t.title) === normText) return true;
      if (Array.isArray(t.parts)) return (t.parts as any[]).some((p) => normaliseText(p?.title) === normText);
      return false;
    });

    if (candidates.length !== members.length || candidates.length === 0) {
      countMismatch++;
      mismatchLog.push(
        `[${liveSection}] "${members[0].sourceQuestionText}" - ${members.length} export row(s) (paragraphs ${members
          .map((m) => m.sourceParagraph)
          .join(', ')}) vs ${candidates.length} unused live candidate(s).`,
      );
      continue;
    }

    const sortedMembers = [...members].sort((a, b) => a.sourceParagraph - b.sourceParagraph);
    const sortedCandidates = [...candidates].sort((a, b) => a.order - b.order);

    for (let i = 0; i < sortedMembers.length; i++) {
      const m = sortedMembers[i];
      const t = sortedCandidates[i];
      await prisma.questionSourceMapping.update({
        where: { id: m.id },
        data: {
          liveQuestionTemplateId: t.id,
          matchConfidence: 'positional_within_repeated_group',
          matchNotes: `Repeated wording ("${m.sourceQuestionText}") in a ${sortedMembers.length}-item group - matched by sequence position (item ${i + 1} of ${sortedMembers.length}) against the live schema's own same-count group of distinctly-typed templates in this section.`,
          confirmedAt: new Date(),
        },
      });
      usedTemplateIds.add(t.id);
      matched++;
      matchLog.push(`${m.sourceParagraph} | ${m.section} | "${m.sourceQuestionText}" -> template ${t.id}`);
    }
  }

  console.log(`Eligible groups considered: ${groups.size}`);
  console.log(`Matched (count-exact groups): ${matched}`);
  console.log(`Count-mismatch groups (left unmapped): ${countMismatch}`);
  console.log(`Excluded as generic reusable child-prompt labels: ${skippedGeneric}`);
  console.log(`Excluded - "Who owns the freehold?" (client-flagged broken control, ${skippedFreehold.length} rows) - left unmapped on purpose.`);

  console.log(`\n── Matched ──`);
  matchLog.forEach((s) => console.log('  ' + s));

  console.log(`\n── Count mismatches (needs a real look) ──`);
  mismatchLog.forEach((s) => console.log('  ' + s));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
