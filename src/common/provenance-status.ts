// Provenance/assurance status for Vault documents (client feedback,
// 2026-11-19: "The Passport must distinguish between information that has
// been uploaded and information that has actually been checked" + the
// doc's suggested customer-facing statuses). Computed at read time, never
// stored as its own column — it's derived from fields that already have a
// single source of truth (expiresAt, verifiedAt, category), so there's
// nothing to keep in sync.
//
// "Checked" here is an owner SELF-check, not independent/professional
// verification — the doc's own wording must stay accurate to what this
// actually is. A future professional-review tier (admin/conveyancer
// confirms) can sit alongside this without a schema change: it would just
// be a different source for the same `verifiedAt`/`verifiedByUserId`
// pair, or a second pair of columns if self-check and professional-check
// need to be distinguished later.
//
// "Source confirmed" exists for forward-compatibility only right now —
// nothing in this codebase currently auto-fills a Passport answer from
// Property/EPC/Land Registry data, so no write path sets sourceType to
// SOURCE_IMPORT yet. It's wired through so that whenever such a prefill
// feature is built, it only needs to set this field, not touch the status
// logic.
export type ProvenanceStatus =
  | 'added_by_homeowner'
  | 'source_confirmed'
  | 'checked'
  | 'needs_checking'
  | 'expired';

export const PROVENANCE_STATUS_LABELS: Record<ProvenanceStatus, string> = {
  added_by_homeowner: 'Added by homeowner',
  source_confirmed: 'Source confirmed',
  checked: 'Checked',
  needs_checking: 'Needs checking',
  expired: 'Expired',
};

// Vault categories with real regulatory/safety weight (EPC, EICR, Gas
// Safety and other compliance certs) default to "Needs checking" until
// the owner explicitly confirms them — everything else (photos, manuals,
// appliance warranties, etc.) has no checking concept and stays
// "Added by homeowner" until expiry. See VAULT_CATEGORIES in
// documents.service.ts for the full category list.
export const NEEDS_CHECKING_CATEGORIES = new Set(['compliance', 'energy_utilities']);

// "Home records" (files attached as the answer to a passport question,
// e.g. an EICR/Gas Safety cert uploaded inside a task) aren't filed into
// the Vault's category system at all — they live under a PassportSection
// instead. These two section keys are that flow's equivalent of the
// compliance/energy_utilities vault categories above (environmental =
// flood risk/knotweed/subsidence, services = heating/utility connections),
// so they drive the same "needs checking" default for home records.
export const NEEDS_CHECKING_SECTION_KEYS = new Set(['environmental', 'services']);

export function computeProvenanceStatus(input: {
  expiresAt?: Date | null;
  verifiedAt?: Date | null;
  sourceType?: string | null;
  category?: string | null;
  sectionKey?: string | null;
}): ProvenanceStatus {
  if (input.expiresAt && input.expiresAt.getTime() < Date.now()) return 'expired';
  if (input.verifiedAt) return 'checked';
  if (input.sourceType === 'SOURCE_IMPORT') return 'source_confirmed';
  if (input.category && NEEDS_CHECKING_CATEGORIES.has(input.category)) return 'needs_checking';
  if (input.sectionKey && NEEDS_CHECKING_SECTION_KEYS.has(input.sectionKey)) return 'needs_checking';
  return 'added_by_homeowner';
}

export function provenanceStatusLabel(input: {
  expiresAt?: Date | null;
  verifiedAt?: Date | null;
  sourceType?: string | null;
  category?: string | null;
  sectionKey?: string | null;
}): string {
  return PROVENANCE_STATUS_LABELS[computeProvenanceStatus(input)];
}
