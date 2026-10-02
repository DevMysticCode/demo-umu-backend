// Fine-grained pathway outcome codes (client content pack, UMU_278
// developer handoff, 2 Oct 2026 - see UMU_278_Developer_Guide.md "Boundary
// specialist flow" / "Replacement glazing specialist flow").
//
// PathwayJourney.status is a loose String (schema.prisma), not a Prisma
// enum, so these codes are written there directly for P09 (boundary) and
// P39 (glazing) instead of the 4 generic engine statuses - that's the whole
// point of this file: give "My flags" and the outcome UI something more
// specific than RESOLVED/CHECK/FLAG/ESCALATE for these two pathways, while
// every other pathway keeps using the generic 4.
//
// "no" (boundary) and "no_work"/"initial_unsure" (q133's own "no"/"unsure"
// primary answers) are NOT here - those never enter a pathway at all (the
// pathway only triggers on a "yes"-equivalent primary answer), so they're
// QuestionAnswerGuidance panels on the primary question, not journey
// statuses. Boundary's "incomplete" and glazing's "incomplete" are likewise
// absent: they describe a not-yet-fully-answered state in the client's
// freeform reference evaluator (UMU_Question_Rules.js), which can't occur
// here since a step-sequential journey can't reach a terminal transition
// without every upstream step having an answer.

export type OutcomeSeverity = 'RESOLVED' | 'CHECK' | 'FLAG' | 'ESCALATE';

// The 4 generic engine statuses every OTHER pathway (P01-P08, P10-P38) uses.
export const GENERIC_OUTCOME_SEVERITY: Record<string, OutcomeSeverity> = {
  RESOLVED: 'RESOLVED',
  CHECK: 'CHECK',
  FLAG: 'FLAG',
  ESCALATE: 'ESCALATE',
};

// P09 - irregular boundary. 9 of the pack's 12 authored codes are reachable
// from the live pathway (see wire-boundary-glazing-pathways.ts); "no" and
// "initial_unsure" are primary-answer guidance, "incomplete" is unreachable.
export const BOUNDARY_OUTCOME_SEVERITY: Record<string, OutcomeSeverity> = {
  ordinary: 'RESOLVED',
  moved_explained: 'RESOLVED',
  check: 'CHECK',
  conflict: 'CHECK',
  mismatch: 'FLAG',
  historic: 'CHECK',
  historic_mismatch: 'FLAG',
  dispute: 'ESCALATE',
  dispute_mismatch: 'ESCALATE',
};

// P39 - replacement glazing since 1 April 2002. "no_work" is the main
// question's own "No" answer (guidance panel, not a journey).
export const GLAZING_OUTCOME_SEVERITY: Record<string, OutcomeSeverity> = {
  before: 'RESOLVED',
  record_added: 'RESOLVED',
  record_held: 'CHECK',
  date_unknown: 'CHECK',
  check_record: 'CHECK',
  searching: 'CHECK',
  missing_record: 'FLAG',
};

export const OUTCOME_SEVERITY: Record<string, OutcomeSeverity> = {
  ...GENERIC_OUTCOME_SEVERITY,
  ...BOUNDARY_OUTCOME_SEVERITY,
  ...GLAZING_OUTCOME_SEVERITY,
};

export function severityOf(status: string): OutcomeSeverity {
  return OUTCOME_SEVERITY[status] ?? 'CHECK';
}

// Marks a pathway step option's `next` as a fine-grained terminal code
// rather than another step id - e.g. "code:dispute_mismatch". Needed
// because some of these code strings (dispute_mismatch itself, for one)
// are also used as step ids earlier in the same graph; without a marker,
// a terminal transition and a mid-flow step jump would be ambiguous.
export const CODE_PREFIX = 'code:';

export function isTerminalNext(next: string): boolean {
  return next in GENERIC_OUTCOME_SEVERITY || next.startsWith(CODE_PREFIX);
}

export function terminalStatusFor(next: string): string {
  return next.startsWith(CODE_PREFIX) ? next.slice(CODE_PREFIX.length) : next;
}
