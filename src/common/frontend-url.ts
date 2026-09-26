// Resolves which public frontend URL a user-facing link (share link,
// tenancy-sign link, email link) should point to.
//
// The product runs on more than one web frontend at once (currently two
// Vercel/custom-domain deployments, per the CORS_ORIGINS allow-list) plus a
// native iOS app — there is no single correct "the frontend" any more, so a
// static FRONTEND_URL env var can't be right for every caller. Instead:
// prefer the *requesting client's own Origin*, if it's one of the web
// origins we already trust (the same CORS_ORIGINS allow-list, so this can't
// be spoofed to point a generated link at an arbitrary attacker-controlled
// domain), and only fall back to a configured default when there's no
// usable web origin to reflect back — e.g. a request from the iOS app
// (Origin is a non-web scheme like `capacitor://localhost`, or absent
// entirely), where the generated link still needs to be a real web URL
// since the recipient is typically an external buyer/tenant with no app.
import { ALLOWED_ORIGINS } from './cors-origins';

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

// Origins that are real, public, shareable web destinations — excludes
// native-app schemes (capacitor://, ionic://) and the bare `http(s)://
// localhost` placeholders used as a webview's origin on-device (per
// DEPLOYMENT.md: "https://localhost — Android bundled-mode default
// scheme"), neither of which resolve to anything if a recipient without
// the app opens them.
function isShareableWebOrigin(origin: string): boolean {
  if (!/^https?:\/\//.test(origin)) return false;
  const withoutScheme = origin.replace(/^https?:\/\//, '');
  const host = withoutScheme.split(/[/:]/)[0];
  return host !== 'localhost' && host !== '127.0.0.1';
}

export function resolveFrontendBaseUrl(requestOrigin?: string | null): string {
  const allowed = ALLOWED_ORIGINS();
  if (requestOrigin) {
    const normalized = stripTrailingSlash(requestOrigin.trim());
    if (allowed.includes(normalized) && isShareableWebOrigin(normalized)) {
      return normalized;
    }
  }

  const configuredDefault = process.env.FRONTEND_URL;
  if (configuredDefault) return stripTrailingSlash(configuredDefault);

  return process.env.NODE_ENV === 'production'
    ? 'https://demo-umu-frontend.vercel.app'
    : 'http://localhost:3000';
}
