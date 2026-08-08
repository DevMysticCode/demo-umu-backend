// Shared "how much of this Passport is filled in" calculator. Previously
// implemented twice — ProfileService.getUserPassports() and
// PropertyService.buildPassportProgress() each had their own copy of the
// same task-done rule (a task counts as complete when every one of its
// questions has an answer). Both call sites already carried a comment
// noting they were meant to agree; this consolidates them into one
// function so they can't silently drift.
//
// Deliberately NOT related to RewardsService/PointsLedgerEntry — completion
// % is a passport-progress metric, points are a currency. Keep them apart.

export interface CompletionTaskInput {
  passportQuestions: { answer: { id: string } | null }[];
}

export interface CompletionSectionInput {
  key?: string;
  title?: string;
  status?: string;
  tasks: CompletionTaskInput[];
}

export interface CompletionSectionResult {
  key?: string;
  title?: string;
  status?: string;
  completedTasks: number;
  totalTasks: number;
}

export interface PassportCompletionResult {
  completedSections: number;
  totalSections: number;
  completedTasks: number;
  totalTasks: number;
  completionPct: number;
  sections: CompletionSectionResult[];
}

function isTaskComplete(task: CompletionTaskInput): boolean {
  return (
    task.passportQuestions.length > 0 &&
    task.passportQuestions.every((q) => q.answer)
  );
}

export function computePassportCompletion(
  sections: CompletionSectionInput[],
): PassportCompletionResult {
  if (sections.length === 0) {
    return {
      completedSections: 0,
      totalSections: 0,
      completedTasks: 0,
      totalTasks: 0,
      completionPct: 0,
      sections: [],
    };
  }

  let totalTasks = 0;
  let completedTasks = 0;
  const sectionRows: CompletionSectionResult[] = sections.map((s) => {
    // Tasks with no questions at all don't count toward either side — a
    // section that's entirely empty tasks shouldn't drag completion down.
    const countable = s.tasks.filter((t) => t.passportQuestions.length > 0);
    const sTotal = countable.length;
    const sDone = countable.filter(isTaskComplete).length;
    totalTasks += sTotal;
    completedTasks += sDone;
    return {
      key: s.key,
      title: s.title,
      status: s.status,
      completedTasks: sDone,
      totalTasks: sTotal,
    };
  });

  const completedSections = sectionRows.filter(
    (s) => s.totalTasks > 0 && s.completedTasks === s.totalTasks,
  ).length;
  const completionPct =
    totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return {
    completedSections,
    totalSections: sections.length,
    completedTasks,
    totalTasks,
    completionPct,
    sections: sectionRows,
  };
}
