import { isWithinCollaboratorScope } from './collaborator-scope';

describe('isWithinCollaboratorScope', () => {
  it('allows everything when sectionKeys is null (unrestricted collaborator)', () => {
    expect(isWithinCollaboratorScope(null, null, 'boundaries', 'task-1')).toBe(true);
  });

  it('allows everything when sectionKeys is undefined', () => {
    expect(isWithinCollaboratorScope(undefined, undefined, 'boundaries', 'task-1')).toBe(true);
  });

  // Regression guard: security review 14 Oct 2026 - an earlier version
  // checked `sectionKeys && sectionKeys.length > 0`, which treated an
  // EMPTY array the same as null (full access) instead of "no sections
  // granted". This must deny, matching PassportService.
  // getPassportSections' `key: { in: [] }` reference behavior.
  it('DENIES every section when sectionKeys is an empty array', () => {
    expect(isWithinCollaboratorScope([], null, 'boundaries', 'task-1')).toBe(false);
    expect(isWithinCollaboratorScope([], null, null, null)).toBe(false);
  });

  it('allows only the listed sections', () => {
    expect(isWithinCollaboratorScope(['boundaries'], null, 'boundaries', 'task-1')).toBe(true);
    expect(isWithinCollaboratorScope(['boundaries'], null, 'disputes', 'task-1')).toBe(false);
  });

  it('denies when sectionKey is missing but sectionKeys is restricted', () => {
    expect(isWithinCollaboratorScope(['boundaries'], null, null, 'task-1')).toBe(false);
    expect(isWithinCollaboratorScope(['boundaries'], null, undefined, 'task-1')).toBe(false);
  });

  it('allows every task in an allowed section when taskKeys has no entry for it', () => {
    expect(
      isWithinCollaboratorScope(['boundaries'], { disputes: ['t1'] }, 'boundaries', 'any-task'),
    ).toBe(true);
  });

  it('narrows to only the listed tasks when taskKeys has an entry for the section', () => {
    expect(
      isWithinCollaboratorScope(['boundaries'], { boundaries: ['t1'] }, 'boundaries', 't1'),
    ).toBe(true);
    expect(
      isWithinCollaboratorScope(['boundaries'], { boundaries: ['t1'] }, 'boundaries', 't2'),
    ).toBe(false);
  });

  it('DENIES when the section is task-restricted to an empty list', () => {
    expect(
      isWithinCollaboratorScope(['boundaries'], { boundaries: [] }, 'boundaries', 't1'),
    ).toBe(false);
  });
});
