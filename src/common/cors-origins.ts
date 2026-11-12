// Single source of truth for the CORS allow-list, shared between main.ts
// (actual CORS enforcement) and frontend-url.ts (deciding which origin a
// generated share/sign link is allowed to point back at) — these two lists
// must never drift apart, since frontend-url.ts's whole safety property is
// "only ever reflect an origin CORS already trusts".
//
// Origins real deployed clients (web + mobile) legitimately use in any
// environment, production included — the Capacitor/Ionic webview schemes
// and the bare localhost origins are how the *native app* identifies
// itself, not a developer's browser (security/launch review finding #9).
const PROD_SAFE_ORIGINS = [
  'https://demo-umu-frontend.vercel.app',
  'capacitor://localhost', // iOS Capacitor webview
  'ionic://localhost',     // legacy Capacitor scheme on Android
  'http://localhost',      // iOS Capacitor bundled-mode default scheme
  'https://localhost',     // Android Capacitor bundled-mode default scheme
];

// A developer's own browser hitting a local Nuxt dev server — never valid
// for a real deployed backend, so these must not leak into a production
// allow-list default (finding #9: prod was allowing requests from
// `http://localhost:3000-3003` web pages).
const DEV_ONLY_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
];

export const DEFAULT_ORIGINS =
  process.env.NODE_ENV === 'production'
    ? PROD_SAFE_ORIGINS
    : [...PROD_SAFE_ORIGINS, ...DEV_ONLY_ORIGINS];

export function ALLOWED_ORIGINS(): string[] {
  const configured = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ORIGINS;
}
