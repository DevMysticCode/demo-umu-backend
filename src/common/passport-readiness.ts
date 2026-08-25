// Publish-readiness calculator for SELLER passports — deliberately separate
// from computePassportCompletion() (that stays a flat task-count ratio used
// across the dashboard/profile/property pages). This answers a different
// question: "is there enough here that a buyer paying for this passport
// isn't being shortchanged, and have the UK-disclosure-relevant questions
// actually been answered?" — driven by QuestionTemplate.readiness, which is
// populated per-part by src/scripts/import-passport-readiness.ts from the
// client's classified spreadsheet, plus two "system fact" checks that are
// satisfied from data we already hold rather than asked as questions.
//
// Rule (from the client's Milestone Logic sheet): publication is NOT simply
// "60% of questions answered" — it's "every row marked as a hard (YES) or
// currently-triggered (CONDITIONAL) publication blocker has an answer".

export interface ReadinessEntry {
  order: number; // matches parts[].order, or 1 for a non-MULTIPART question
  milestone: number | null; // 20 | 40 | 60 | 80 | 100, or null = excluded (NOTE rows)
  blocksPublication: 'yes' | 'conditional' | 'no';
  blockerTrigger: string | null;
}

export interface ReadinessQuestionTemplateInput {
  type: string;
  title?: string | null;
  parts: any; // Json — array of { order, partKey, conditionalOn?, showOnValues? }
  readiness: any; // Json — ReadinessEntry[]
}

export interface ReadinessQuestionInput {
  id: string; // PassportQuestion.id
  questionTemplate: ReadinessQuestionTemplateInput;
  answer: { answerJson: any; answerText: string | null; fileUrl: string | null } | null;
}

export interface ReadinessTaskInput {
  id: string; // PassportSectionTask.id — needed to deep-link straight to this task's question flow
  key: string;
  title: string;
  questions: ReadinessQuestionInput[];
}

export interface ReadinessSectionInput {
  id: string; // PassportSection.id — needed to deep-link (steps/:sectionId route)
  key: string;
  title: string;
  tasks: ReadinessTaskInput[];
}

export interface SystemCheckInput {
  key: 'titleNumber' | 'epcRating';
  label: string;
  satisfied: boolean;
  blocksPublication: boolean;
}

export interface MissingBlocker {
  section: string;
  question: string;
  questionId: string | null; // null for a system check, not tied to one PassportQuestion
  milestone: number;
}

// One row per QUESTION (not per required part — a MULTIPART question with
// several required parts collapses to one row here, satisfied only once
// every one of its required parts is), for a "what do I still need to do"
// checklist a seller can read top to bottom and tap through. sectionId/
// taskId are null only for the two system checks, which aren't tied to a
// section/task a seller can navigate into.
export interface ChecklistItem {
  section: string;
  sectionId: string | null;
  task: string;
  taskId: string | null;
  question: string;
  questionId: string | null;
  milestone: number;
  satisfied: boolean;
}

export interface PassportReadinessResult {
  canPublish: boolean;
  milestonePct: number; // highest tier (20/40/60/80/100) fully satisfied
  readinessPct: number; // % of currently-applicable blockers (yes + triggered conditional + blocking system checks) satisfied — drives the UI progress bar
  requiredTotal: number;
  requiredDone: number;
  missingBlockers: MissingBlocker[];
  // Every required item — satisfied and outstanding — one row per question,
  // in passport order. Powers the full "what's needed to publish" checklist
  // (tick/cross list, tap a row to jump straight to that question).
  checklist: ChecklistItem[];
  systemChecks: SystemCheckInput[];
  // PassportQuestion.id set of every question carrying at least one
  // blocksPublication:'yes' entry (regardless of current answer) — for the
  // frontend to badge "required to publish" throughout the question UI,
  // independent of whether it's currently satisfied.
  requiredQuestionIds: string[];
}

function isAnswerPresent(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Whether a given part's condition (if any) is currently triggered, given the question's own answerJson. */
function isPartTriggered(part: any, answerJson: any): boolean {
  if (!part?.conditionalOn) return true;
  const gateValue = answerJson?.[part.conditionalOn];
  if (gateValue === undefined || gateValue === null) return false;
  const showOn: string[] = part.showOnValues ?? [];
  return showOn.includes(gateValue);
}

/** Whether a single answerable slot (a part, or the whole question for non-MULTIPART) has an answer. */
function isSlotAnswered(
  template: ReadinessQuestionTemplateInput,
  part: any | null,
  answer: ReadinessQuestionInput['answer'],
): boolean {
  if (!answer) return false;
  if (!part) {
    // Non-MULTIPART: any answer at all on the question counts.
    return (
      isAnswerPresent(answer.answerText) ||
      isAnswerPresent(answer.answerJson) ||
      isAnswerPresent(answer.fileUrl)
    );
  }
  const value = answer.answerJson?.[part.partKey];
  if (part.type === 'upload') {
    return isAnswerPresent(value) || isAnswerPresent(answer.fileUrl);
  }
  return isAnswerPresent(value);
}

export function computePassportReadiness(
  sections: ReadinessSectionInput[],
  systemChecks: SystemCheckInput[],
): PassportReadinessResult {
  const missingBlockers: MissingBlocker[] = [];
  const requiredQuestionIds = new Set<string>();
  let requiredTotal = 0;
  let requiredDone = 0;
  const satisfiedByMilestone = new Map<number, boolean>();
  const applicableMilestones = new Set<number>();
  // Accumulates one row per question, in first-seen (passport) order —
  // Map preserves insertion order, which is what makes the checklist read
  // top-to-bottom in the same order as the sections/tasks themselves.
  const checklistByQuestionId = new Map<string, ChecklistItem>();

  for (const section of sections) {
    for (const task of section.tasks) {
      for (const q of task.questions) {
        const template = q.questionTemplate;
        const readinessEntries: ReadinessEntry[] = Array.isArray(template.readiness)
          ? template.readiness
          : [];
        if (readinessEntries.length === 0) continue;

        const parts: any[] = Array.isArray(template.parts) ? template.parts : [];
        const isMultipart = template.type === 'MULTIPART' && parts.length > 0;

        for (const entry of readinessEntries) {
          if (entry.milestone === null) continue; // EXCLUDED / NOTE row

          const part = isMultipart
            ? parts.find((p) => p.order === entry.order) ?? null
            : null;

          // A conditional slot (its part carries conditionalOn) that isn't
          // currently triggered by the gate's own answer isn't applicable
          // yet — skip it entirely rather than counting it as "unanswered"
          // (e.g. the "please explain" follow-up after a "No" doesn't apply
          // and must not drag the milestone/blocker count down).
          const hasCondition = !!part?.conditionalOn;
          const triggered = hasCondition
            ? isPartTriggered(part, q.answer?.answerJson)
            : true;
          if (!triggered) continue;

          const isBlockerNow = entry.blocksPublication !== 'no';
          if (isBlockerNow) requiredQuestionIds.add(q.id);

          applicableMilestones.add(entry.milestone);
          const answered = isSlotAnswered(template, part, q.answer);
          const prevSatisfied = satisfiedByMilestone.get(entry.milestone);
          satisfiedByMilestone.set(
            entry.milestone,
            prevSatisfied === undefined ? answered : prevSatisfied && answered,
          );

          if (isBlockerNow) {
            requiredTotal++;
            if (answered) {
              requiredDone++;
            } else {
              missingBlockers.push({
                section: section.title,
                question: part?.title || template.title || task.title,
                questionId: q.id,
                milestone: entry.milestone,
              });
            }

            // Roll every required part of this question into one checklist
            // row — satisfied only once ALL of its required parts are (a
            // question with one unanswered required part among several
            // answered ones still reads as "not done" here).
            const existing = checklistByQuestionId.get(q.id);
            if (existing) {
              existing.satisfied = existing.satisfied && answered;
              existing.milestone = Math.min(existing.milestone, entry.milestone);
            } else {
              checklistByQuestionId.set(q.id, {
                section: section.title,
                sectionId: section.id,
                task: task.title,
                taskId: task.id,
                question: template.title || part?.title || task.title,
                questionId: q.id,
                milestone: entry.milestone,
                satisfied: answered,
              });
            }
          }
        }
      }
    }
  }

  const checklist: ChecklistItem[] = [...checklistByQuestionId.values()];

  for (const check of systemChecks) {
    if (!check.blocksPublication) continue;
    applicableMilestones.add(60);
    requiredTotal++;
    checklist.push({
      section: 'System checks',
      sectionId: null,
      task: 'System checks',
      taskId: null,
      question: check.label,
      questionId: null,
      milestone: 60,
      satisfied: check.satisfied,
    });
    if (check.satisfied) {
      requiredDone++;
    } else {
      missingBlockers.push({
        section: 'System checks',
        question: check.label,
        questionId: null,
        milestone: 60,
      });
    }
  }

  const tiers = [20, 40, 60, 80, 100];
  let milestonePct = 0;
  for (const tier of tiers) {
    if (!applicableMilestones.has(tier)) continue;
    if (satisfiedByMilestone.get(tier)) {
      milestonePct = tier;
    } else {
      break;
    }
  }

  const readinessPct =
    requiredTotal > 0 ? Math.round((requiredDone / requiredTotal) * 100) : 100;

  return {
    canPublish: missingBlockers.length === 0,
    milestonePct,
    readinessPct,
    requiredTotal,
    requiredDone,
    missingBlockers,
    checklist,
    systemChecks,
    requiredQuestionIds: [...requiredQuestionIds],
  };
}
