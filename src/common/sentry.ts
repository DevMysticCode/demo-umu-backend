import * as Sentry from '@sentry/node';

/**
 * Sentry initialisation — env-driven, no-op when SENTRY_DSN is unset.
 *
 * Wiring:
 *   1. main.ts calls initSentry() BEFORE NestFactory.create — Sentry's
 *      auto-instrumentation needs to monkey-patch http/express before
 *      Nest constructs the app.
 *   2. AllExceptionsFilter captures unhandled errors and routes the
 *      generic-500 path through Sentry.captureException (gated on
 *      isSentryEnabled() so the call is a literal no-op when disabled).
 *
 * What we DON'T do:
 *   - Capture HttpException (400/401/403/404 are intentional, not bugs).
 *   - Capture Prisma known errors (P2002 unique violation, P2025 not
 *     found, etc. — also intentional).
 *   - Send any request body, headers, or query params. PII protection
 *     is opt-in via Sentry SDK config (`sendDefaultPii: false`).
 */

let initialised = false;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || !dsn.trim()) return;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENV ?? process.env.NODE_ENV ?? 'development',
    // Release tag — set to your build SHA on Railway so source maps
    // and issue grouping line up across deploys. Falls back to package
    // version when CI/Railway hasn't injected one.
    release: process.env.SENTRY_RELEASE,
    // Trace sample rate — keep low in prod; 0 means errors only.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),
    // Don't send IP addresses, cookies, or user agents by default.
    sendDefaultPii: false,
  });

  initialised = true;
  // eslint-disable-next-line no-console
  console.log(`[sentry] enabled for env="${process.env.SENTRY_ENV ?? process.env.NODE_ENV}"`);
}

export function isSentryEnabled(): boolean {
  return initialised;
}

/**
 * Forward a caught exception to Sentry if it's been initialised.
 * Safe to call unconditionally — when Sentry is off this is a no-op.
 *
 * Use from the global exception filter (already wired) — not from
 * service-level catches, where you usually want to throw rather than
 * silently report.
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!initialised) return;
  if (context) {
    Sentry.withScope((scope) => {
      for (const [k, v] of Object.entries(context)) scope.setContext(k, { value: v });
      Sentry.captureException(err);
    });
  } else {
    Sentry.captureException(err);
  }
}
