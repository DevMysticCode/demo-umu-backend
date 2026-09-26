// Single source of truth for the CORS allow-list, shared between main.ts
// (actual CORS enforcement) and frontend-url.ts (deciding which origin a
// generated share/sign link is allowed to point back at) — these two lists
// must never drift apart, since frontend-url.ts's whole safety property is
// "only ever reflect an origin CORS already trusts".
export const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'https://demo-umu-frontend.vercel.app',
  'capacitor://localhost', // iOS Capacitor webview
  'ionic://localhost',     // legacy Capacitor scheme on Android
  'http://localhost',
  'https://localhost',
];

export function ALLOWED_ORIGINS(): string[] {
  const configured = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ORIGINS;
}
