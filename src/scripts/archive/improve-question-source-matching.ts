// Extends QuestionSourceMapping's auto-match pass beyond what
// import-passport-content.ts originally did. That script only indexed
// QuestionTemplate.title, which is blank for every MULTIPART question (178
// of 307 live templates, 58%) - the real question text for those lives in
// parts[].title instead. That single blind spot meant most of Boundaries,
// Alterations, Disputes, Notices, Fixtures-and-Fittings-adjacent MULTIPART
// questions could never auto-match, regardless of exact wording equality.
//
// This script re-attempts matching for every still-unmatched
// QuestionSourceMapping row (sourceQuestionText vs. title OR any part's
// title, case/punctuation/leading-number normalised), and only commits a
// match when exactly one live template's text equals it - ambiguous
// (matches more than one template, e.g. a fittings item name repeated per
// room) or genuinely unmatched rows are left untouched rather than guessed.
//
// Run manually: npx ts-node -r tsconfig-paths/register src/scripts/improve-question-source-matching.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function normaliseText(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/^\d+\.\s*/, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const templates = await prisma.questionTemplate.findMany({ select: { id: true, title: true, parts: true } });
  const titleIndex = new Map<string, string[]>();
  for (const t of templates) {
    const texts = new Set<string>();
    if (t.title) texts.add(normaliseText(t.title));
    if (Array.isArray(t.parts)) {
      for (const p of t.parts as any[]) {
        if (p?.title) texts.add(normaliseText(p.title));
      }
    }
    for (const key of texts) {
      if (!key) continue;
      const list = titleIndex.get(key) ?? [];
      list.push(t.id);
      titleIndex.set(key, list);
    }
  }

  const unmatched = await prisma.questionSourceMapping.findMany({ where: { liveQuestionTemplateId: null } });

  let matched = 0;
  let ambiguous = 0;
  for (const m of unmatched) {
    const candidates = titleIndex.get(normaliseText(m.sourceQuestionText)) ?? [];
    if (candidates.length === 1) {
      await prisma.questionSourceMapping.update({
        where: { id: m.id },
        data: {
          liveQuestionTemplateId: candidates[0],
          matchConfidence: 'exact_title_unique_incl_parts',
          confirmedAt: new Date(),
        },
      });
      matched++;
    } else if (candidates.length > 1) {
      await prisma.questionSourceMapping.update({
        where: { id: m.id },
        data: { matchNotes: `Ambiguous exact-title match (incl. part titles), candidates: ${candidates.join(', ')}` },
      });
      ambiguous++;
    }
  }

  console.log(`Newly matched: ${matched}. Ambiguous (left for manual review): ${ambiguous}. Still unmatched: ${unmatched.length - matched - ambiguous}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
