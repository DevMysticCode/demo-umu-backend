/**
 * Regression guard for the synthetic title-number bug (DF4 follow-up).
 *
 * Until commit <removed-synthesiser>, property.service.ts generated a
 * fake HMLR title number for every property that didn't have one. That
 * value got displayed as if it were real (claim page, buyer view, TA6
 * PDF) AND poisoned HMLR ownership lookups (queried the fake number,
 * got NO_MATCHES, failed verification on properties owners actually
 * own).
 *
 * If anyone re-introduces it — by name or by shape — this test fails
 * the build.
 *
 * If you're reading this because the test failed: don't restore the
 * old behaviour. The only valid path to populating Property.titleNumber
 * is through verifyOwnershipWithLandRegistry promoting a HMLR-returned
 * value on a VERIFIED match. See the comment block at that method.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

describe('no synthetic title-number generation', () => {
  const source = readFileSync(
    join(__dirname, 'property.service.ts'),
    'utf8',
  );

  it('does not declare a generateTitleNumber method', () => {
    expect(source).not.toMatch(/generateTitleNumber\s*\(/);
  });

  it('does not synthesise titleNumber from postcode + UPRN/hash inline', () => {
    // The shape: `${postcode...substring(0, 2)...}${...uprn...padStart(6, '0')}`
    // appeared in 3 places. Banning the padStart(6, '0') signature on a
    // titleNumber assignment is a precise enough catch.
    expect(source).not.toMatch(
      /titleNumber\s*[:=][\s\S]{0,200}padStart\(6,\s*['"]0['"]\)/,
    );
  });

  it('still has the HMLR-promotion path that writes a real titleNumber back', () => {
    // Sanity check on the legitimate write site so a careless cleanup
    // doesn't take the real path out along with the synthetic one.
    expect(source).toMatch(/topMatch\.titleNumber/);
    expect(source).toMatch(/Property\.titleNumber|data:\s*\{\s*titleNumber/);
  });
});
