import { createHash } from 'crypto';

// Pure valuation engine — a direct port of umu-truevalue-prototype.html's
// compute(). No DB reads in here: everything it needs is passed in, so it's
// unit-testable and replayable (see truevalue-engine.spec.ts for the
// golden-test list from umu-truevalue-backend-integration.md §10).

export const ENGINE_VERSION = '1.0.0';

export type WorkCategory = 'capital' | 'condition' | 'energy' | 'consent' | 'risk';
export type EpcStatus = 'current' | 'stale' | 'none';

export interface WorkTypeRef {
  code: string;
  category: WorkCategory;
  tier: 0 | 1 | 2 | 3;
  upliftLow: number | null;
  upliftHigh: number | null;
  isMinor: boolean;
  epcAssessed: boolean;
}

export interface DeclaredWork {
  workTypeCode: string;
  // self = self-reported, pending/rejected = not (yet) proven, verified = proven
  verificationState: 'self' | 'pending' | 'verified' | 'rejected';
}

export interface EngineConfig {
  weightVerified: number; // 1.0
  weightSelf: number; // 0.4 - applies to self/pending/rejected alike
  globalCap: number; // 0.30
  conditionThresholds: { high: number; mid: number }; // 2.5, 1
  conditionBands: {
    high: [number, number];
    mid: [number, number];
    low: [number, number];
  };
  epcUpliftPerVerifiedUnit: [number, number]; // [.008, .02]
  staleEnergyConditionContribution: number; // 0.28
  confidenceBase: number; // 30
  confidenceMax: number; // 95
  confidencePerVerified: number; // 13
  confidencePerSelected: number; // 4
  bandWidthBase: number; // 0.10
  bandWidthReduction: number; // 0.06
}

export const DEFAULT_CONFIG: EngineConfig = {
  weightVerified: 1.0,
  weightSelf: 0.4,
  globalCap: 0.3,
  conditionThresholds: { high: 2.5, mid: 1 },
  conditionBands: { high: [0.04, 0.08], mid: [0.01, 0.03], low: [0.004, 0.015] },
  epcUpliftPerVerifiedUnit: [0.008, 0.02],
  staleEnergyConditionContribution: 0.28,
  confidenceBase: 30,
  confidenceMax: 95,
  confidencePerVerified: 13,
  confidencePerSelected: 4,
  bandWidthBase: 0.1,
  bandWidthReduction: 0.06,
};

export interface ValuationInput {
  baseline: number;
  works: DeclaredWork[];
  workTypes: WorkTypeRef[]; // catalogue rows for the declared works (subset is fine)
  epcStatus: EpcStatus;
}

export interface ValuationResult {
  estimateLow: number;
  estimateHigh: number;
  estimatePoint: number;
  confidence: number;
  provedCount: number;
  scoringCount: number;
  derisked: number;
  recorded: number;
  flagged: number;
  epcSuppressed: boolean;
  hasWorks: boolean;
  contributions: {
    capital: [number, number];
    condition: [number, number];
    consent: [number, number];
    epc: [number, number];
  };
  engineVersion: string;
  inputsHash: string;
}

// tier 1 = adds value, tier 2 = removes a deduction. Only these two "score"
// toward proved/scoring counts — tier 0 (risk flag) and tier 3 (recorded
// only) never count, regardless of verification state.
function scores(tier: number): boolean {
  return tier === 1 || tier === 2;
}

export function computeValuation(
  input: ValuationInput,
  config: EngineConfig = DEFAULT_CONFIG,
): ValuationResult {
  const byCode = new Map(input.workTypes.map((w) => [w.code, w]));
  const weightOf = (w: DeclaredWork) =>
    w.verificationState === 'verified' ? config.weightVerified : config.weightSelf;

  const resolved = input.works
    .map((w) => ({ work: w, type: byCode.get(w.workTypeCode) }))
    .filter((x): x is { work: DeclaredWork; type: WorkTypeRef } => !!x.type);

  const t1 = resolved.filter((x) => x.type.tier === 1);

  // --- capital: diminishing returns on stacked works, ranked by midpoint ---
  const caps = t1
    .filter((x) => x.type.category === 'capital')
    .map((x) => ({
      ...x,
      mid: ((x.type.upliftLow ?? 0) + (x.type.upliftHigh ?? 0)) / 2,
    }))
    .sort((a, b) => b.mid - a.mid);
  let capLo = 0;
  let capHi = 0;
  caps.forEach((c, i) => {
    const k = weightOf(c.work) * Math.pow(0.8, i);
    capLo += (c.type.upliftLow ?? 0) * k;
    capHi += (c.type.upliftHigh ?? 0) * k;
  });

  // --- condition: step-function banding, no diminishing returns ---
  const conds = t1.filter((x) => x.type.category === 'condition');
  const energies = t1.filter((x) => x.type.category === 'energy');
  const staleEnergies = input.epcStatus === 'stale' ? energies : [];
  let ts = 0;
  conds.forEach((x) => {
    ts += weightOf(x.work) * (x.type.isMinor ? 0.5 : 1);
  });
  staleEnergies.forEach(() => {
    ts += config.staleEnergyConditionContribution;
  });
  let condLo = 0;
  let condHi = 0;
  if (ts >= config.conditionThresholds.high) {
    [condLo, condHi] = config.conditionBands.high;
  } else if (ts >= config.conditionThresholds.mid) {
    [condLo, condHi] = config.conditionBands.mid;
  } else if (ts > 0) {
    [condLo, condHi] = config.conditionBands.low;
  }

  // --- consent: straight weighted sum, no diminishing returns ---
  let conLo = 0;
  let conHi = 0;
  t1.filter((x) => x.type.category === 'consent').forEach((x) => {
    conLo += (x.type.upliftLow ?? 0) * weightOf(x.work);
    conHi += (x.type.upliftHigh ?? 0) * weightOf(x.work);
  });

  // --- energy: only scores via EPC when the EPC is current; stale/none suppresses it ---
  let epcLo = 0;
  let epcHi = 0;
  let epcSuppressed = false;
  if (energies.length) {
    if (input.epcStatus === 'current') {
      energies.forEach((x) => {
        epcLo += config.epcUpliftPerVerifiedUnit[0] * weightOf(x.work);
        epcHi += config.epcUpliftPerVerifiedUnit[1] * weightOf(x.work);
      });
    } else {
      epcSuppressed = true;
    }
  }

  const low = Math.min(capLo + condLo + conLo + epcLo, config.globalCap);
  const high = Math.min(capHi + condHi + conHi + epcHi, config.globalCap);
  const point = input.baseline * (1 + (low + high) / 2);

  const scoring = resolved.filter((x) => scores(x.type.tier));
  const verified = scoring.filter((x) => x.work.verificationState === 'verified').length;
  const confidence = Math.max(
    config.confidenceBase,
    Math.min(
      config.confidenceMax,
      config.confidenceBase +
        verified * config.confidencePerVerified +
        scoring.length * config.confidencePerSelected,
    ),
  );
  const half =
    point *
    (config.bandWidthBase -
      config.bandWidthReduction * ((confidence - config.confidenceBase) / 65));

  const inputsHash = createHash('sha256')
    .update(
      JSON.stringify({
        baseline: input.baseline,
        epcStatus: input.epcStatus,
        works: [...input.works]
          .map((w) => `${w.workTypeCode}:${w.verificationState}`)
          .sort(),
        engineVersion: ENGINE_VERSION,
      }),
    )
    .digest('hex');

  return {
    estimateLow: point - half,
    estimateHigh: point + half,
    estimatePoint: point,
    confidence,
    provedCount: verified,
    scoringCount: scoring.length,
    derisked: resolved.filter((x) => x.type.tier === 2).length,
    recorded: resolved.filter((x) => x.type.tier === 3).length,
    flagged: resolved.filter((x) => x.type.tier === 0).length,
    epcSuppressed,
    hasWorks: scoring.length > 0,
    contributions: {
      capital: [capLo, capHi],
      condition: [condLo, condHi],
      consent: [conLo, conHi],
      epc: [epcLo, epcHi],
    },
    engineVersion: ENGINE_VERSION,
    inputsHash,
  };
}
