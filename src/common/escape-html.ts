// Escapes a string for safe interpolation into an HTML email template.
// User-controlled free text (a buyer's contact message, a profile name)
// was previously interpolated into outbound HTML emails unescaped - a
// crafted value could inject arbitrary markup/links into an email sent
// under the UMovingU brand to another user (security review, 14 Oct
// 2026). Also strips CR/LF so the same value can't be used to inject
// extra headers if it's ever placed in a `subject` line instead of the
// HTML body - Resend itself may already guard against this, but there's
// no reason to depend on that.
export function escapeForEmail(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/[\r\n]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// For an email SUBJECT line specifically - just strips CR/LF (the actual
// header-injection vector) rather than HTML-encoding, since a subject
// isn't HTML and encoding it would show literal "&amp;" etc. to the
// recipient. firstName/lastName (register.dto.ts, update-profile.dto.ts)
// have no control-character restriction, and flow into several
// collaborator-invite/share email subjects (security review, 14 Oct
// 2026).
export function sanitizeForEmailSubject(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/[\r\n]/g, ' ');
}
