/**
 * Boot-time env validation.
 *
 * Called from main.ts before NestFactory.create. Fails the process with
 * a useful error if any required env var is missing or malformed —
 * better than discovering it at first request (or worse, at the moment
 * the OTP code is supposed to be sent and quietly hits console.log).
 *
 * Required vars are split by environment:
 *   - always required: DATABASE_URL, JWT_SECRET
 *   - required in production only: STRIPE_SECRET_KEY, RESEND_API_KEY,
 *     ADMIN_SECRET, CORS_ORIGINS
 *   - warned-but-allowed in dev: GROQ_API_KEY, GOOGLE_API_KEY, etc.
 *
 * Validation uses plain checks (no class-validator dep) so it works
 * before Nest's DI container exists.
 */
type EnvCheck = {
  name: string;
  description: string;
  /** When true, only required in production. */
  prodOnly?: boolean;
  /** Optional value validator beyond "is present". */
  shape?: (v: string) => string | null;
};

const checks: EnvCheck[] = [
  {
    name: 'DATABASE_URL',
    description: 'PostgreSQL connection string (Railway / local Postgres)',
    shape: (v) =>
      /^postgres(ql)?:\/\//.test(v) ? null : "must start with postgres:// or postgresql://",
  },
  {
    name: 'JWT_SECRET',
    description: 'HMAC secret for signing user JWTs',
    shape: (v) =>
      v.length >= 16 ? null : 'must be at least 16 characters (32+ recommended)',
  },
  // Production-only — dev/test environments commonly run without
  // these and we don't want CI or local seeds to require them.
  {
    name: 'STRIPE_SECRET_KEY',
    description: 'Stripe secret key (sk_test_* in dev, sk_live_* in prod)',
    prodOnly: true,
    shape: (v) =>
      v.startsWith('sk_test_') || v.startsWith('sk_live_')
        ? null
        : "must start with sk_test_ or sk_live_",
  },
  {
    name: 'STRIPE_WEBHOOK_SECRET',
    description: 'Stripe webhook endpoint secret (whsec_*) for signature verification',
    prodOnly: true,
    shape: (v) =>
      v.startsWith('whsec_') ? null : "must start with whsec_",
  },
  {
    name: 'RESEND_API_KEY',
    description: 'Resend API key for transactional email (OTPs)',
    prodOnly: true,
  },
  {
    name: 'ADMIN_SECRET',
    description: 'Shared secret for maintenance + verifier admin endpoints',
    prodOnly: true,
    shape: (v) =>
      v !== '123' && v.length >= 16
        ? null
        : 'must be at least 16 characters and not the placeholder "123"',
  },
  {
    name: 'CORS_ORIGINS',
    description: 'Comma-separated CORS allow-list (no trailing slash)',
    prodOnly: true,
  },
  // Missing/wrong in production silently ships broken file links —
  // it gets baked into every disk-mode upload's fileUrl at upload
  // time (question.service.ts), with no validation catching it
  // before then. Confirmed live: GSR/EICR/EPC "View" all 404'd
  // because this defaulted to the http://localhost:3002 dev fallback
  // in production. uploadsPathFrom (common/storage.ts) makes already-
  // stored bad rows recoverable without a migration, but this check
  // stops it happening again going forward.
  {
    name: 'BASE_URL',
    description: 'Public base URL of this API (e.g. https://api.umovingu.com) - never localhost in production',
    prodOnly: true,
    shape: (v) =>
      /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(v)
        ? 'must not point at localhost in production'
        : v.startsWith('http://') || v.startsWith('https://')
          ? null
          : 'must start with http:// or https://',
  },
];

export function validateEnv(env: NodeJS.ProcessEnv): void {
  const isProd = env.NODE_ENV === 'production';
  const errors: string[] = [];

  for (const check of checks) {
    if (check.prodOnly && !isProd) continue;

    const value = env[check.name];
    if (!value || !value.trim()) {
      errors.push(`  - ${check.name} is missing (${check.description})`);
      continue;
    }
    if (check.shape) {
      const shapeErr = check.shape(value);
      if (shapeErr) errors.push(`  - ${check.name} ${shapeErr}`);
    }
  }

  if (errors.length) {
    // Avoid printing values — only names. Anything else would risk
    // logging a secret if someone pastes the boot output into Slack.
    // eslint-disable-next-line no-console
    console.error(
      `\n[env] Boot aborted - ${errors.length} environment issue(s):\n${errors.join('\n')}\n`,
    );
    process.exit(1);
  }
}
