// Event type constants + the filter-category mapping for the History
// feature (client handoff, 2026-09-25, "History list... Filter All /
// Information / Documents / Actions / Access"). Kept as plain string
// constants (not a Prisma enum) so new event types don't require a schema
// migration — PassportEvent.eventType is just a String column.

export const PassportEventType = {
  // Passport lifecycle
  PASSPORT_CREATED: 'PASSPORT_CREATED',
  PASSPORT_CLAIM_SUBMITTED: 'PASSPORT_CLAIM_SUBMITTED',
  OWNERSHIP_VERIFIED: 'OWNERSHIP_VERIFIED',
  OWNERSHIP_REJECTED: 'OWNERSHIP_REJECTED',
  PASSPORT_ACTIVATED: 'PASSPORT_ACTIVATED',
  PASSPORT_ARCHIVED: 'PASSPORT_ARCHIVED',

  // Questions
  QUESTION_ANSWER_ADDED: 'QUESTION_ANSWER_ADDED',
  QUESTION_ANSWER_CHANGED: 'QUESTION_ANSWER_CHANGED',
  QUESTION_ANSWER_CLEARED: 'QUESTION_ANSWER_CLEARED',
  SECTION_COMPLETED: 'SECTION_COMPLETED',

  // Evidence / vault
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  DOCUMENT_REPLACED: 'DOCUMENT_REPLACED',
  DOCUMENT_REMOVED: 'DOCUMENT_REMOVED',
  SOURCE_RECORD_IMPORTED: 'SOURCE_RECORD_IMPORTED',

  // Guidance and actions
  ACTION_CREATED: 'ACTION_CREATED',
  ACTION_SUPERSEDED: 'ACTION_SUPERSEDED',
  ACTION_REOPENED: 'ACTION_REOPENED',
  ACTION_ADDRESSED: 'ACTION_ADDRESSED',
  ACTION_EVIDENCE_ADDED: 'ACTION_EVIDENCE_ADDED',

  // Access
  COLLABORATOR_INVITED: 'COLLABORATOR_INVITED',
  COLLABORATOR_REMOVED: 'COLLABORATOR_REMOVED',
  COLLABORATOR_SCOPE_CHANGED: 'COLLABORATOR_SCOPE_CHANGED',
  SHARE_LINK_CREATED: 'SHARE_LINK_CREATED',
  BUYER_ACCESS_GRANTED: 'BUYER_ACCESS_GRANTED',

  // Publication
  PASSPORT_PUBLISHED: 'PASSPORT_PUBLISHED',
  PASSPORT_UNPUBLISHED: 'PASSPORT_UNPUBLISHED',
  SECTION_VISIBILITY_CHANGED: 'SECTION_VISIBILITY_CHANGED',
} as const;

export type PassportEventTypeValue =
  (typeof PassportEventType)[keyof typeof PassportEventType];

export const HistoryCategory = {
  INFORMATION: 'information',
  DOCUMENTS: 'documents',
  ACTIONS: 'actions',
  ACCESS: 'access',
} as const;

export type HistoryCategoryValue =
  (typeof HistoryCategory)[keyof typeof HistoryCategory];

const CATEGORY_BY_EVENT_TYPE: Record<string, HistoryCategoryValue> = {
  [PassportEventType.PASSPORT_CREATED]: HistoryCategory.INFORMATION,
  [PassportEventType.PASSPORT_CLAIM_SUBMITTED]: HistoryCategory.INFORMATION,
  [PassportEventType.OWNERSHIP_VERIFIED]: HistoryCategory.INFORMATION,
  [PassportEventType.OWNERSHIP_REJECTED]: HistoryCategory.INFORMATION,
  [PassportEventType.PASSPORT_ACTIVATED]: HistoryCategory.INFORMATION,
  [PassportEventType.PASSPORT_ARCHIVED]: HistoryCategory.INFORMATION,
  [PassportEventType.QUESTION_ANSWER_ADDED]: HistoryCategory.INFORMATION,
  [PassportEventType.QUESTION_ANSWER_CHANGED]: HistoryCategory.INFORMATION,
  [PassportEventType.QUESTION_ANSWER_CLEARED]: HistoryCategory.INFORMATION,
  [PassportEventType.SECTION_COMPLETED]: HistoryCategory.INFORMATION,

  [PassportEventType.DOCUMENT_UPLOADED]: HistoryCategory.DOCUMENTS,
  [PassportEventType.DOCUMENT_REPLACED]: HistoryCategory.DOCUMENTS,
  [PassportEventType.DOCUMENT_REMOVED]: HistoryCategory.DOCUMENTS,
  [PassportEventType.SOURCE_RECORD_IMPORTED]: HistoryCategory.DOCUMENTS,

  [PassportEventType.ACTION_CREATED]: HistoryCategory.ACTIONS,
  [PassportEventType.ACTION_SUPERSEDED]: HistoryCategory.ACTIONS,
  [PassportEventType.ACTION_REOPENED]: HistoryCategory.ACTIONS,
  [PassportEventType.ACTION_ADDRESSED]: HistoryCategory.ACTIONS,
  [PassportEventType.ACTION_EVIDENCE_ADDED]: HistoryCategory.ACTIONS,

  [PassportEventType.COLLABORATOR_INVITED]: HistoryCategory.ACCESS,
  [PassportEventType.COLLABORATOR_REMOVED]: HistoryCategory.ACCESS,
  [PassportEventType.COLLABORATOR_SCOPE_CHANGED]: HistoryCategory.ACCESS,
  [PassportEventType.SHARE_LINK_CREATED]: HistoryCategory.ACCESS,
  [PassportEventType.BUYER_ACCESS_GRANTED]: HistoryCategory.ACCESS,
  [PassportEventType.PASSPORT_PUBLISHED]: HistoryCategory.ACCESS,
  [PassportEventType.PASSPORT_UNPUBLISHED]: HistoryCategory.ACCESS,
  [PassportEventType.SECTION_VISIBILITY_CHANGED]: HistoryCategory.ACCESS,
};

export function categoryForEventType(
  eventType: string,
): HistoryCategoryValue | null {
  return CATEGORY_BY_EVENT_TYPE[eventType] ?? null;
}

export const EVENT_TYPES_BY_CATEGORY: Record<HistoryCategoryValue, string[]> =
  Object.entries(CATEGORY_BY_EVENT_TYPE).reduce(
    (acc, [type, category]) => {
      acc[category].push(type);
      return acc;
    },
    {
      [HistoryCategory.INFORMATION]: [] as string[],
      [HistoryCategory.DOCUMENTS]: [] as string[],
      [HistoryCategory.ACTIONS]: [] as string[],
      [HistoryCategory.ACCESS]: [] as string[],
    },
  );
