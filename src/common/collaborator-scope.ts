// Shared "is this section/task within what this collaborator was granted"
// check. Mirrors the scoping semantics PassportService.getPassportSections
// already implements for the main passport view (sectionKeys null = every
// section; taskKeys has no entry for a section = every task in that
// section) - pulled out here so documents.service.ts and files.service.ts
// can apply the SAME scoping instead of their previous coarse "is this
// user a collaborator at all" check, which let a collaborator scoped to
// one section read/download files from every other section too (security
// review, 13 Oct 2026).
export function isWithinCollaboratorScope(
  sectionKeys: string[] | null | undefined,
  taskKeys: Record<string, string[]> | null | undefined,
  sectionKey: string | null | undefined,
  taskKey: string | null | undefined,
): boolean {
  // != null (not the `&& sectionKeys.length > 0` this originally had) -
  // an EMPTY array must deny every section, matching
  // PassportService.getPassportSections' `new Set(collaboratorRow.
  // sectionKeys)` → `key: { in: [...set] }` reference behavior, where
  // `key: { in: [] }` matches nothing. The `.length > 0` guard instead
  // treated `sectionKeys: []` the same as `null` ("every section
  // allowed") - a collaborator an owner restricted to zero sections
  // could still read/download every file/document via the Vault
  // endpoints that call this function (security review, 14 Oct 2026 -
  // this inverted the exact bug the 13 Oct fix was meant to close).
  if (sectionKeys != null) {
    if (!sectionKey || !sectionKeys.includes(sectionKey)) return false;
  }
  if (taskKeys && sectionKey && taskKeys[sectionKey]) {
    if (!taskKey || !taskKeys[sectionKey].includes(taskKey)) return false;
  }
  return true;
}
