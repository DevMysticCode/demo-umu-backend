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

function epcYearFrom(lodgementDate: string | null | undefined): number | null {
  if (!lodgementDate) return null;
  const y = Number(String(lodgementDate).slice(0, 4));
  return Number.isFinite(y) ? y : null;
}
