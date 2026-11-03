import { createHash, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

// Gates /docs + /docs-json behind HTTP Basic Auth. Swagger lists every
// route, param and DTO shape for an API handling passports, documents
// and buyer financial data — real information-disclosure surface if
// left open (same class of concern as the 2026-09-22/2026-10-19
// security review findings), so a production deploy that turns
// SWAGGER_ENABLED on for a one-off review must not also leave it
// unauthenticated.
//
// Credentials are compared as fixed-length SHA-256 digests rather than
// the raw strings so timingSafeEqual (which throws on length mismatch)
// never leaks length via early-exit, and so a wrong-length guess can't
// bypass the constant-time comparison entirely.
export function swaggerBasicAuth(username: string, password: string) {
  const expectedUser = createHash('sha256').update(username).digest();
  const expectedPass = createHash('sha256').update(password).digest();

  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      if (sep !== -1) {
        const user = createHash('sha256').update(decoded.slice(0, sep)).digest();
        const pass = createHash('sha256').update(decoded.slice(sep + 1)).digest();
        if (timingSafeEqual(user, expectedUser) && timingSafeEqual(pass, expectedPass)) {
          return next();
        }
      }
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="UmovingU API Docs"');
    res.status(401).send('Authentication required');
  };
}
