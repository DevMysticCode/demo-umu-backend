import { timingSafeEqual } from 'crypto';

// Constant-time string comparison for secret checks (x-admin-secret,
// x-client-secret headers etc). A plain `a !== b` short-circuits on the
// first differing byte, which is a (theoretical, but real) remote timing
// side-channel — this was copy-pasted across 5 controllers before being
// consolidated here (security review 2026-09-22, H10).
//
// timingSafeEqual throws on mismatched buffer lengths rather than
// returning false, so unequal-length inputs (the common case — a wrong
// guess is almost never exactly the right length) are handled explicitly
// before calling it, and are still rejected without leaking the correct
// length via a thrown-vs-returned distinction. Both operands are always
// converted to buffers first so `undefined`/missing headers can't throw.
export function timingSafeStringEqual(
  a: string | undefined | null,
  b: string | undefined | null,
): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
