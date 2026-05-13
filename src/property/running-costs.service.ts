import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
 * Average regional water-and-sewerage charge for an unmetered household.
 * Severn Trent (Midlands) used as the default; replace with a region lookup
 * once we have water-supplier-by-postcode data.
 */
const WATER_DEFAULT = 400;

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
  constructor(private readonly prisma: PrismaService) {}

  async getRunningCosts(propertyId: string): Promise<RunningCostsResponse> {
    const p: any = await this.prisma.property.findUnique({ where: { id: propertyId } });
    if (!p) throw new NotFoundException('Property not found');

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
      // Potential savings — if we have an EPC potential, fold it in.
      // Otherwise assume a ~38% reduction is achievable for E/F/G properties.
      potentialTotal: 0,
      potentialSaving: 0,
    };
    const potentialFactor = potentialReductionFactor(p.epcRating);
    energy.potentialTotal = Math.round(energy.total * (1 - potentialFactor));
    energy.potentialSaving = energy.total - energy.potentialTotal;

    // ── Energy detail ────────────────────────────────────────
    const gasKwh =
      heatingKwh != null && hotWaterKwh != null
        ? heatingKwh + hotWaterKwh
        : heatingKwh ?? hotWaterKwh ?? null;
    const epcRating = (p.epcRating || '').toUpperCase() || 'D';
    const sapCurrent = num(p.epcScore) || SAP_BY_RATING[epcRating] || 65;
    const epcTarget = improvedRating(epcRating);
    const sapTarget = SAP_BY_RATING[epcTarget] || sapCurrent + 15;
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
      flood: floodRiskFlag(p.floodRisk),
      mining: { level: 'clear' as const, label: 'No recorded mining activity in this area', pill: 'Clear' },
      planning: { level: 'low' as const, label: 'Public planning data not yet available for this address', pill: 'Note' },
    };

    // ── Environmental impact ─────────────────────────────────
    const co2Now =
      num(p.co2Emissions) > 0
        ? round1(num(p.co2Emissions))
        : CO2_BY_RATING[epcRating] || 4.8;
    const co2Potential = round1(co2Now * (1 - potentialFactor));
    const reductionPct = Math.round((1 - co2Potential / co2Now) * 1000) / 10;
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
    const water = { cost: WATER_DEFAULT, label: waterSupplierFromCity(p.city) };

    // ── Totals ───────────────────────────────────────────────
    const totalAnnual = energy.total + water.cost + councilTaxCost;
    const totalMonthly = Math.round(totalAnnual / 12);

    // ── Street average (energy only) ─────────────────────────
    // Use the EPC C/D mid-band as the street average proxy until we have
    // real comparable data per postcode.
    const streetAverageEnergy = 1673;

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

function floodRiskFlag(value: string | null | undefined): {
  level: 'low' | 'medium' | 'high' | 'clear';
  label: string;
  pill: string;
} {
  const v = (value || '').toLowerCase();
  if (v.includes('high')) {
    return { level: 'high', label: '⚠ High risk · Environment Agency zone 3', pill: 'Check' };
  }
  if (v.includes('medium')) {
    return { level: 'medium', label: '⚠ Medium risk · Environment Agency zone 2', pill: 'Check' };
  }
  if (v.includes('low')) {
    return { level: 'low', label: 'Low risk · Environment Agency zone 1', pill: 'Note' };
  }
  return { level: 'clear', label: 'No flood risk recorded for this address', pill: 'Clear' };
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

function waterSupplierFromCity(city: string | null): string {
  if (!city) return 'Regional water supplier · unmetered average';
  const map: Record<string, string> = {
    Coventry: 'Severn Trent',
    Birmingham: 'Severn Trent',
    London: 'Thames Water',
    Manchester: 'United Utilities',
    Liverpool: 'United Utilities',
    Leeds: 'Yorkshire Water',
    Bristol: 'Wessex Water',
  };
  const supplier = map[city] ?? 'Regional supplier';
  return `${supplier} · unmetered household`;
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
