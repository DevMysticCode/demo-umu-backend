// Regression coverage for the rate-limit gaps found and fixed in the
// 2026-10-19 security review: three endpoints that mint a paid Stripe
// PaymentIntent, hold a long-lived B2B credential, or reveal whether an
// arbitrary email has an account, and previously relied on only the
// generous global default (300 req/min/IP in prod) instead of an
// endpoint-specific throttle. This doesn't exercise real rate-limiting
// behaviour (that needs a live ThrottlerGuard + storage, out of scope for
// a unit test) — it asserts the @Throttle() metadata that actually gates
// the request rate is present with the expected limit, so a future edit
// that accidentally removes the decorator fails CI instead of silently
// reopening the gap.
import 'reflect-metadata';
import { PassportController } from '../passport/passport.controller';
import { MarketplaceController } from '../marketplace/marketplace.controller';
import { VerifierPublicController } from '../verifier-api/verifier-api.controller';

const THROTTLER_LIMIT_DEFAULT = 'THROTTLER:LIMITdefault';

describe('Throttle regression — 2026-10-19 security review', () => {
  it('passport.controller checkCollaboratorEmail stays throttled (email-enumeration oracle)', () => {
    const limit = Reflect.getMetadata(
      THROTTLER_LIMIT_DEFAULT,
      PassportController.prototype.checkCollaboratorEmail,
    );
    expect(limit).toBe(15);
  });

  it('marketplace.controller authorizeOffer stays throttled (mints a Stripe PaymentIntent)', () => {
    const limit = Reflect.getMetadata(
      THROTTLER_LIMIT_DEFAULT,
      MarketplaceController.prototype.authorizeOffer,
    );
    expect(limit).toBe(10);
  });

  it('verifier-api VerifierPublicController stays throttled (B2B credential + consent-email endpoint)', () => {
    const limit = Reflect.getMetadata(THROTTLER_LIMIT_DEFAULT, VerifierPublicController);
    expect(limit).toBe(20);
  });
});
