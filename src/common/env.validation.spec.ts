import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  let exitSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    // process.exit throws so jest sees control return — without this
    // override the test process itself would die when validation fails.
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as any);
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('passes when DATABASE_URL + JWT_SECRET are valid (dev)', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://u:p@h:5432/d',
        JWT_SECRET: 'sixteen_chars_minimum_for_secret',
      } as any),
    ).not.toThrow();
  });

  it('exits on missing DATABASE_URL', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        JWT_SECRET: 'sixteen_chars_minimum_for_secret',
      } as any),
    ).toThrow('process.exit(1)');
    const printed = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('DATABASE_URL is missing');
  });

  it('rejects malformed DATABASE_URL (wrong scheme)', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'mysql://u:p@h:3306/d',
        JWT_SECRET: 'sixteen_chars_minimum_for_secret',
      } as any),
    ).toThrow('process.exit(1)');
    const printed = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('postgres');
  });

  it('rejects JWT_SECRET shorter than 16 chars', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://u:p@h:5432/d',
        JWT_SECRET: 'too_short',
      } as any),
    ).toThrow('process.exit(1)');
    const printed = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('JWT_SECRET');
    expect(printed).toContain('16');
  });

  it('skips prod-only checks when not production', () => {
    // STRIPE_SECRET_KEY, RESEND_API_KEY, ADMIN_SECRET, CORS_ORIGINS
    // are all prodOnly — should not be required here.
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://u:p@h:5432/d',
        JWT_SECRET: 'sixteen_chars_minimum_for_secret',
      } as any),
    ).not.toThrow();
  });

  it('enforces ADMIN_SECRET ≥ 16 chars and not "123" in production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@h:5432/d',
        JWT_SECRET: 'sixteen_chars_minimum_for_secret',
        STRIPE_SECRET_KEY: 'sk_test_x',
        STRIPE_WEBHOOK_SECRET: 'whsec_x',
        RESEND_API_KEY: 'real_key',
        ADMIN_SECRET: '123',
        CORS_ORIGINS: 'https://x.com',
      } as any),
    ).toThrow('process.exit(1)');
    const printed = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('ADMIN_SECRET');
  });

  it('rejects malformed Stripe key in production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@h:5432/d',
        JWT_SECRET: 'sixteen_chars_minimum_for_secret',
        STRIPE_SECRET_KEY: 'wrong_prefix',
        STRIPE_WEBHOOK_SECRET: 'whsec_x',
        RESEND_API_KEY: 'real_key',
        ADMIN_SECRET: 'sixteen_chars_minimum_for_secret',
        CORS_ORIGINS: 'https://x.com',
      } as any),
    ).toThrow('process.exit(1)');
    const printed = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('STRIPE_SECRET_KEY');
  });

  it('rejects malformed STRIPE_WEBHOOK_SECRET in production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@h:5432/d',
        JWT_SECRET: 'sixteen_chars_minimum_for_secret',
        STRIPE_SECRET_KEY: 'sk_test_x',
        STRIPE_WEBHOOK_SECRET: 'not_a_real_webhook_secret',
        RESEND_API_KEY: 'real_key',
        ADMIN_SECRET: 'sixteen_chars_minimum_for_secret',
        CORS_ORIGINS: 'https://x.com',
      } as any),
    ).toThrow('process.exit(1)');
    const printed = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('STRIPE_WEBHOOK_SECRET');
  });
});
