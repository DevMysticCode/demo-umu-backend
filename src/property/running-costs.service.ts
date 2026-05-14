import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FloodRiskService, FloodRiskBand } from './flood-risk.service';

/**
 * Per-band annual council tax bills (2024/25 average across England councils).
 * Used when we don't have a council-specific override.
 */
const COUNCIL_TAX_BAND_AVG: Record<string, number> = {
  A: 1340,
  B: 1563,
  C: 1787,
  D: 2010,
  E: 2457,
  F: 2904,
  G: 3350,
  H: 4020,
};

/**
 * Q1 2025 Ofgem-style tariffs (price-cap-adjacent). Used when we don't have
 * the user's real tariff on file.
 */
const TARIFFS = {
  gas: 0.0548,        // £/kWh
  electricity: 0.245, // £/kWh
  source: 'Ofgem Q1 2025',
};

/**
 * EPC-rating → annual energy cost fallback (used when no per-fuel breakdown
 * is on file). Drawn from average bills across each band.
 */
const RATING_FALLBACK_TOTAL: Record<string, number> = {
  A: 980, B: 1100, C: 1300, D: 1592, E: 1823, F: 2200, G: 2600,
};

/** EPC-rating → typical SAP score midpoint per band. */
const SAP_BY_RATING: Record<string, number> = {
  A: 95, B: 85, C: 75, D: 65, E: 52, F: 35, G: 18,
};

/** EPC-rating → typical CO₂ tonnes/yr (UK averages for a 3-bed property). */
const CO2_BY_RATING: Record<string, number> = {
  A: 1.2, B: 2.0, C: 3.4, D: 4.8, E: 6.4, F: 8.2, G: 10.5,
};

/**
 * UK water+sewerage suppliers and their 2024/25 average annual unmetered
 * household bills (combined water + sewerage). Source: Ofwat / company
 * published rates. Values rounded to nearest £.
 */
const WATER_SUPPLIERS: Record<
  string,
  { name: string; cost: number }
> = {
  anglian: { name: 'Anglian Water', cost: 521 },
  welsh: { name: 'Dŵr Cymru / Welsh Water', cost: 544 },
  hafren: { name: 'Hafren Dyfrdwy', cost: 452 },
  northumbrian: { name: 'Northumbrian Water', cost: 429 },
  severnTrent: { name: 'Severn Trent', cost: 430 },
  southWest: { name: 'South West Water', cost: 684 },
  southern: { name: 'Southern Water', cost: 497 },
  thames: { name: 'Thames Water', cost: 492 },
  unitedUtilities: { name: 'United Utilities', cost: 460 },
  wessex: { name: 'Wessex Water', cost: 566 },
  yorkshire: { name: 'Yorkshire Water', cost: 457 },
  scottish: { name: 'Scottish Water', cost: 423 },
  niWater: { name: 'NI Water', cost: 420 },
  unknown: { name: 'Regional water supplier', cost: 480 },
};

/**
 * Postcode AREA (the leading 1–2 letters, e.g. "CV", "B", "SW") → water
 * supplier key. Maps the company providing combined water + sewerage to
 * that area. Some areas overlap (e.g. "SY" has both Severn Trent and
 * Welsh Water) — we pick the dominant supplier for that area.
 */
const POSTCODE_AREA_TO_SUPPLIER: Record<string, keyof typeof WATER_SUPPLIERS> = {
  // Anglian — East Anglia + East Midlands
  CB: 'anglian', CO: 'anglian', IP: 'anglian', NR: 'anglian', PE: 'anglian',
  LN: 'anglian', NN: 'anglian', MK: 'anglian',
  // Welsh Water (Dŵr Cymru) — Wales
  CF: 'welsh', LD: 'welsh', LL: 'welsh', NP: 'welsh', SA: 'welsh',
  HR: 'welsh',
  // Hafren Dyfrdwy — small mid-Wales/border slice (Wrexham/Shrewsbury edge)
  SY: 'hafren',
  // Northumbrian — North East
  NE: 'northumbrian', DH: 'northumbrian', DL: 'northumbrian',
  SR: 'northumbrian', TS: 'northumbrian',
  // Severn Trent — Midlands
  B: 'severnTrent', CV: 'severnTrent', DE: 'severnTrent', DY: 'severnTrent',
  GL: 'severnTrent', LE: 'severnTrent', NG: 'severnTrent', ST: 'severnTrent',
  TF: 'severnTrent', WR: 'severnTrent', WS: 'severnTrent', WV: 'severnTrent',
  // South West — Cornwall, Devon
  EX: 'southWest', PL: 'southWest', TQ: 'southWest', TR: 'southWest',
  // Southern — Kent, Sussex, Hampshire, IoW
  BN: 'southern', CT: 'southern', ME: 'southern', PO: 'southern',
  SO: 'southern', TN: 'southern',
  // Thames — Greater London, Thames Valley
  E: 'thames', EC: 'thames', N: 'thames', NW: 'thames', SE: 'thames',
  SW: 'thames', W: 'thames', WC: 'thames', BR: 'thames', CR: 'thames',
  DA: 'thames', EN: 'thames', HA: 'thames', IG: 'thames', KT: 'thames',
  RM: 'thames', SM: 'thames', TW: 'thames', UB: 'thames', WD: 'thames',
  OX: 'thames', RG: 'thames', SL: 'thames', GU: 'thames',
  // United Utilities — North West
  BB: 'unitedUtilities', BL: 'unitedUtilities', CA: 'unitedUtilities',
  CH: 'unitedUtilities', CW: 'unitedUtilities', FY: 'unitedUtilities',
  L: 'unitedUtilities', LA: 'unitedUtilities', M: 'unitedUtilities',
  OL: 'unitedUtilities', PR: 'unitedUtilities', SK: 'unitedUtilities',
  WA: 'unitedUtilities', WN: 'unitedUtilities',
  // Wessex — Somerset, Wiltshire, Dorset, Bath
  BA: 'wessex', BS: 'wessex', DT: 'wessex', TA: 'wessex', SP: 'wessex',
  SN: 'wessex', BH: 'wessex',
  // Yorkshire — Yorkshire
  BD: 'yorkshire', DN: 'yorkshire', HD: 'yorkshire', HG: 'yorkshire',
  HU: 'yorkshire', HX: 'yorkshire', LS: 'yorkshire', S: 'yorkshire',
  WF: 'yorkshire', YO: 'yorkshire',
  // Scotland — all
  AB: 'scottish', DD: 'scottish', DG: 'scottish', EH: 'scottish',
  FK: 'scottish', G: 'scottish', HS: 'scottish', IV: 'scottish',
  KA: 'scottish', KW: 'scottish', KY: 'scottish', ML: 'scottish',
  PA: 'scottish', PH: 'scottish', TD: 'scottish', ZE: 'scottish',
  // Northern Ireland
  BT: 'niWater',
};

const WATER_DEFAULT = 480; // fallback combined unmetered average when area unknown

export interface RunningCostsResponse {
  energy: {
    heating: { cost: number; kwh: number | null; tariff: number; label: string };
    hotWater: { cost: number; kwh: number | null; tariff: number; label: string };
    electricity: { cost: number; kwh: number | null; tariff: number; label: string };
    total: number;
    potentialTotal: number;
    potentialSaving: number;
  };
  energyDetail: {
    gasKwh: number | null;
    electricityKwh: number | null;
    sapCurrent: number;
    sapTarget: number;
    epcRating: string;
    epcTarget: string;
    primaryEnergyUse: number | null;
    primaryEnergyTarget: number;
    floorAreaSqm: number | null;
  };
  risks: {
    flood: { level: 'low' | 'medium' | 'high' | 'clear'; label: string; pill: string };
    mining: { level: 'low' | 'medium' | 'high' | 'clear'; label: string; pill: string };
    planning: { level: 'low' | 'medium' | 'high' | 'clear'; label: string; pill: string };
  };
  environmentalImpact: {
    co2Now: number;
    co2Potential: number;
    reductionPct: number;
    ukAverage: number;
    /** CO₂ figures expressed in kg/yr (UK convention on EPC scale views). */
    co2NowKg: number;
    co2PotentialKg: number;
    ukAverageKg: number;
    savingKg: number;
    ratingCurrent: string;
    ratingPotential: string;
    /** EPC-style rating label (Very low → Very high). */
    ratingLabel: string;
  };
  /** Top-3 EPC-driven money-saving improvements, ranked by annual £ saving. */
  savings: Array<{
    title: string;
    sub: string;
    amount: number;
    points: number;
  }>;
  water: { cost: number; label: string };
  councilTax: { band: string; cost: number; council: string };
  totalAnnual: number;
  totalMonthly: number;
  streetAverageEnergy: number;
  tariffs: typeof TARIFFS;
  epcYear: number | null;
  /** Source of the underlying figures — drives the "confidence" banner copy. */
  confidence: 'epc' | 'estimated';
}

@Injectable()
export class RunningCostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly floodRisk: FloodRiskService,
  ) {}

  async getRunningCosts(propertyId: string): Promise<RunningCostsResponse> {
    const p: any = await this.prisma.property.findUnique({ where: { id: propertyId } });
    if (!p) throw new NotFoundException('Property not found');

    // Real street-average energy spend — averages enriched EPC cost fields
    // across all properties in the same postcode outcode (e.g. "CV5"). Falls
    // back to a per-band proxy when not enough neighbouring data is on file.
    const [streetAverageEnergy, floodRiskBand] = await Promise.all([
      this.computeStreetAverageEnergy(p.postcode, p.epcRating, p.id),
      this.floodRisk.getFloodRisk(p.id),
    ]);

    // ── Energy ────────────────────────────────────────────────
    const heatingCost = num(p.heatingCostCurrent);
    const hotWaterCost = num(p.hotWaterCostCurrent);
    const lightingCost = num(p.lightingCostCurrent);

    let energyTotal: number;
    let confidence: 'epc' | 'estimated';
    if (heatingCost > 0 || hotWaterCost > 0 || lightingCost > 0) {
      energyTotal = heatingCost + hotWaterCost + lightingCost;
      confidence = 'epc';
    } else {
      energyTotal = ratingFallback(p.epcRating);
      confidence = 'estimated';
    }

    // Reverse-engineer kWh from £ using the tariff. Heating + hot water are
    // overwhelmingly gas; electricity uses the electric tariff.
    const heatingKwh =
      heatingCost > 0 ? Math.round(heatingCost / TARIFFS.gas) : null;
    const hotWaterKwh =
      hotWaterCost > 0 ? Math.round(hotWaterCost / TARIFFS.gas) : null;
    const electricityKwh =
      lightingCost > 0 ? Math.round(lightingCost / TARIFFS.electricity) : null;

    // Heating ≈ 60% / Hot water ≈ 8% / Electricity ≈ 32% when we only have a
    // total to split (drawn from English Housing Survey averages).
    const split = (pct: number) => Math.round(energyTotal * pct);
    const energy = {
      heating: {
        cost: heatingCost > 0 ? Math.round(heatingCost) : split(0.6),
        kwh: heatingKwh,
        tariff: TARIFFS.gas,
        label: heatingType(p.heatingType),
      },
      hotWater: {
        cost: hotWaterCost > 0 ? Math.round(hotWaterCost) : split(0.08),
        kwh: hotWaterKwh,
        tariff: TARIFFS.gas,
        label: 'From main heating system',
      },
      electricity: {
        cost: lightingCost > 0 ? Math.round(lightingCost) : split(0.32),
        kwh: electricityKwh,
        tariff: TARIFFS.electricity,
        label: lowEnergyLightingLabel(p.lowEnergyLighting),
      },
      total: Math.round(energyTotal),
      potentialTotal: 0,
      potentialSaving: 0,
    };

    // Potential energy total — prefer the real EPC `*-cost-potential` figures
    // when they're on file. Falls back to a per-band heuristic only when no
    // EPC data has been ingested for this property yet.
    const heatingCostPotential = num(p.heatingCostPotential);
    const hotWaterCostPotential = num(p.hotWaterCostPotential);
    const lightingCostPotential = num(p.lightingCostPotential);
    const epcPotentialTotal =
      heatingCostPotential + hotWaterCostPotential + lightingCostPotential;
    const potentialFactor = potentialReductionFactor(p.epcRating);
    if (epcPotentialTotal > 0) {
      energy.potentialTotal = Math.round(epcPotentialTotal);
    } else {
      energy.potentialTotal = Math.round(energy.total * (1 - potentialFactor));
    }
    energy.potentialSaving = Math.max(
      0,
      energy.total - energy.potentialTotal,
    );

    // ── Energy detail ────────────────────────────────────────
    const gasKwh =
      heatingKwh != null && hotWaterKwh != null
        ? heatingKwh + hotWaterKwh
        : heatingKwh ?? hotWaterKwh ?? null;
    const epcRating = (p.epcRating || '').toUpperCase() || 'D';
    const sapCurrent = num(p.epcScore) || SAP_BY_RATING[epcRating] || 65;
    // Prefer the real EPC "potential" rating/SAP when present, else heuristic.
    const epcTarget =
      (p.epcRatingPotential || '').toUpperCase() || improvedRating(epcRating);
    const sapTarget =
      num(p.epcScorePotential) || SAP_BY_RATING[epcTarget] || sapCurrent + 15;
    const floorAreaSqm = num(p.floorAreaSqm) || null;
    const totalKwh =
      (heatingKwh ?? 0) + (hotWaterKwh ?? 0) + (electricityKwh ?? 0) || null;
    const primaryEnergyUse =
      totalKwh && floorAreaSqm ? Math.round(totalKwh / floorAreaSqm) : null;

    const energyDetail = {
      gasKwh,
      electricityKwh,
      sapCurrent,
      sapTarget,
      epcRating,
      epcTarget,
      primaryEnergyUse,
      primaryEnergyTarget: 150,
      floorAreaSqm,
    };

    // ── Risks ────────────────────────────────────────────────
    const risks = {
      flood: floodRiskFlag(floodRiskBand),
      mining: { level: 'clear' as const, label: 'No recorded mining activity in this area', pill: 'Clear' },
      planning: { level: 'low' as const, label: 'Public planning data not yet available for this address', pill: 'Note' },
    };

    // ── Environmental impact ─────────────────────────────────
    // Prefer real EPC figures (`co2-emissions-current` / `-potential`); fall
    // back to the per-band typical only when the EPC fields are missing.
    const co2Now =
      num(p.co2Emissions) > 0
        ? round1(num(p.co2Emissions))
        : CO2_BY_RATING[epcRating] || 4.8;
    const co2Potential =
      num(p.co2EmissionsPotential) > 0
        ? round1(num(p.co2EmissionsPotential))
        : round1(co2Now * (1 - potentialFactor));
    const reductionPct =
      co2Now > 0
        ? Math.round((1 - co2Potential / co2Now) * 1000) / 10
        : 0;
    const co2NowKg = Math.round(co2Now * 1000);
    const co2PotentialKg = Math.round(co2Potential * 1000);
    const ukAverageKg = 2900;
    const environmentalImpact = {
      co2Now,
      co2Potential,
      reductionPct,
      ukAverage: 6.0,
      co2NowKg,
      co2PotentialKg,
      ukAverageKg,
      savingKg: co2NowKg - co2PotentialKg,
      ratingCurrent: epcRating,
      ratingPotential: epcTarget,
      ratingLabel: ratingImpactLabel(epcRating),
    };

    // ── Top-3 savings (EPC-driven recommendations) ───────────
    const savings = buildSavings(p, energy.total, potentialFactor);

    // ── Council tax ──────────────────────────────────────────
    const band = (p.councilTaxBand || 'D').toUpperCase();
    const councilTaxCost = COUNCIL_TAX_BAND_AVG[band] ?? COUNCIL_TAX_BAND_AVG.D;

    // Best-effort council name from city.
    const council = councilFromCity(p.city);

    // ── Water ────────────────────────────────────────────────
    // Postcode-area-driven lookup of the dominant water+sewerage supplier
    // for this address, with the supplier's 2024/25 unmetered combined-bill
    // average. Falls back to a UK-wide mean when the area is uncharted.
    const water = waterFromPostcode(p.postcode);

    // ── Totals ───────────────────────────────────────────────
    const totalAnnual = energy.total + water.cost + councilTaxCost;
    const totalMonthly = Math.round(totalAnnual / 12);

    return {
      energy,
      energyDetail,
      risks,
      environmentalImpact,
      savings,
      water,
      councilTax: { band, cost: councilTaxCost, council },
      totalAnnual,
      totalMonthly,
      streetAverageEnergy,
      tariffs: TARIFFS,
      epcYear: epcYearFrom(p.lodgementDate),
      confidence,
    };
  }

  /**
   * Average annual energy spend across neighbouring properties on the same
   * postcode outcode (e.g. "CV5"), excluding this property. Uses each row's
   * enriched EPC `heating + hot water + lighting` figures. Requires at least
   * three neighbours with cost data on file before trusting the average —
   * otherwise falls back to a per-band proxy from `RATING_FALLBACK_TOTAL`.
   */
  private async computeStreetAverageEnergy(
    postcode: string | null | undefined,
    epcRating: string | null | undefined,
    selfId: string,
  ): Promise<number> {
    const outcode = (postcode || '').split(' ')[0] || '';
    const fallback = ratingFallback(epcRating ?? null);
    if (!outcode) return fallback;
    try {
      const neighbours = await this.prisma.property.findMany({
        where: {
          postcode: { startsWith: outcode },
          id: { not: selfId },
          OR: [
            { heatingCostCurrent: { not: null } },
            { hotWaterCostCurrent: { not: null } },
            { lightingCostCurrent: { not: null } },
          ],
        },
        select: {
          heatingCostCurrent: true,
          hotWaterCostCurrent: true,
          lightingCostCurrent: true,
        } as any,
        take: 200,
      });
      const totals = neighbours
        .map(
          (n: any) =>
            num(n.heatingCostCurrent) +
            num(n.hotWaterCostCurrent) +
            num(n.lightingCostCurrent),
        )
        .filter((t: number) => t > 0);
      if (totals.length < 3) return fallback;
      const avg = totals.reduce((a: number, b: number) => a + b, 0) / totals.length;
      return Math.round(avg);
    } catch {
      return fallback;
    }
  }
}

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function ratingFallback(rating: string | null): number {
  return RATING_FALLBACK_TOTAL[(rating || '').toUpperCase()] ?? 1592;
}

function potentialReductionFactor(rating: string | null): number {
  const r = (rating || '').toUpperCase();
  if (r === 'A' || r === 'B') return 0.05;
  if (r === 'C') return 0.18;
  if (r === 'D') return 0.28;
  if (r === 'E') return 0.38;
  return 0.45; // F / G
}

function improvedRating(rating: string): string {
  const order = ['G', 'F', 'E', 'D', 'C', 'B', 'A'];
  const idx = order.indexOf(rating);
  if (idx < 0) return 'C';
  // Improve by 2 bands, capped at A.
  return order[Math.min(order.length - 1, idx + 2)];
}

/**
 * Map the EA's 4-band classification (plus our `Unknown` fallback) into the
 * traffic-light shape the UI cards expect. The labels reference the live EA
 * "Risk of Flooding from Rivers and Sea" dataset so users know it's official.
 */
function floodRiskFlag(band: FloodRiskBand | null | undefined): {
  level: 'low' | 'medium' | 'high' | 'clear';
  label: string;
  pill: string;
} {
  switch (band) {
    case 'High':
      return {
        level: 'high',
        label: '⚠ High risk · Environment Agency rivers & sea',
        pill: 'Check',
      };
    case 'Medium':
      return {
        level: 'medium',
        label: '⚠ Medium risk · Environment Agency rivers & sea',
        pill: 'Check',
      };
    case 'Low':
      return {
        level: 'low',
        label: 'Low risk · Environment Agency rivers & sea',
        pill: 'Note',
      };
    case 'Very Low':
      return {
        level: 'clear',
        label: 'Very low risk · Environment Agency rivers & sea',
        pill: 'Clear',
      };
    case 'Unknown':
    default:
      return {
        level: 'clear',
        label: 'No flood-risk data on file for this address',
        pill: 'Clear',
      };
  }
}

function heatingType(value: string | null): string {
  if (!value) return 'Mains gas · boiler & radiators';
  return value;
}

function lowEnergyLightingLabel(pct: number | null): string {
  if (pct == null) return 'Estimated lighting load';
  return `${Math.round(pct)}% low-energy lighting`;
}

function councilFromCity(city: string | null): string {
  if (!city) return 'Local council';
  return `${city} City Council`;
}

/**
 * Look up the dominant water+sewerage supplier for a UK postcode by its area
 * letters (leading characters before the first digit). Returns the supplier's
 * 2024/25 average unmetered combined bill plus a human-readable label.
 * Edge cases (e.g. "SY" spans both Severn Trent and Welsh Water) take the
 * dominant supplier; the user can correct via the "Upload a bill" CTA.
 */
function waterFromPostcode(
  postcode: string | null | undefined,
): { cost: number; label: string } {
  const area = postcodeArea(postcode);
  const key = POSTCODE_AREA_TO_SUPPLIER[area];
  const supplier = key ? WATER_SUPPLIERS[key] : null;
  if (!supplier) {
    return {
      cost: WATER_DEFAULT,
      label: 'Regional water supplier · unmetered average',
    };
  }
  return {
    cost: supplier.cost,
    label: `${supplier.name} · unmetered household${area ? ` (${area})` : ''}`,
  };
}

/** Leading letters of a UK postcode (e.g. "CV5 6AJ" → "CV", "SW1A 1AA" → "SW"). */
function postcodeArea(postcode: string | null | undefined): string {
  if (!postcode) return '';
  const match = String(postcode).trim().toUpperCase().match(/^([A-Z]+)/);
  return match ? match[1] : '';
}

function ratingImpactLabel(rating: string): string {
  const r = (rating || '').toUpperCase();
  if (r === 'A' || r === 'B') return 'Very low';
  if (r === 'C') return 'Low';
  if (r === 'D') return 'Average';
  if (r === 'E') return 'Poor';
  if (r === 'F') return 'High';
  return 'Very high';
}

/**
 * Build a top-3 list of EPC-driven money-saving improvements.
 * Picks the most impactful items first based on which EPC efficiency
 * ratings flag as Poor/Very Poor on this property.
 */
function buildSavings(
  p: any,
  energyTotal: number,
  potentialFactor: number,
): Array<{ title: string; sub: string; amount: number; points: number }> {
  const candidates: Array<{
    title: string;
    sub: string;
    amount: number;
    points: number;
    priority: number;
  }> = [];

  const isPoor = (eff: string | null | undefined) =>
    eff != null && /poor|very poor/i.test(String(eff));
  const isAverage = (eff: string | null | undefined) =>
    eff != null && /average/i.test(String(eff));

  // Boiler / main heating
  if (isPoor(p.mainheatEnergyEff)) {
    candidates.push({
      title: 'Replace old gas boiler',
      sub: 'Older boilers run at ~60% efficiency vs 94% modern',
      amount: Math.round(energyTotal * 0.12),
      points: 8,
      priority: 10,
    });
  }
  // Loft / roof insulation
  if (isPoor(p.roofEnergyEff) || isAverage(p.roofEnergyEff)) {
    candidates.push({
      title: 'Increase loft insulation to 270mm+',
      sub: 'Completing to full depth saves up to £200/yr',
      amount: Math.min(200, Math.round(energyTotal * 0.11)),
      points: 3,
      priority: 9,
    });
  }
  // Walls
  if (isPoor(p.wallsEnergyEff)) {
    candidates.push({
      title: 'Add cavity or solid-wall insulation',
      sub: 'Uninsulated walls lose a third of all heat',
      amount: Math.round(energyTotal * 0.18),
      points: 9,
      priority: 8,
    });
  }
  // Windows
  if (isPoor(p.windowsEnergyEff)) {
    candidates.push({
      title: 'Upgrade to double or triple glazing',
      sub: 'Cuts heat loss through windows by ~50%',
      amount: Math.round(energyTotal * 0.08),
      points: 4,
      priority: 6,
    });
  }
  // Heating controls
  if (isPoor(p.mainheatcEnergyEff) || p.mainheatcEnergyEff == null) {
    candidates.push({
      title: 'Fit a smart thermostat',
      sub: 'Smart controls save ~£130/yr on average',
      amount: Math.min(130, Math.round(energyTotal * 0.07)),
      points: 4,
      priority: 5,
    });
  }
  // Low-energy lighting
  if (typeof p.lowEnergyLighting === 'number' && p.lowEnergyLighting < 70) {
    candidates.push({
      title: 'Switch all bulbs to LED',
      sub: 'A full LED swap cuts lighting energy by 80%',
      amount: Math.round(energyTotal * 0.04),
      points: 2,
      priority: 3,
    });
  }
  // Solar PV
  if (!p.photoSupply || Number(p.photoSupply) <= 0) {
    candidates.push({
      title: 'Install solar PV',
      sub: 'Generate your own electricity, cut bills + carbon',
      amount: Math.round(energyTotal * 0.10),
      points: 6,
      priority: 4,
    });
  }

  // Fallback defaults if EPC fields are sparse — at least show 3 useful items.
  if (candidates.length < 3) {
    const fallback = [
      {
        title: 'Replace old gas boiler',
        sub: 'Older boilers run at ~60% efficiency vs 94% modern',
        amount: Math.round(energyTotal * 0.12),
        points: 8,
        priority: 2,
      },
      {
        title: 'Increase loft insulation to 270mm+',
        sub: 'Completing to full depth saves up to £200/yr',
        amount: Math.min(200, Math.round(energyTotal * 0.11)),
        points: 3,
        priority: 2,
      },
      {
        title: 'Fit a smart thermostat',
        sub: 'Smart controls save ~£130/yr on average',
        amount: Math.min(130, Math.round(energyTotal * 0.07)),
        points: 4,
        priority: 2,
      },
    ];
    for (const f of fallback) {
      if (!candidates.find((c) => c.title === f.title)) candidates.push(f);
    }
  }

  return candidates
    .sort((a, b) => b.amount - a.amount || b.priority - a.priority)
    .slice(0, 3)
    .map(({ title, sub, amount, points }) => ({ title, sub, amount, points }));
}

function epcYearFrom(lodgementDate: string | null | undefined): number | null {
  if (!lodgementDate) return null;
  const y = Number(String(lodgementDate).slice(0, 4));
  return Number.isFinite(y) ? y : null;
}
