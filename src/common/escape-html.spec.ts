import { escapeForEmail, sanitizeForEmailSubject } from './escape-html';

describe('escapeForEmail', () => {
  it('escapes HTML special characters', () => {
    expect(escapeForEmail('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('escapes quotes and ampersands', () => {
    expect(escapeForEmail(`"O'Brien" & Co`)).toBe('&quot;O&#39;Brien&quot; &amp; Co');
  });

  it('strips CR/LF (header-injection vector)', () => {
    expect(escapeForEmail('John\r\nBcc: attacker@evil.com')).not.toMatch(/[\r\n]/);
  });

  it('returns empty string for null/undefined/empty input', () => {
    expect(escapeForEmail(null)).toBe('');
    expect(escapeForEmail(undefined)).toBe('');
    expect(escapeForEmail('')).toBe('');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeForEmail('John Smith')).toBe('John Smith');
  });
});

describe('sanitizeForEmailSubject', () => {
  it('strips CR/LF without HTML-encoding', () => {
    expect(sanitizeForEmailSubject('John\r\nBcc: attacker@evil.com')).not.toMatch(/[\r\n]/);
  });

  it('does not HTML-encode ampersands/quotes', () => {
    expect(sanitizeForEmailSubject('Smith & Co')).toBe('Smith & Co');
  });
});
