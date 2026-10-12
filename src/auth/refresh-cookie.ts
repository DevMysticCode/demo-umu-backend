import { ForbiddenException } from '@nestjs/common';
import { ALLOWED_ORIGINS } from '../common/cors-origins';

// The three frontends sharing this backend (umu-mobile-webapp,
// umu-website-new, umu-website-integration). Each gets its own refresh
// endpoint/cookie path so logging into one can never silently authenticate
// another, even on localhost where all three sit on the same host and
// cookies (unlike localStorage) don't partition by port.
export const UMU_APPS = ['mobile', 'website-new', 'integration'] as const;
export type UmuApp = (typeof UMU_APPS)[number];

export function isUmuApp(value: string | undefined): value is UmuApp {
  return !!value && (UMU_APPS as readonly string[]).includes(value);
}

export const REFRESH_COOKIE_NAME = 'umu_refresh';

// Browsers key a cookie by (name, domain, PATH) - same cookie name, three
// distinct paths, is three genuinely separate cookies. A request to
// /auth/refresh/mobile never carries the /auth/refresh/website-new cookie.
export function refreshCookiePath(app: UmuApp): string {
  return `/auth/refresh/${app}`;
}

export function refreshCookieOptions(app: UmuApp) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: refreshCookiePath(app),
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days, matching REFRESH_TOKEN_TTL_DAYS
  };
}

// CSRF defence for the cookie-authenticated routes (refresh/logout): the
// browser attaches the httpOnly cookie automatically on any request to
// this origin, including one forged by a malicious page, so Origin must be
// checked explicitly - CORS alone only blocks the ATTACKER PAGE from
// reading the response, not from sending the request in the first place.
export function assertTrustedOrigin(origin: string | undefined): void {
  if (!origin || !ALLOWED_ORIGINS().includes(origin)) {
    throw new ForbiddenException('Untrusted origin');
  }
}
