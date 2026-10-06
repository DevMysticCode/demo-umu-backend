import { computeValuation, WorkTypeRef, DeclaredWork } from './truevalue-engine';

// Golden tests from umu-truevalue-backend-integration.md §10.

const BASELINE = 450000;

const CATALOGUE: WorkTypeRef[] = [
  { code: 'ext-rear', category: 'capital', tier: 1, upliftLow: 0.05, upliftHigh: 0.11, isMinor: false, epcAssessed: false },
  { code: 'kitchen', category: 'capital', tier: 1, upliftLow: 0.05, upliftHigh: 0.1, isMinor: false, epcAssessed: false },
  { code: 'boiler', category: 'condition', tier: 1, upliftLow: null, upliftHigh: null, isMinor: false, epcAssessed: true },
  { code: 'roof', category: 'condition', tier: 1, upliftLow: null, upliftHigh: null, isMinor: false, epcAssessed: true },
  { code: 'solar', category: 'energy', tier: 1, upliftLow: null, upliftHigh: null, isMinor: false, epcAssessed: true },
  { code: 'loft-insul', category: 'energy', tier: 1, upliftLow: null, upliftHigh: null, isMinor: false, epcAssessed: true },
  { code: 'planning', category: 'consent', tier: 1, upliftLow: 0.02, upliftHigh: 0.05, isMinor: false, epcAssessed: false },
  // tier-3 "recorded only" certificates — must never move the estimate
  { code: 'boiler-move', category: 'condition', tier: 3, upliftLow: null, upliftHigh: null, isMinor: false, epcAssessed: false },
  { code: 'jacket', category: 'energy', tier: 3, upliftLow: null, upliftHigh: null, isMinor: false, epcAssessed: true },
  { code: 'int-doors', category: 'condition', tier: 3, upliftLow: null, upliftHigh: null, isMinor: false, epcAssessed: false },
  // tier-2 "de-risks, no uplift" item
  { code: 'water-main', category: 'condition', tier: 2, upliftLow: null, upliftHigh: null, isMinor: false, epcAssessed: false },
];

function work(code: string, state: DeclaredWork['verificationState']): DeclaredWork {
  return { workTypeCode: code, verificationState: state };
}

describe('computeValuation golden tests', () => {
  test('1. record-only (tier 3) items score nothing, even ten of them verified', () => {
    const tier3Codes = ['boiler-move', 'jacket', 'int-doors'];
    // repeat the same 3 tier-3 codes isn't meaningful (works are per-code),
    // so declare all tier-3 rows in the catalogue, all verified.
    const works = tier3Codes.map((c) => work(c, 'verified'));
    const r = computeValuation({ baseline: BASELINE, works, workTypes: CATALOGUE, epcStatus: 'current' });
    expect(r.contributions.capital).toEqual([0, 0]);
    expect(r.contributions.condition).toEqual([0, 0]);
    expect(r.contributions.consent).toEqual([0, 0]);
    expect(r.estimatePoint).toBe(BASELINE);
    expect(r.provedCount).toBe(0);
    expect(r.scoringCount).toBe(0);
    expect(r.recorded).toBe(tier3Codes.length);
  });

  test('2. record-only items cannot tighten the confidence band', () => {
    const empty = computeValuation({ baseline: BASELINE, works: [], workTypes: CATALOGUE, epcStatus: 'current' });
    const withTier3 = computeValuation({
      baseline: BASELINE,
      works: ['boiler-move', 'jacket', 'int-doors'].map((c) => work(c, 'verified')),
      workTypes: CATALOGUE,
      epcStatus: 'current',
    });
    expect(withTier3.estimateHigh - withTier3.estimateLow).toBe(empty.estimateHigh - empty.estimateLow);
    expect(withTier3.confidence).toBe(empty.confidence);
  });

  test('3. tier 2 adds no uplift but counts toward proved and derisked', () => {
    const r = computeValuation({
      baseline: BASELINE,
      works: [work('water-main', 'verified')],
      workTypes: CATALOGUE,
      epcStatus: 'current',
    });
    expect(r.contributions.condition).toEqual([0, 0]);
    expect(r.estimatePoint).toBe(BASELINE);
    expect(r.scoringCount).toBe(1); // tier 2 counts toward "scoring" (proved denominator)
    expect(r.provedCount).toBe(1); // verified
    expect(r.derisked).toBe(1);
  });

  test('4. stale EPC suppresses energy uplift but still feeds the condition tier', () => {
    const current = computeValuation({
      baseline: BASELINE,
      works: [work('solar', 'verified')],
      workTypes: CATALOGUE,
      epcStatus: 'current',
    });
    const stale = computeValuation({
      baseline: BASELINE,
      works: [work('solar', 'verified')],
      workTypes: CATALOGUE,
      epcStatus: 'stale',
    });
    expect(current.epcSuppressed).toBe(false);
    expect(current.contributions.epc[0]).toBeGreaterThan(0);
    expect(stale.epcSuppressed).toBe(true);
    expect(stale.contributions.epc).toEqual([0, 0]);
    // still contributes to the condition tier at a reduced (flat 0.28) weight,
    // so the stale run isn't identical to having no energy works at all
    const none = computeValuation({ baseline: BASELINE, works: [], workTypes: CATALOGUE, epcStatus: 'stale' });
    expect(stale.contributions.condition).not.toEqual(none.contributions.condition);
  });

  test('5. global 30% cap holds even with everything verified', () => {
    const works = CATALOGUE.filter((w) => w.tier === 1 || w.tier === 2).map((w) =>
      work(w.code, 'verified'),
    );
    const r = computeValuation({ baseline: BASELINE, works, workTypes: CATALOGUE, epcStatus: 'current' });
    const upliftLow = r.estimatePoint / BASELINE - 1;
    expect(upliftLow).toBeLessThanOrEqual(0.30001);
  });

  test('6. diminishing returns apply to stacked capital works but not the condition tier', () => {
    const oneCapital = computeValuation({
      baseline: BASELINE,
      works: [work('ext-rear', 'verified')],
      workTypes: CATALOGUE,
      epcStatus: 'current',
    });
    const twoCapital = computeValuation({
      baseline: BASELINE,
      works: [work('ext-rear', 'verified'), work('kitchen', 'verified')],
      workTypes: CATALOGUE,
      epcStatus: 'current',
    });
    // second capital work adds less than the first would alone (0.8^1 decay)
    const firstAlone = oneCapital.contributions.capital[1] - 0;
    const combinedExtra = twoCapital.contributions.capital[1] - oneCapital.contributions.capital[1];
    expect(combinedExtra).toBeLessThan(firstAlone);

    // condition tier is a step function on a threshold score, not a per-item
    // sum: boiler alone (ts=1) and boiler+roof (ts=2) both land in the same
    // "ts>=1" band [.01,.03], so the second verified item changes nothing —
    // a naive additive model (like capital's) would have roughly doubled it.
    const oneCondition = computeValuation({
      baseline: BASELINE,
      works: [work('boiler', 'verified')],
      workTypes: CATALOGUE,
      epcStatus: 'current',
    });
    const twoCondition = computeValuation({
      baseline: BASELINE,
      works: [work('boiler', 'verified'), work('roof', 'verified')],
      workTypes: CATALOGUE,
      epcStatus: 'current',
    });
    expect(oneCondition.contributions.condition).toEqual([0.01, 0.03]);
    expect(twoCondition.contributions.condition).toEqual(oneCondition.contributions.condition);
  });

  test('7. verified always yields >= self-reported for the same work', () => {
    const self = computeValuation({
      baseline: BASELINE,
      works: [work('ext-rear', 'self'), work('boiler', 'self'), work('solar', 'self')],
      workTypes: CATALOGUE,
      epcStatus: 'current',
    });
    const verified = computeValuation({
      baseline: BASELINE,
      works: [work('ext-rear', 'verified'), work('boiler', 'verified'), work('solar', 'verified')],
      workTypes: CATALOGUE,
      epcStatus: 'current',
    });
    expect(verified.estimatePoint).toBeGreaterThanOrEqual(self.estimatePoint);
  });

  test('8. determinism - identical inputs twice yield identical output and inputsHash', () => {
    const input = {
      baseline: BASELINE,
      works: [work('ext-rear', 'verified'), work('boiler', 'self')],
      workTypes: CATALOGUE,
      epcStatus: 'current' as const,
    };
    const a = computeValuation(input);
    const b = computeValuation(input);
    expect(a).toEqual(b);
    expect(a.inputsHash).toBe(b.inputsHash);
  });
});
