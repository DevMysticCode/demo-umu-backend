/**
 * Imports the client's "Readiness Mapping" classification
 * (Passport-Questions-Readiness-Developer.xlsx) onto QuestionTemplate.readiness
 * for every SELLER section — the milestone tier (20/40/60/80/100) and
 * publish-blocker status (yes/conditional/no) that
 * src/common/passport-readiness.ts reads to gate publishPassport().
 *
 * Matching strategy (deliberately NOT fuzzy text matching): the Excel's
 * "Section"/"Task" columns are exact renders of SectionTemplate.title and
 * PassportService.formatTaskKey(taskKey) — confirmed by direct comparison
 * against the live DB. Within one (section, task) pair, Excel rows appear
 * in the same order the DB would render them: QuestionTemplate.order, then
 * — for MULTIPART — parts[].order. So each (section, task) group is matched
 * to its DB template(s)/parts purely by position, with the question text
 * as a corroborating (non-fatal) sanity check, never the primary key. Any
 * (section, task) whose row count doesn't match its DB slot count is
 * printed for manual review and skipped — never guessed.
 *
 * "Title Deeds and Plan" is excluded from the import: it was redesigned
 * (renamed "Title Register and Plan", 2 questions -> 4 parts) after this
 * Excel was exported, so its Excel rows are stale. It's classified by hand
 * below instead, per the client's own instruction that the two Title
 * Register/Title Plan declarations *are* publish blockers (the uploads
 * themselves stay evidence-tier, non-blocking).
 *
 * Idempotent — safe to re-run (each run fully overwrites `readiness` for
 * every template it touches, from the Excel, not merged with prior state).
 *
 * Usage:
 *   npm run import:passport-readiness
 */

import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';

const path = require('path');
const fs = require('fs');
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
}

const prisma = new PrismaClient();

const EXCEL_PATH =
  process.env.PASSPORT_READINESS_XLSX ||
  'D:/downloads_moved/Downloads/bug_screenshots/discover/Passport-Questions-Readiness-Developer.xlsx';

// Excel section titles that must NOT be imported from the sheet — handled
// by hand further down instead.
const HAND_CLASSIFIED_SECTIONS = new Set(['Title Deeds and Plan']);

// (section, task) pairs where the bucket title-matcher can't line things up
// — because several of the DB's MULTIPART parts have a genuinely blank
// `title` (their label is the standalone parent question, e.g. a bare
// "(Photos)" upload) while the Excel gives that same row a descriptive
// placeholder like "(Photos)" or "(Landlord Tenants)" — but raw DB order
// vs Excel row order has been manually verified, slot-by-slot, to line up
// exactly for every row in each of these tasks. Skip straight to position
// for just these, rather than the bucket match (which would otherwise
// correctly refuse them as unverifiable).
const POSITION_VERIFIED_TASKS = new Set([
  'Leasehold|||Documents',
  'Leasehold|||Notices',
  'Leasehold|||Ownership And Management',
  'Leasehold|||The Property',
  'Ownership Profile|||Give Your Home A Story',
  'Ownership Profile|||Name Of Sellers And Address Of The Property',
]);

interface ExcelRow {
  section: string;
  task: string;
  question: string;
  milestone: number | null;
  blocker: 'yes' | 'conditional' | 'no';
  trigger: string | null;
}

interface ReadinessEntry {
  order: number;
  milestone: number | null;
  blocksPublication: 'yes' | 'conditional' | 'no';
  blockerTrigger: string | null;
}

function formatTaskKey(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function parseMilestone(v: string): number | null {
  if (!v || v.toUpperCase() === 'EXCLUDED') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseBlocker(v: string): 'yes' | 'conditional' | 'no' {
  const s = (v || '').trim().toUpperCase();
  if (s === 'YES') return 'yes';
  if (s === 'CONDITIONAL') return 'conditional';
  return 'no';
}

async function readExcelRows(): Promise<ExcelRow[]> {
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets['Readiness Mapping'];
  if (!ws) throw new Error('Sheet "Readiness Mapping" not found in workbook');

  // header: false -> array-of-arrays, 1 row per Excel row, 0-indexed columns
  const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const rows: ExcelRow[] = [];
  const get = (row: any[], i: number) => String(row[i] ?? '').trim(); // i is 0-indexed
  for (let r = 1; r < raw.length; r++) {
    const row = raw[r];
    if (get(row, 1) !== 'SELLER') continue;
    rows.push({
      section: get(row, 2),
      task: get(row, 3),
      question: get(row, 4),
      milestone: parseMilestone(get(row, 8)),
      blocker: parseBlocker(get(row, 10)),
      trigger: get(row, 11) || null,
    });
  }
  return rows;
}

function groupByTask(rows: ExcelRow[]): Map<string, ExcelRow[]> {
  const grouped = new Map<string, ExcelRow[]>();
  for (const r of rows) {
    const key = `${r.section}|||${r.task}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }
  return grouped;
}

/** Fuzzy-free text similarity check used only to flag (not block) a possible mismatch. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function main() {
  const needsReview: string[] = [];
  let templatesUpdated = 0;
  let entriesWritten = 0;

  // Writes one (slots, rows) pair's readiness data to the DB, position-
  // paired: slots[i] <-> rows[i]. Accumulates a MULTIPART template's parts
  // (which may span several slots) into one update per template.
  async function writeReadiness(
    slots: { template: { id: string; type: string }; part: any | null }[],
    rows: ExcelRow[],
    label: string,
  ) {
    const readinessByTemplateId = new Map<string, ReadinessEntry[]>();
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const row = rows[i];
      const entry: ReadinessEntry = {
        order: slot.part ? (slot.part.order ?? i + 1) : 1,
        milestone: row.milestone,
        blocksPublication: row.blocker,
        blockerTrigger: row.blocker === 'conditional' ? row.trigger : null,
      };
      if (!readinessByTemplateId.has(slot.template.id)) readinessByTemplateId.set(slot.template.id, []);
      readinessByTemplateId.get(slot.template.id)!.push(entry);
      entriesWritten++;
    }
    for (const [templateId, entries] of readinessByTemplateId) {
      await prisma.questionTemplate.update({
        where: { id: templateId },
        data: { readiness: entries as any },
      });
      templatesUpdated++;
    }
    console.log(`  wrote readiness for ${label}: ${slots.length} slot(s)`);
  }

  const excelRows = await readExcelRows();
  console.log(`Read ${excelRows.length} SELLER rows from "Readiness Mapping".`);
  const grouped = groupByTask(excelRows);

  const sectionTemplates = await prisma.sectionTemplate.findMany({
    select: { key: true, title: true },
  });
  const sectionKeyByTitle = new Map(sectionTemplates.map((s) => [s.title, s.key]));

  for (const [groupKey, rows] of grouped) {
    const [sectionTitle, taskTitle] = groupKey.split('|||');

    if (HAND_CLASSIFIED_SECTIONS.has(sectionTitle)) {
      console.log(`Skipping "${sectionTitle}" / "${taskTitle}" - hand-classified separately (stale Excel rows).`);
      continue;
    }

    const sectionKey = sectionKeyByTitle.get(sectionTitle);
    if (!sectionKey) {
      needsReview.push(`No SectionTemplate found for Excel section "${sectionTitle}" (task "${taskTitle}")`);
      continue;
    }

    const templates = await prisma.questionTemplate.findMany({
      where: { sectionKey },
      orderBy: { order: 'asc' },
    });
    const byTaskKey = new Map<string, typeof templates>();
    for (const t of templates) {
      if (!byTaskKey.has(t.taskKey)) byTaskKey.set(t.taskKey, [] as any);
      byTaskKey.get(t.taskKey)!.push(t);
    }

    const matchingTaskKeys = [...byTaskKey.keys()].filter(
      (tk) => formatTaskKey(tk) === taskTitle,
    );
    if (matchingTaskKeys.length !== 1) {
      needsReview.push(
        `Section "${sectionTitle}" task "${taskTitle}": found ${matchingTaskKeys.length} matching DB taskKey(s) (expected 1) - ${JSON.stringify(matchingTaskKeys)}`,
      );
      continue;
    }
    const taskTemplates = byTaskKey.get(matchingTaskKeys[0])!;

    // Flatten into (template, part|null, slotTitle) slots, DB order.
    const slots: { template: (typeof templates)[number]; part: any | null; title: string }[] = [];
    for (const t of taskTemplates) {
      const parts = Array.isArray(t.parts) ? (t.parts as any[]) : [];
      if (t.type === 'MULTIPART' && parts.length > 0) {
        for (const p of [...parts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
          slots.push({ template: t, part: p, title: p.title || '' });
        }
      } else {
        slots.push({ template: t, part: null, title: t.title || '' });
      }
    }

    if (slots.length !== rows.length) {
      needsReview.push(
        `Section "${sectionTitle}" task "${taskTitle}": ${rows.length} Excel row(s) vs ${slots.length} DB slot(s) - skipped, needs manual review`,
      );
      continue;
    }

    if (POSITION_VERIFIED_TASKS.has(groupKey)) {
      await writeReadiness(slots, rows, `"${sectionTitle}" / "${taskTitle}" (manually position-verified)`);
      continue;
    }

    // Position (DB order vs Excel row order) is the primary matching key,
    // but a task whose questions repeat the same field labels per item —
    // Fixtures & Fittings' per-room "Item Name / Description / Inclusion
    // Status" blocks, or Services' per-utility "please specify provider
    // details" — can have its DB template-creation order diverge from the
    // Excel's row order. A raw position match would then risk silently
    // writing one question's classification onto a DIFFERENT question
    // (found and fixed here: Services / Drainage And Sewerage had two
    // adjacent slots swapped, one 60/CONDITIONAL and one 80/NO). So:
    // bucket every DB slot and every Excel row by normalized title, and
    // only proceed if (a) the two sides have the exact same multiset of
    // titles, and (b) every title that repeats more than once is
    // classified IDENTICALLY across all its occurrences — in that case
    // whichever specific occurrence lines up with whichever doesn't matter,
    // the value written is the same either way. Within each bucket, DB
    // slots are matched to Excel rows in their respective encounter order.
    // A task that can't satisfy this (distinct-titled rows that don't line
    // up, or repeated titles with genuinely different values) is flagged
    // for manual review instead of guessed.
    const orderedRows: ExcelRow[] | null = (() => {
      const slotBuckets = new Map<string, number[]>();
      slots.forEach((s, i) => {
        const key = normalize(s.title);
        if (!slotBuckets.has(key)) slotBuckets.set(key, []);
        slotBuckets.get(key)!.push(i);
      });
      const rowBuckets = new Map<string, number[]>();
      rows.forEach((r, i) => {
        const key = normalize(r.question);
        if (!rowBuckets.has(key)) rowBuckets.set(key, []);
        rowBuckets.get(key)!.push(i);
      });
      if (slotBuckets.size !== rowBuckets.size) return null;
      for (const [key, slotIdxs] of slotBuckets) {
        const rowIdxs = rowBuckets.get(key);
        if (!rowIdxs || rowIdxs.length !== slotIdxs.length) return null;
      }
      for (const [, rowIdxs] of rowBuckets) {
        if (rowIdxs.length <= 1) continue;
        const first = rows[rowIdxs[0]];
        const uniform = rowIdxs.every(
          (idx) =>
            rows[idx].milestone === first.milestone &&
            rows[idx].blocker === first.blocker &&
            rows[idx].trigger === first.trigger,
        );
        if (!uniform) return null;
      }
      const bucketCursor = new Map<string, number>();
      const assignment: number[] = new Array(slots.length);
      for (let i = 0; i < slots.length; i++) {
        const key = normalize(slots[i].title);
        const cursor = bucketCursor.get(key) ?? 0;
        assignment[i] = rowBuckets.get(key)![cursor];
        bucketCursor.set(key, cursor + 1);
      }
      return assignment.map((idx) => rows[idx]);
    })();

    let finalRows = orderedRows;
    if (!finalRows) {
      // Last resort: if the bucket match couldn't line titles up at all
      // (e.g. Fixtures & Fittings' per-room fields, where the DB's part
      // titles for one item don't textually match the Excel's for reasons
      // unrelated to ordering) but literally every row in the group is
      // classified identically, position is irrelevant — apply it.
      const first = rows[0];
      const allSameClassification = rows.every(
        (r) => r.milestone === first.milestone && r.blocker === first.blocker && r.trigger === first.trigger,
      );
      if (allSameClassification) {
        finalRows = rows;
        console.log(
          `  [uniform fallback] "${sectionTitle}" / "${taskTitle}": titles couldn't be matched but all ${rows.length} row(s) share one classification (${first.milestone}/${first.blocker}) - applying by position.`,
        );
      } else {
        needsReview.push(
          `Section "${sectionTitle}" task "${taskTitle}": titles could not be safely matched to DB slots (distinct titles that don't correspond 1:1, or a repeated title with different classifications across occurrences) - skipped, needs manual review`,
        );
        continue;
      }
    }

    await writeReadiness(slots, finalRows, `"${sectionTitle}" / "${taskTitle}"`);
  }

  // ── Hand-classified: Title Register and Plan (titleDeedsAndPlan) ──────
  // Redesigned today; Excel predates the redesign. Per the client's own
  // correction, the two "do you have a copy of..." RADIO gates ARE publish
  // blockers (milestone 60) — the conditional uploads stay evidence-tier
  // (milestone 80, non-blocking), consistent with every other upload row
  // in the Excel (Rule 5: uploads generally don't block 60%).
  const titleDeedsTemplates = await prisma.questionTemplate.findMany({
    where: { sectionKey: 'titleDeedsAndPlan' },
    orderBy: { order: 'asc' },
  });
  for (const t of titleDeedsTemplates) {
    const parts = Array.isArray(t.parts) ? (t.parts as any[]) : [];
    if (t.type !== 'MULTIPART' || parts.length === 0) {
      needsReview.push(`titleDeedsAndPlan template ${t.id} is not MULTIPART as expected - skipped hand-classification`);
      continue;
    }
    const entries: ReadinessEntry[] = parts.map((p) => ({
      order: p.order,
      milestone: p.type === 'upload' ? 80 : 60,
      blocksPublication: p.type === 'upload' ? 'no' : 'yes',
      blockerTrigger: null,
    }));
    await prisma.questionTemplate.update({ where: { id: t.id }, data: { readiness: entries as any } });
    templatesUpdated++;
    entriesWritten += entries.length;
    console.log(`Hand-classified titleDeedsAndPlan template ${t.id}: ${JSON.stringify(entries)}`);
  }

  console.log(`\nDone. ${templatesUpdated} QuestionTemplate rows updated, ${entriesWritten} readiness entries written.`);
  if (needsReview.length > 0) {
    console.log(`\n${needsReview.length} item(s) need manual review (not imported):`);
    for (const line of needsReview) console.log(`  - ${line}`);
  } else {
    console.log('No items flagged for manual review.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
