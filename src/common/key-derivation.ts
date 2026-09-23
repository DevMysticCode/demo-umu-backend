import { createHash, createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'crypto';

// Every secret-derived key in this codebase (file-serving HMAC signatures,
// verifier-api access-token encryption, ...) used to just read
// `process.env.JWT_SECRET` directly - convenient (one fewer required env
// var), but it means compromising any one of those features' key material
// compromises the others too, and there's no way to rotate one without
// rotating all of them (and every outstanding JWT) at once (security
// review 2026-09-22, L4). HKDF here derives cryptographically independent
// 32-byte subkeys from the same root secret, one per named use - each
// `info` string below should be unique and never reused for a different
// purpose.
function deriveKey(info: string): Buffer {
  const root = process.env.JWT_SECRET;
  if (!root) throw new Error('JWT_SECRET is not set');
  // HKDF-SHA256, no salt (root secret is already high-entropy and secret;
  // the `info` label is what separates purposes, not a salt).
  return Buffer.from(hkdfSync('sha256', root, '', info, 32));
}

export function deriveHmacKey(purpose: string): Buffer {
  return deriveKey(`umu-hmac:${purpose}`);
}

// ── Reversible token encryption (AES-256-GCM) ───────────────────────────
//
// For values that must be readable back in their original form by a
// legitimate caller (e.g. a verifier-api access token, re-served on every
// status poll) - unlike a password or a bearer token used purely for
// equality-checked lookup, which should be hashed, never encrypted (see
// hashLookupToken below).
//
// Packed format: base64(iv) + '.' + base64(authTag) + '.' + base64(ciphertext)

export function encryptForPurpose(purpose: string, plaintext: string): string {
  const key = deriveKey(`umu-enc:${purpose}`);
  const iv = randomBytes(12); // GCM standard nonce size
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decryptForPurpose(purpose: string, packed: string): string {
  const key = deriveKey(`umu-enc:${purpose}`);
  const [ivB64, tagB64, ctB64] = packed.split('.');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed encrypted value');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ── One-way hash for equality-checked lookups ───────────────────────────
//
// For a high-entropy, server-generated bearer token that's looked up by
// exact match on every authenticated request (e.g. AccessGrant.accessToken)
// - unlike a user-chosen password, a token like this never needs the
// slow/salted hashing bcrypt/scrypt exist for (it's not guessable by
// brute force to begin with; the whole point of a plain SHA-256 here is a
// deterministic, indexable digest for a fast unique-column lookup, not
// resistance to offline cracking).
export function hashLookupToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
