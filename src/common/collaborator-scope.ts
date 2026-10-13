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
  if (sectionKeys && sectionKeys.length > 0) {
    if (!sectionKey || !sectionKeys.includes(sectionKey)) return false;
  }
  if (taskKeys && sectionKey && taskKeys[sectionKey]) {
    if (!taskKey || !taskKeys[sectionKey].includes(taskKey)) return false;
  }
  return true;
}
