import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PassportService } from '../passport/passport.service';
import { LandRegistryService } from '../land-registry/land-registry.service';
import type { VerifyOwnershipResult } from '../land-registry/land-registry.types';
import { Property } from '@prisma/client';
import { Resend } from 'resend';
import { buildStreetViewUrl, resolveStreetViewUrl } from './street-view';

// ── EPC API helpers ──────────────────────────────────────────────────────────
//
// EPC Open Data Communities was retired 2026 Q3 and replaced by a new
// gov.uk API at api.get-energy-performance-data.communities.gov.uk.
// The migration changed three things at once:
//   1. Path        /api/v1/domestic/search  →  /api/domestic/search
//   2. Auth        HTTP Basic (email:key)   →  Bearer <token>
//   3. Response    { rows: [ {...} ] }      →  { data: [ {...} ], pagination: {...} }
//                  fields kebab-case          fields camelCase, MANY fewer per row
// The new search endpoint only returns address + rating band + registration
// date + UPRN. Detail fields (floor area, tenure, heating description,
// CO2 numbers) are not exposed on the /search response. We map what we
// have — everything else stays null so downstream code degrades cleanly.
const EPC_API_BASE =
  process.env.EPC_API_BASE ??
  'https://api.get-energy-performance-data.communities.gov.uk';

function epcAuthHeader(): string {
  const bearer = process.env.EPC_AUTH_TOKEN;
  if (bearer) return `Bearer ${bearer}`;
  // Legacy: if only the old key/email pair is present we still send
  // Basic auth — the old opendatacommunities host will accept it but
  // has been retired to a redirect. Kept so a dev running against an
  // internal mirror still works. Empty string when neither is set —
  // the API returns 401 and callers treat that as "no EPC data".
  const email = process.env.EPC_EMAIL;
  const key = process.env.EPC_API_KEY;
  if (email && key) return `Basic ${Buffer.from(`${email}:${key}`).toString('base64')}`;
  return '';
}

interface EpcNewRow {
  certificateNumber?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressLine3?: string;
  addressLine4?: string;
  postcode?: string;
  postTown?: string;
  council?: string;
  constituency?: string;
  currentEnergyEfficiencyBand?: string;
  registrationDate?: string;
  uprn?: number | string;
  schemaType?: string;
}
interface EpcNewResponse { data?: EpcNewRow[]; pagination?: unknown }

/**
 * Approximate SAP score per band — deliberately the LOWER bound of
 * each band so we never over-report a property's efficiency. The
 * new /search endpoint only exposes the band letter; a midpoint
 * would inflate a genuine 'C=69' property to 75 which reads as
 * meaningfully better in the UI. Lower bound = accurate at the
 * band boundary (e.g. 18 Broadfern shows 69, matches gov.uk) and
 * under-estimates otherwise, which is the safer direction for a
 * consumer-facing HomeScore.
 *   SAP band cutoffs: A 92–100 · B 81–91 · C 69–80 · D 55–68
 *                     E 39–54  · F 21–38 · G 1–20
 * Once the detailed certificate endpoint opens to our tier we
 * swap this out for the real currentEnergyEfficiency figure.
 */
function bandToScore(band?: string | null): number | null {
  switch ((band ?? '').toUpperCase()) {
    case 'A': return 92;
    case 'B': return 81;
    case 'C': return 69;
    case 'D': return 55;
    case 'E': return 39;
    case 'F': return 21;
    case 'G': return 1;
    default:  return null;
  }
}

/**
 * Translate a row from the new API's camelCase minimal shape into
 * the kebab-case shape the rest of the codebase already understands.
 * Fields not exposed on the new /search response stay undefined so
 * epcRowToCert / property-upsert both degrade to null.
 */
function mapNewRowToLegacy(row: EpcNewRow): EpcRow {
  return {
    address1: row.addressLine1 ?? '',
    address2: row.addressLine2 ?? undefined,
    address3: row.addressLine3 ?? undefined,
    town: row.postTown ?? undefined,
    county: row.council ?? undefined,
    postcode: row.postcode ?? '',
    uprn: row.uprn != null ? String(row.uprn) : undefined,
    // Same identifier under two different names across the API
    // versions: the legacy dataset called it `lmk-key`, the new
    // API returns it as `certificateNumber`. Without this mapping
    // every EPC row loses its cert id after the shape adapter runs,
    // so `epcLmkKey` stays null on the Property row and the download
    // + recommendations endpoints can never resolve it.
    'lmk-key': row.certificateNumber,
    'current-energy-rating': row.currentEnergyEfficiencyBand,
    // Band → midpoint numeric so HomeScore has SOMETHING to work with.
    'current-energy-efficiency': bandToScore(row.currentEnergyEfficiencyBand) ?? undefined,
    'lodgement-date': row.registrationDate,
    'local-authority-label': row.council,
  } as EpcRow;
}

/**
 * Fetch JSON from the EPC API. Returns null if the API is unreachable,
 * unauthenticated, or the response is HTML (usually means our token was
 * rejected). Never throws. Consumers treat null as "no EPC data".
 *
 * The response is auto-normalised: the new API's { data: [...] }
 * envelope becomes the legacy { rows: [...] } shape and camelCase
 * fields are mapped back to their kebab-case names, so every existing
 * caller sees the same shape it did before the migration.
 */
async function fetchEpcJson<T = { rows: EpcRow[]; total?: number }>(
  path: string,
): Promise<T | null> {
  try {
    const auth = epcAuthHeader();
    if (!auth) return null;
    const res = await fetch(`${EPC_API_BASE}${path}`, {
      headers: { Authorization: auth as string, Accept: 'application/json' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('json')) return null;
    const raw = (await res.json()) as unknown;
    // Adapter — new API shape → legacy shape.
    const asRecord = raw as Record<string, unknown>;
    if (Array.isArray(asRecord?.data)) {
      const rows = (asRecord.data as EpcNewRow[]).map(mapNewRowToLegacy);
      return { rows, total: rows.length } as unknown as T;
    }
    return raw as T;
  } catch {
    return null;
  }
}

/**
 * Rewrite legacy `/api/v1/domestic/search` paths onto the new API's
 * `/api/domestic/search`. Keeps every call-site URL unchanged so the
 * migration is one function instead of scattered edits.
 */
function epcSearchPath(query: URLSearchParams | string): string {
  const qs = typeof query === 'string' ? query : query.toString();
  return `/api/domestic/search${qs ? `?${qs.replace(/^\?/, '')}` : ''}`;
}

interface EpcRow {
  // The EPC cert identifier. Legacy API called this `lmk-key`; the new
  // API returns `certificateNumber` and `mapNewRowToLegacy` copies it
  // into this slot so every consumer downstream reads the same field.
  'lmk-key'?: string;
  address1: string;
  address2?: string;
  address3?: string;
  town?: string;
  county?: string;
  postcode: string;
  uprn?: string;
  'property-type'?: string;
  'built-form'?: string;
  'current-energy-rating'?: string;
  'current-energy-efficiency'?: number | string;
  'total-floor-area'?: number | string;
  'number-habitable-rooms'?: number | string;
  tenure?: string;
  'construction-age-band'?: string;
  'main-heating-description'?: string;
  'co2-emissions-current'?: number | string;
  'co2-emissions-potential'?: number | string;
  'transaction-type'?: string;
  'lodgement-date'?: string;
  'council-tax-band'?: string;
  'potential-energy-rating'?: string;
  'potential-energy-efficiency'?: number | string;
  'local-authority-label'?: string;
  // HomeScore V2 cost fields
  'heating-cost-current'?: number | string;
  'heating-cost-potential'?: number | string;
  'hot-water-cost-current'?: number | string;
  'hot-water-cost-potential'?: number | string;
  'lighting-cost-current'?: number | string;
  'lighting-cost-potential'?: number | string;
  // HomeScore V2 insulation fields
  'walls-energy-eff'?: string;
  'walls-description'?: string;
  'roof-energy-eff'?: string;
  'roof-description'?: string;
  'floor-energy-eff'?: string;
  'floor-description'?: string;
  'windows-energy-eff'?: string;
  'windows-description'?: string;
  'glazed-area'?: string;
  'multi-glaze-proportion'?: number | string;
  // HomeScore V2 heating fields
  'mainheat-energy-eff'?: string;
  'mainheat-description'?: string;
  'mainheatc-energy-eff'?: string;
  'hot-water-energy-eff'?: string;
  'hotwater-description'?: string;
  'secondheat-description'?: string;
  'mainheatcont-description'?: string;
  // HomeScore V2 ventilation
  'mechanical-ventilation'?: string;
  // HomeScore V2 lighting
  'lighting-energy-eff'?: string;
  'low-energy-lighting'?: number | string;
  // HomeScore V2 renewables
  'photo-supply'?: number | string;
  'solar-water-heating-flag'?: string;
  'wind-turbine-count'?: number | string;
}

// ── EPC Recommendations (per-cert improvement list) ──────────────────────────

/**
 * Canonical shape we persist on `Property.epcRecommendations` and serve to
 * the simulator. Built from a single row of the EPC Register's
 * /recommendations endpoint.
 */
export interface EpcRecommendation {
  /** Stable identifier within the cert (`improvement-id`), e.g. "1". */
  id: string;
  /** Short human-readable title shown on the card, e.g. "Increase loft insulation to 270 mm". */
  title: string;
  /** Longer description text from EPC, used in the expanded card. */
  description: string | null;
  /** EPC indicative-cost range as displayed, e.g. "£100 - £350". */
  costRange: string | null;
  /** Annual £ saving (from EPC `typical-saving`). Some EPCs return a range
   *  text; we store the parsed midpoint number when possible. */
  typicalSaving: number | null;
  /** Resulting SAP rating after applying this improvement (NOT a delta). */
  resultingSap: number | null;
  /** Resulting environmental-impact rating after this improvement. */
  resultingEnvRating: number | null;
  /** EPC's category code so we can group / order across screens. */
  improvementType: string | null;
}

/** Map one row of the EPC recommendations API → our canonical shape. */
function mapEpcRecommendationRow(row: any): EpcRecommendation | null {
  if (!row) return null;
  // The EPC opendatacommunities API uses `improvement-item` for the
  // sequence number (1, 2, 3 …) and `improvement-id` for the category id.
  // Either is a valid ordering key. Fall back to a hash of the title if
  // both are absent so a valid row isn't dropped purely on id matching.
  const id = String(
    row['improvement-item'] ?? row['improvement-id'] ?? '',
  ).trim();
  // The description field is `improvement-descr-text` (no "description"),
  // not `improvement-description-text`. Older datasets occasionally also
  // expose the full name, so we try both. Title alias precedence: human-
  // readable summary → category text → long description.
  const title = String(
    row['improvement-summary-text'] ??
      row['improvement-id-text'] ??
      row['improvement-descr-text'] ??
      row['improvement-description-text'] ??
      '',
  ).trim();
  // A row needs SOME identifiable title — without it the quiz can't
  // render. But we accept rows with no `id`/`item` and fall back to a
  // synthesised id (the recs endpoint preserves array order anyway).
  if (!title) return null;
  return {
    id: id || `rec-${Math.abs(hashCode(title))}`,
    title,
    description:
      String(
        row['improvement-descr-text'] ??
          row['improvement-description-text'] ??
          '',
      ).trim() || null,
    costRange: String(row['indicative-cost'] ?? '').trim() || null,
    typicalSaving: parseSavingValue(row['typical-saving']),
    resultingSap: parseIntOrNull(row['energy-performance-rating-improvement']),
    resultingEnvRating: parseIntOrNull(
      row['environmental-impact-rating-improvement'],
    ),
    improvementType:
      String(row['improvement-type'] ?? row['improvement-item'] ?? '').trim() ||
      null,
  };
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

/** "39" → 39, "39 - 50" → 44 (midpoint), "" → null. */
function parseSavingValue(v: any): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Handle ranges like "39 - 50" or "39 to 50"
  const parts = s.split(/\s*(?:-|to)\s*/).map((p) => parseFloat(p));
  const nums = parts.filter((n) => Number.isFinite(n));
  if (nums.length === 0) return null;
  if (nums.length === 1) return Math.round(nums[0]);
  return Math.round((nums[0] + nums[1]) / 2);
}

function parseIntOrNull(v: any): number | null {
  if (v == null) return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convert a string to Title Case, handling UK address conventions.
 * "14 WOODFIELD ROAD" → "14 Woodfield Road"
 * Preserves numeric tokens and handles null/undefined gracefully.
 */
function titleCase(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

function epcRowToProperty(row: EpcRow) {
  const address1 = row['address1'] ?? '';
  const address2 = row['address2'] ?? '';
  const town = row['town'] ?? '';
  const county = row['county'] ?? '';
  const postcode = row['postcode'] ?? '';
  const uprn = row['uprn'] ?? null;

  // Parse year from construction age band e.g. "England and Wales: 2003-2006"
  let yearBuilt: number | null = null;
  const ageBand = row['construction-age-band'] ?? '';
  const yearMatch = ageBand.match(/(\d{4})/);
  if (yearMatch) yearBuilt = parseInt(yearMatch[1]);

  // EPC 'number-habitable-rooms' counts ALL habitable rooms (bedrooms + living/dining rooms).
  // Estimate bedrooms: flats typically have 1 reception room; houses typically 2.
  const habRooms = parseInt(String(row['number-habitable-rooms'] ?? '0'));
  const isFlat = /flat|apartment|maisonette/i.test(row['property-type'] ?? '');
  let bedrooms: number | null = null;
  if (habRooms >= 1) {
    if (isFlat) {
      bedrooms = Math.max(0, habRooms - 1); // 1 living room
    } else {
      bedrooms =
        habRooms <= 3 ? Math.max(1, habRooms - 1) : Math.max(1, habRooms - 2); // 1-2 reception rooms
    }
  }

  const propType = row['property-type'] ?? row['built-form'] ?? null;

  return {
    uprn: uprn || null,
    addressLine1: titleCase(address1),
    addressLine2: titleCase(address2) || null,
    city: titleCase(town) || null,
    county: titleCase(county) || null,
    postcode: postcode.trim().toUpperCase(),
    propertyType: propType,
    bedrooms: bedrooms || null,
    floorAreaSqm: parseFloat(String(row['total-floor-area'] ?? '0')) || null,
    sqft: row['total-floor-area']
      ? Math.round(parseFloat(String(row['total-floor-area'])) * 10.764)
      : null,
    epcRating: row['current-energy-rating'] ?? null,
    epcScore: parseInt(String(row['current-energy-efficiency'] ?? '0')) || null,
    tenure: row['tenure'] ?? null,
    yearBuilt: yearBuilt,
    heatingType: row['main-heating-description'] ?? null,
    co2Emissions:
      parseFloat(String(row['co2-emissions-current'] ?? '0')) || null,
    co2EmissionsPotential:
      parseFloat(String(row['co2-emissions-potential'] ?? '0')) || null,
    epcRatingPotential: row['potential-energy-rating'] ?? null,
    epcScorePotential:
      parseInt(String(row['potential-energy-efficiency'] ?? '0')) || null,
    heatingCostPotential:
      parseFloat(String(row['heating-cost-potential'] ?? '0')) || null,
    hotWaterCostPotential:
      parseFloat(String(row['hot-water-cost-potential'] ?? '0')) || null,
    lightingCostPotential:
      parseFloat(String(row['lighting-cost-potential'] ?? '0')) || null,
    councilTaxBand: row['council-tax-band'] ?? null,
    epcEnrichedAt: new Date(),
  };
}

// ── EpcCert type + builder (all fields used by HomeScore V2) ─────────────────

interface EpcCert {
  certUrl: string | null;
  lmkKey: string | null;
  potentialRating: string | null;
  potentialScore: number | null;
  councilTaxBand: string | null;
  localAuthority: string | null;
  // Standard property fields
  epcRating: string | null;
  epcScore: number | null;
  floorAreaSqm: number | null;
  sqft: number | null;
  bedrooms: number | null;
  tenure: string | null;
  yearBuilt: number | null;
  heatingType: string | null;
  propertyType: string | null;
  uprn: string | null;
  constructionAgeBand: string | null;
  builtForm: string | null;
  lodgementDate: string | null;
  // HomeScore V2 cost fields
  heatingCostCurrent: number | null;
  hotWaterCostCurrent: number | null;
  lightingCostCurrent: number | null;
  // EPC "potential" figures (with all recommended improvements)
  heatingCostPotential: number | null;
  hotWaterCostPotential: number | null;
  lightingCostPotential: number | null;
  co2Emissions: number | null;
  co2EmissionsPotential: number | null;
  // HomeScore V2 insulation
  wallsEnergyEff: string | null;
  wallsDescription: string | null;
  roofEnergyEff: string | null;
  roofDescription: string | null;
  floorEnergyEff: string | null;
  floorDescription: string | null;
  windowsEnergyEff: string | null;
  windowsDescription: string | null;
  glazedArea: string | null;
  multiGlazeProportion: number | null;
  // HomeScore V2 heating
  mainheatEnergyEff: string | null;
  mainheatDescription: string | null;
  mainheatcEnergyEff: string | null;
  hotWaterEnergyEff: string | null;
  hotwaterDescription: string | null;
  secondheatDescription: string | null;
  mainheatcontDescription: string | null;
  // HomeScore V2 ventilation
  mechanicalVentilation: string | null;
  // HomeScore V2 lighting
  lightingEnergyEff: string | null;
  lowEnergyLighting: number | null;
  // HomeScore V2 renewables
  photoSupply: number | null;
  solarWaterHeatingFlag: string | null;
  windTurbineCount: number | null;
}

function epcRowToCert(row: EpcRow): EpcCert {
  const mapped = epcRowToProperty(row);
  const lmkKey = (row as any)['lmk-key'];

  const parseFloat2 = (v: any) => {
    const n = parseFloat(String(v ?? ''));
    return isNaN(n) ? null : n;
  };
  const parseInt2 = (v: any) => {
    const n = parseInt(String(v ?? ''), 10);
    return isNaN(n) ? null : n;
  };
  const str = (v: any): string | null =>
    v != null && String(v).trim() ? String(v).trim() : null;

  return {
    certUrl: lmkKey
      ? `https://epc.opendatacommunities.org/files/${lmkKey}`
      : null,
    lmkKey: lmkKey ? String(lmkKey) : null,
    potentialRating: str(row['potential-energy-rating']),
    potentialScore: parseInt2(row['potential-energy-efficiency']),
    councilTaxBand: mapped.councilTaxBand,
    localAuthority: str((row as any)['local-authority-label']),
    epcRating: mapped.epcRating,
    epcScore: mapped.epcScore,
    floorAreaSqm: mapped.floorAreaSqm,
    sqft: mapped.sqft,
    bedrooms: mapped.bedrooms,
    tenure: mapped.tenure,
    yearBuilt: mapped.yearBuilt,
    heatingType: mapped.heatingType,
    propertyType: mapped.propertyType,
    uprn: mapped.uprn,
    constructionAgeBand: str(row['construction-age-band']),
    builtForm: str(row['built-form']),
    lodgementDate: str(row['lodgement-date']),
    // Cost — current
    heatingCostCurrent: parseFloat2(row['heating-cost-current']),
    hotWaterCostCurrent: parseFloat2(row['hot-water-cost-current']),
    lightingCostCurrent: parseFloat2(row['lighting-cost-current']),
    // Cost + CO₂ — potential (with all recommended improvements)
    heatingCostPotential: parseFloat2(row['heating-cost-potential']),
    hotWaterCostPotential: parseFloat2(row['hot-water-cost-potential']),
    lightingCostPotential: parseFloat2(row['lighting-cost-potential']),
    co2Emissions: parseFloat2(row['co2-emissions-current']),
    co2EmissionsPotential: parseFloat2(row['co2-emissions-potential']),
    // Insulation
    wallsEnergyEff: str(row['walls-energy-eff']),
    wallsDescription: str(row['walls-description']),
    roofEnergyEff: str(row['roof-energy-eff']),
    roofDescription: str(row['roof-description']),
    floorEnergyEff: str(row['floor-energy-eff']),
    floorDescription: str(row['floor-description']),
    windowsEnergyEff: str(row['windows-energy-eff']),
    windowsDescription: str(row['windows-description']),
    glazedArea: str(row['glazed-area']),
    multiGlazeProportion: parseFloat2(row['multi-glaze-proportion']),
    // Heating
    mainheatEnergyEff: str(row['mainheat-energy-eff']),
    mainheatDescription: str(row['mainheat-description']),
    mainheatcEnergyEff: str(row['mainheatc-energy-eff']),
    hotWaterEnergyEff: str(row['hot-water-energy-eff']),
    hotwaterDescription: str(row['hotwater-description']),
    secondheatDescription: str(row['secondheat-description']),
    mainheatcontDescription: str(row['mainheatcont-description']),
    // Ventilation
    mechanicalVentilation: str(row['mechanical-ventilation']),
    // Lighting
    lightingEnergyEff: str(row['lighting-energy-eff']),
    lowEnergyLighting: parseFloat2(row['low-energy-lighting']),
    // Renewables
    photoSupply: parseFloat2(row['photo-supply']),
    solarWaterHeatingFlag: str(row['solar-water-heating-flag']),
    windTurbineCount: parseInt2(row['wind-turbine-count']),
  };
}

// ── OS Places helpers ─────────────────────────────────────────────────────────

/**
 * Convert British National Grid (OSGB36) Easting/Northing to WGS84 lat/lon.
 * Accuracy ~5m — sufficient for map display.
 * Algorithm: OS transverse Mercator inverse + Helmert transform.
 */
function bngToLatLon(E: number, N: number): { lat: number; lon: number } {
  // Airy 1830 ellipsoid
  const a = 6377563.396,
    b = 6356256.909;
  const F0 = 0.9996012717;
  const lat0 = (49 * Math.PI) / 180;
  const lon0 = (-2 * Math.PI) / 180;
  const N0 = -100000,
    E0 = 400000;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b),
    n2 = n * n,
    n3 = n * n * n;

  let lat = lat0;
  let M = 0;
  do {
    lat = (N - N0 - M) / (a * F0) + lat;
    const Ma = (1 + n + (5 / 4) * n2 + (5 / 4) * n3) * (lat - lat0);
    const Mb =
      (3 * n + 3 * n2 + (21 / 8) * n3) *
      Math.sin(lat - lat0) *
      Math.cos(lat + lat0);
    const Mc =
      ((15 / 8) * n2 + (15 / 8) * n3) *
      Math.sin(2 * (lat - lat0)) *
      Math.cos(2 * (lat + lat0));
    const Md =
      (35 / 24) * n3 * Math.sin(3 * (lat - lat0)) * Math.cos(3 * (lat + lat0));
    M = b * F0 * (Ma - Mb + Mc - Md);
  } while (Math.abs(N - N0 - M) >= 1e-5);

  const sin2 = Math.sin(lat) ** 2;
  const nu = (a * F0) / Math.sqrt(1 - e2 * sin2);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sin2, 1.5);
  const eta2 = nu / rho - 1;
  const tan = Math.tan(lat),
    tan2 = tan * tan,
    tan4 = tan2 * tan2;
  const sec = 1 / Math.cos(lat);

  const dE = E - E0;
  const latOut =
    lat -
    (tan / (2 * rho * nu)) * dE ** 2 +
    (tan / (24 * rho * nu ** 3)) *
      (5 + 3 * tan2 + eta2 - 9 * tan2 * eta2) *
      dE ** 4 -
    (tan / (720 * rho * nu ** 5)) * (61 + 90 * tan2 + 45 * tan4) * dE ** 6;
  const lonOut =
    lon0 +
    (sec / nu) * dE -
    (sec / (6 * nu ** 3)) * (nu / rho + 2 * tan2) * dE ** 3 +
    (sec / (120 * nu ** 5)) * (5 + 28 * tan2 + 24 * tan4) * dE ** 5;

  // Helmert OSGB36 → WGS84 (tx=446.448 ty=-125.157 tz=542.06 s=-20.4894ppm rx=0.1502" ry=0.2470" rz=0.8421")
  const sinLat = Math.sin(latOut),
    cosLat = Math.cos(latOut);
  const sinLon = Math.sin(lonOut),
    cosLon = Math.cos(lonOut);
  const H = 0; // assume sea level
  const x1 = (nu + H) * cosLat * cosLon;
  const y1 = (nu + H) * cosLat * sinLon;
  const z1 = (nu * (1 - e2) + H) * sinLat;

  const tx = 446.448,
    ty = -125.157,
    tz = 542.06;
  const rx = ((0.1502 / 3600) * Math.PI) / 180;
  const ry = ((0.247 / 3600) * Math.PI) / 180;
  const rz = ((0.8421 / 3600) * Math.PI) / 180;
  const s = 1 - 20.4894 / 1e6;

  const x2 = tx + s * (x1 - rz * y1 + ry * z1);
  const y2 = ty + s * (rz * x1 + y1 - rx * z1);
  const z2 = tz + s * (-ry * x1 + rx * y1 + z1);

  const aW = 6378137.0,
    e2W = 0.00669437999014;
  let latW = Math.atan2(z2, Math.sqrt(x2 * x2 + y2 * y2) * (1 - e2W));
  for (let i = 0; i < 10; i++) {
    const nuW = aW / Math.sqrt(1 - e2W * Math.sin(latW) ** 2);
    latW = Math.atan2(
      z2 + e2W * nuW * Math.sin(latW),
      Math.sqrt(x2 * x2 + y2 * y2),
    );
  }
  const lonW = Math.atan2(y2, x2);

  return { lat: (latW * 180) / Math.PI, lon: (lonW * 180) / Math.PI };
}

/**
 * Map OS classification codes to our property type strings.
 * RD = Residential Dwelling, RC = Residential Commercial, etc.
 */
/** Normalise a postcode to "AA9 9AA" format — OS Places requires a space. */
function normalisePostcode(raw: string): string {
  const s = raw.replace(/\s+/g, '').toUpperCase();
  return s.length >= 5 ? `${s.slice(0, -3)} ${s.slice(-3)}` : s;
}

// Natural address-line sort: orders rows so a postcode lookup reads
// "1 Woodfield Rd, 2 Woodfield Rd, 9 Woodfield Rd, 10 Woodfield Rd, …"
// rather than the lexical "1, 10, 11, 2, 3, …" you'd get from
// String.localeCompare without `numeric:true`. Falls back gracefully for
// addresses without leading numerics (e.g. "Flat 3, …", "The Cottage").
function naturalSortByAddress<T extends { addressLine1?: string | null }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    const aa = (a.addressLine1 ?? '').trim();
    const bb = (b.addressLine1 ?? '').trim();
    return aa.localeCompare(bb, 'en-GB', {
      numeric: true,
      sensitivity: 'base',
    });
  });
}

// Pragmatic UK-postcode test — full and outward formats. Used to decide
// whether a search query has a finite, EPC-knowable total worth backfilling.
/**
 * Find the cert detail-page URL on find-energy-certificate.service.gov.uk
 * for a property whose address-line-1 we know. The site renders postcode
 * search results as rows containing `<a href="/energy-certificate/…">`
 * elements with the visible address text. We look for any anchor whose
 * text starts with the property's number+street prefix.
 *
 * Returns the href (e.g. "/energy-certificate/9100-6241-0722-3698-3463")
 * or null if no row matched.
 */
function findCertHrefForAddress(
  html: string,
  addressLine1: string,
): string | null {
  if (!html || !addressLine1) return null;
  const prefix = addressLine1.trim().toLowerCase().split(',')[0].trim();
  if (!prefix) return null;
  // Capture every anchor that links to a cert page along with its
  // visible text. The regex is intentionally lenient about whitespace
  // between attributes and text content.
  const anchorRe =
    /<a\s+[^>]*href="(\/energy-certificate\/[^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html))) {
    const href = m[1];
    const text = m[2]
      .replace(/<[^>]+>/g, ' ') // strip nested tags
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!text) continue;
    // Accept any anchor whose visible text starts with the address
    // prefix (case-insensitive). The site usually renders the full
    // address as the link text so a strict equality would be too
    // brittle ("3 Austen Road" vs "3 AUSTEN ROAD, ERITH, DA8 1YA").
    if (text.startsWith(prefix) || text.includes(prefix)) {
      return href;
    }
  }
  return null;
}

/**
 * Parse the "Steps you could take to save energy" block out of a
 * find-energy-certificate.service.gov.uk cert detail page.
 *
 * The page uses GOV.UK design-system markup so each step looks roughly:
 *   <h3>Step 1: Floor insulation (suspended floor)</h3>
 *   <dl class="…">
 *     <dt>Typical installation cost</dt><dd>£800 - £1,200</dd>
 *     <dt>Typical yearly saving</dt><dd>£122</dd>
 *     <dt>Potential rating after completing step 1</dt><dd>53 E</dd>
 *   </dl>
 *
 * Some pages render rows as a table instead. We try the dl form first,
 * then fall back to scanning for `<h3>Step N: …</h3>` followed by the
 * first `Typical installation cost` / `Typical yearly saving` /
 * `Potential rating after` text fragments that follow it.
 */
function parseRecommendationsFromCertHtml(html: string): EpcRecommendation[] {
  if (!html) return [];

  // Restrict to the "Steps you could take" section by anchoring on the
  // actual <h2> heading (not the nav anchor at the top of the page,
  // which also contains the same text and would otherwise win the
  // regex match).
  let section = html;
  const sectionMatch = html.match(
    /<h2[^>]*>\s*Steps you could take to save energy\s*<\/h2>([\s\S]*?)(?=<h2|<footer|<\/main>|$)/i,
  );
  if (sectionMatch) section = sectionMatch[1];

  const recs: EpcRecommendation[] = [];
  // Capture every `Step N: <title>` heading and everything up to the
  // next step heading (or end of section). We then extract the cost,
  // saving and resulting-rating from that slice.
  const stepRe =
    /<h3[^>]*>\s*Step\s+(\d+)\s*:\s*([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3[^>]*>\s*Step\s+\d+|<h2|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = stepRe.exec(section))) {
    const stepNum = m[1];
    const titleRaw = m[2]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
    const body = m[3];

    const cost = extractDdValue(body, /typical\s+installation\s+cost/i);
    const saving = extractDdValue(body, /typical\s+yearly\s+saving/i);
    const rating = extractDdValue(body, /potential\s+rating\s+after/i);

    let savingNum: number | null = null;
    if (saving) {
      const numMatch = saving.replace(/[,£]/g, '').match(/(\d+)/);
      if (numMatch) savingNum = parseInt(numMatch[1], 10);
    }
    let resultingSap: number | null = null;
    if (rating) {
      const sapMatch = rating.match(/(\d+)/);
      if (sapMatch) resultingSap = parseInt(sapMatch[1], 10);
    }

    if (!titleRaw) continue;
    recs.push({
      id: stepNum || String(recs.length + 1),
      title: titleRaw,
      description: null,
      costRange: cost || null,
      typicalSaving: savingNum,
      resultingSap,
      resultingEnvRating: null,
      improvementType: null,
    });
  }
  return recs;
}

/**
 * Within an HTML fragment that contains GOV.UK summary-list rows, find
 * the first `<dd>` whose preceding `<dt>` text matches `labelRe` and
 * return its trimmed text content (with SVG / nested tags stripped).
 *
 * The page uses this shape:
 *   <div class="govuk-summary-list__row">
 *     <dt class="govuk-summary-list__key …">Typical installation cost</dt>
 *     <dd class="govuk-summary-list__value …">£15</dd>
 *   </div>
 *
 * Some values are wrapped in SVG (potential rating shows as
 * `<svg>…<text>76 C</text></svg>`); stripping tags surfaces the text.
 */
function extractDdValue(html: string, labelRe: RegExp): string | null {
  const dlRe = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
  let m: RegExpExecArray | null;
  while ((m = dlRe.exec(html))) {
    const labelText = m[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (labelRe.test(labelText)) {
      return m[2]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&pound;/gi, '£')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }
  // Fallback: <p>label</p><p>value</p> or table-row shape.
  const blockRe =
    /<(?:p|th|td)[^>]*>([\s\S]*?)<\/(?:p|th|td)>\s*<(?:p|td)[^>]*>([\s\S]*?)<\/(?:p|td)>/gi;
  while ((m = blockRe.exec(html))) {
    const labelText = m[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (labelRe.test(labelText)) {
      return m[2]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&pound;/gi, '£')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }
  return null;
}

function looksLikeUkPostcode(raw: string): boolean {
  if (!raw) return false;
  const s = raw.replace(/\s+/g, '').toUpperCase();
  return /^([A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2})$/.test(s);
}

function osClassToPropertyType(code: string): string {
  const c = (code ?? '').toUpperCase();
  if (c.startsWith('RD01')) return 'Detached';
  if (c.startsWith('RD02')) return 'Semi-Detached';
  if (c.startsWith('RD03')) return 'Terraced';
  if (c.startsWith('RD04')) return 'Terraced';
  if (c.startsWith('RD06') || c.startsWith('RD07')) return 'Flat';
  if (c.startsWith('RD')) return 'Residential';
  if (c.startsWith('RC')) return 'Commercial';
  return 'Residential';
}

// Placeholder images removed — properties without a real image return imageUrl: null
// and the frontend shows the UMU "no image" placeholder instead.

const POSTCODE_AREAS: Record<
  string,
  { city: string; county: string; basePricek: number; lat: number; lon: number }
> = {
  E: {
    city: 'London',
    county: 'Greater London',
    basePricek: 650,
    lat: 51.515,
    lon: -0.072,
  },
  W: {
    city: 'London',
    county: 'Greater London',
    basePricek: 950,
    lat: 51.512,
    lon: -0.188,
  },
  N: {
    city: 'London',
    county: 'Greater London',
    basePricek: 700,
    lat: 51.565,
    lon: -0.103,
  },
  SE: {
    city: 'London',
    county: 'Greater London',
    basePricek: 580,
    lat: 51.477,
    lon: -0.021,
  },
  SW: {
    city: 'London',
    county: 'Greater London',
    basePricek: 850,
    lat: 51.468,
    lon: -0.172,
  },
  EC: {
    city: 'London',
    county: 'Greater London',
    basePricek: 900,
    lat: 51.519,
    lon: -0.098,
  },
  WC: {
    city: 'London',
    county: 'Greater London',
    basePricek: 1100,
    lat: 51.517,
    lon: -0.125,
  },
  NW: {
    city: 'London',
    county: 'Greater London',
    basePricek: 780,
    lat: 51.548,
    lon: -0.165,
  },
  TW: {
    city: 'Twickenham',
    county: 'Surrey',
    basePricek: 620,
    lat: 51.449,
    lon: -0.337,
  },
  KT: {
    city: 'Kingston upon Thames',
    county: 'Surrey',
    basePricek: 680,
    lat: 51.412,
    lon: -0.303,
  },
  CR: {
    city: 'Croydon',
    county: 'Surrey',
    basePricek: 450,
    lat: 51.376,
    lon: -0.098,
  },
  SM: {
    city: 'Sutton',
    county: 'Surrey',
    basePricek: 480,
    lat: 51.365,
    lon: -0.192,
  },
  BR: {
    city: 'Bromley',
    county: 'Greater London',
    basePricek: 510,
    lat: 51.406,
    lon: 0.019,
  },
  GU: {
    city: 'Guildford',
    county: 'Surrey',
    basePricek: 500,
    lat: 51.236,
    lon: -0.57,
  },
  SL: {
    city: 'Slough',
    county: 'Berkshire',
    basePricek: 400,
    lat: 51.509,
    lon: -0.595,
  },
  B: {
    city: 'Birmingham',
    county: 'West Midlands',
    basePricek: 280,
    lat: 52.486,
    lon: -1.89,
  },
  CV: {
    city: 'Coventry',
    county: 'West Midlands',
    basePricek: 240,
    lat: 52.408,
    lon: -1.511,
  },
  LE: {
    city: 'Leicester',
    county: 'Leicestershire',
    basePricek: 230,
    lat: 52.636,
    lon: -1.132,
  },
  M: {
    city: 'Manchester',
    county: 'Greater Manchester',
    basePricek: 300,
    lat: 53.483,
    lon: -2.244,
  },
  LS: {
    city: 'Leeds',
    county: 'West Yorkshire',
    basePricek: 280,
    lat: 53.8,
    lon: -1.549,
  },
  S: {
    city: 'Sheffield',
    county: 'South Yorkshire',
    basePricek: 220,
    lat: 53.383,
    lon: -1.465,
  },
  L: {
    city: 'Liverpool',
    county: 'Merseyside',
    basePricek: 200,
    lat: 53.409,
    lon: -2.978,
  },
  NE: {
    city: 'Newcastle upon Tyne',
    county: 'Tyne and Wear',
    basePricek: 190,
    lat: 54.978,
    lon: -1.618,
  },
  SO: {
    city: 'Southampton',
    county: 'Hampshire',
    basePricek: 320,
    lat: 50.904,
    lon: -1.404,
  },
  PO: {
    city: 'Portsmouth',
    county: 'Hampshire',
    basePricek: 280,
    lat: 50.82,
    lon: -1.091,
  },
  BN: {
    city: 'Brighton',
    county: 'East Sussex',
    basePricek: 430,
    lat: 50.823,
    lon: -0.137,
  },
  DEFAULT: {
    city: 'United Kingdom',
    county: 'England',
    basePricek: 300,
    lat: 51.509,
    lon: -0.118,
  },
};

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/**
 * Approximate UK House Price Index multiplier to convert a historical sale price
 * to an estimated current (April 2026) value.
 * Based on ONS UK HPI (England & Wales residential).
 */
function hpiMultiplier(soldYear: number): number {
  const factors: Record<number, number> = {
    1990: 5.2, 1991: 5.0, 1992: 5.2, 1993: 5.3, 1994: 4.8,
    1995: 4.2, 1996: 3.8, 1997: 3.5, 1998: 3.2, 1999: 2.9,
    2000: 3.0, 2001: 2.7, 2002: 2.4, 2003: 2.1, 2004: 1.9,
    2005: 2.2, 2006: 2.1, 2007: 2.0, 2008: 2.1, 2009: 2.2,
    2010: 1.8, 2011: 1.75, 2012: 1.75, 2013: 1.70, 2014: 1.60,
    2015: 1.50, 2016: 1.42, 2017: 1.35, 2018: 1.28, 2019: 1.22,
    2020: 1.18, 2021: 1.10, 2022: 1.00, 2023: 1.02, 2024: 1.03,
    2025: 1.02,
  };
  if (soldYear < 1990) return 6.0;
  return factors[soldYear] ?? 1.0;
}

function getAreaInfo(postcode: string) {
  const upper = postcode.trim().toUpperCase();
  const twoChar = upper.substring(0, 2).replace(/[0-9]/g, '');
  const oneChar = upper.substring(0, 1);
  return (
    POSTCODE_AREAS[twoChar] ||
    POSTCODE_AREAS[oneChar] ||
    POSTCODE_AREAS['DEFAULT']
  );
}

/**
 * 2024/25 Band D council tax rates (£/year) by local authority name.
 * Source: DLUHC Council Tax Statistics 2024-25.
 * Key is lowercase normalised authority name (strip "city/borough/district/council").
 */
const COUNCIL_TAX_RATES_2024: Record<string, number> = {
  // London Boroughs
  'barking and dagenham': 1671,
  barnet: 1818,
  bexley: 1918,
  brent: 1699,
  bromley: 1918,
  camden: 1494,
  'city of london': 1158,
  croydon: 2285,
  ealing: 1807,
  enfield: 1972,
  greenwich: 1868,
  hackney: 1589,
  'hammersmith and fulham': 1444,
  haringey: 1863,
  harrow: 1915,
  havering: 2175,
  hillingdon: 1839,
  hounslow: 1717,
  islington: 1445,
  'kensington and chelsea': 1113,
  'kingston upon thames': 2077,
  lambeth: 1862,
  lewisham: 1885,
  merton: 1924,
  newham: 1596,
  redbridge: 1940,
  'richmond upon thames': 2091,
  southwark: 1498,
  sutton: 2009,
  'tower hamlets': 1238,
  'waltham forest': 1906,
  wandsworth: 952,
  westminster: 866,
  // Metropolitan Districts
  birmingham: 1994,
  bradford: 2050,
  calderdale: 2189,
  coventry: 2219,
  doncaster: 2071,
  dudley: 1979,
  gateshead: 2199,
  kirklees: 2068,
  knowsley: 2230,
  leeds: 2097,
  liverpool: 2283,
  manchester: 1724,
  'newcastle upon tyne': 2294,
  'north tyneside': 2108,
  oldham: 2066,
  rochdale: 2103,
  rotherham: 2051,
  salford: 1978,
  sandwell: 2010,
  sefton: 2228,
  sheffield: 2114,
  solihull: 1859,
  'south tyneside': 2176,
  'st helens': 2238,
  stockport: 1994,
  sunderland: 2059,
  tameside: 2090,
  trafford: 1695,
  wakefield: 2024,
  walsall: 2049,
  wigan: 1978,
  wirral: 2198,
  wolverhampton: 2028,
  // Unitary Authorities
  'bath and north east somerset': 2275,
  bedford: 2066,
  'bournemouth christchurch and poole': 2105,
  'bracknell forest': 1811,
  'brighton and hove': 2454,
  bristol: 2272,
  buckinghamshire: 2101,
  cambridge: 1994,
  'central bedfordshire': 2069,
  'cheshire east': 2044,
  'cheshire west and chester': 2024,
  cornwall: 2248,
  derby: 2056,
  durham: 2225,
  'east riding of yorkshire': 2056,
  exeter: 1985,
  gloucester: 1969,
  hartlepool: 2251,
  herefordshire: 2134,
  'isle of wight': 2167,
  'kingston upon hull': 2077,
  leicester: 2034,
  luton: 2069,
  medway: 1980,
  middlesbrough: 2310,
  'milton keynes': 1842,
  'north east lincolnshire': 2147,
  'north lincolnshire': 2057,
  'north somerset': 2252,
  'north yorkshire': 2089,
  northumberland: 2208,
  nottingham: 2250,
  oxford: 1847,
  peterborough: 2030,
  plymouth: 2141,
  portsmouth: 2045,
  reading: 1871,
  'redcar and cleveland': 2319,
  rutland: 2546,
  shropshire: 2136,
  slough: 1752,
  'south gloucestershire': 2187,
  southampton: 2128,
  'southend-on-sea': 1974,
  'stockton-on-tees': 2256,
  'stoke-on-trent': 2029,
  swindon: 1929,
  'telford and wrekin': 2062,
  thurrock: 1929,
  torbay: 2170,
  warrington: 2050,
  'west berkshire': 2078,
  wiltshire: 2248,
  'windsor and maidenhead': 1505,
  wokingham: 1877,
  worcester: 1976,
  york: 2209,
  // Counties (two-tier)
  essex: 2004,
  hampshire: 2041,
  hertfordshire: 2023,
  kent: 1992,
  lancashire: 2057,
  leicestershire: 2044,
  lincolnshire: 1880,
  norfolk: 1878,
  northamptonshire: 1969,
  nottinghamshire: 2053,
  oxfordshire: 1940,
  suffolk: 1960,
  surrey: 2167,
  warwickshire: 2039,
  'west sussex': 1927,
  worcestershire: 2090,
  // England average fallback
  england: 2171,
};

function normaliseAuthority(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /\b(city|borough|district|metropolitan|county|london|council|of|the|and)\b/g,
      '',
    )
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Water & sewerage — there is no free per-property water-bill API (water
 * companies are regional monopolies and don't expose one). The best free
 * signal is each company's published 2024/25 AVERAGE combined bill
 * (Discover Water / Ofwat). We map the property to its water company by
 * postcode area (the first 1-2 letters) and return that company's average.
 * This is a regional average, NOT a metered reading — flagged as such in
 * the UI.
 */
const WATER_COMPANY_BY_AREA: Record<string, string> = {
  // Severn Trent — Midlands
  CV: 'severn-trent', B: 'severn-trent', DY: 'severn-trent', WV: 'severn-trent',
  WS: 'severn-trent', DE: 'severn-trent', NG: 'severn-trent', LE: 'severn-trent',
  ST: 'severn-trent', TF: 'severn-trent', WR: 'severn-trent', HR: 'severn-trent',
  GL: 'severn-trent', SY: 'severn-trent',
  // Thames Water — London & Thames Valley
  E: 'thames', EC: 'thames', N: 'thames', NW: 'thames', SE: 'thames',
  SW: 'thames', W: 'thames', WC: 'thames', RG: 'thames', OX: 'thames',
  SL: 'thames', HA: 'thames', UB: 'thames', TW: 'thames', KT: 'thames',
  SM: 'thames', CR: 'thames', GU: 'thames',
  // United Utilities — North West
  M: 'united-utilities', L: 'united-utilities', PR: 'united-utilities',
  BB: 'united-utilities', BL: 'united-utilities', WN: 'united-utilities',
  WA: 'united-utilities', SK: 'united-utilities', OL: 'united-utilities',
  CW: 'united-utilities', CA: 'united-utilities', LA: 'united-utilities',
  // Yorkshire Water
  LS: 'yorkshire', BD: 'yorkshire', HX: 'yorkshire', HD: 'yorkshire',
  WF: 'yorkshire', S: 'yorkshire', YO: 'yorkshire', HU: 'yorkshire',
  DN: 'yorkshire',
  // Anglian Water — East
  NR: 'anglian', IP: 'anglian', CB: 'anglian', PE: 'anglian', CO: 'anglian',
  CM: 'anglian', SS: 'anglian', LN: 'anglian',
  // Southern Water
  BN: 'southern', PO: 'southern', SO: 'southern', CT: 'southern',
  ME: 'southern', TN: 'southern', RH: 'southern',
  // South West Water
  EX: 'south-west', PL: 'south-west', TQ: 'south-west', TR: 'south-west',
  // Wessex Water
  BA: 'wessex', BS: 'wessex', DT: 'wessex', SP: 'wessex', TA: 'wessex',
  // Northumbrian Water
  NE: 'northumbrian', SR: 'northumbrian', DH: 'northumbrian', DL: 'northumbrian',
  TS: 'northumbrian',
  // Welsh Water (Dwr Cymru)
  CF: 'welsh', SA: 'welsh', NP: 'welsh', LL: 'welsh', LD: 'welsh',
};

// 2024/25 average combined water + sewerage bill (£/yr), Discover Water.
const WATER_AVG_BILL_2024: Record<string, number> = {
  'severn-trent': 448,
  thames: 471,
  'united-utilities': 472,
  yorkshire: 460,
  anglian: 529,
  southern: 478,
  'south-west': 533,
  wessex: 548,
  northumbrian: 422,
  welsh: 580,
};

function estimateWaterCost(postcode?: string | null): {
  annual: number;
  company: string | null;
  source: string;
} {
  const ENGLAND_AVG = 473; // Ofwat England & Wales average 2024/25
  if (!postcode) {
    return { annual: ENGLAND_AVG, company: null, source: 'England & Wales average 2024/25' };
  }
  const area = postcode.trim().toUpperCase().match(/^[A-Z]{1,2}/)?.[0] ?? '';
  // Try 2-letter then 1-letter prefix.
  const company =
    WATER_COMPANY_BY_AREA[area] ??
    WATER_COMPANY_BY_AREA[area.slice(0, 1)] ??
    null;
  if (company && WATER_AVG_BILL_2024[company]) {
    const names: Record<string, string> = {
      'severn-trent': 'Severn Trent', thames: 'Thames Water',
      'united-utilities': 'United Utilities', yorkshire: 'Yorkshire Water',
      anglian: 'Anglian Water', southern: 'Southern Water',
      'south-west': 'South West Water', wessex: 'Wessex Water',
      northumbrian: 'Northumbrian Water', welsh: 'Dŵr Cymru Welsh Water',
    };
    return {
      annual: WATER_AVG_BILL_2024[company],
      company: names[company] ?? company,
      source: `${names[company] ?? company} 2024/25 average`,
    };
  }
  return { annual: ENGLAND_AVG, company: null, source: 'England & Wales average 2024/25' };
}

function estimateCouncilTaxAmount(
  band: string,
  councilName?: string | null,
): number | null {
  // Statutory ratios relative to Band D (9 parts)
  const parts: Record<string, number> = {
    A: 6,
    B: 7,
    C: 8,
    D: 9,
    E: 11,
    F: 13,
    G: 15,
    H: 18,
  };
  const ratio = parts[band.toUpperCase()];
  if (!ratio) return null;

  // Look up real Band D rate for this council
  let bandD = COUNCIL_TAX_RATES_2024['england']; // England average fallback
  if (councilName) {
    const norm = normaliseAuthority(councilName);
    // Try exact match, then partial match
    const exactMatch = COUNCIL_TAX_RATES_2024[norm];
    if (exactMatch) {
      bandD = exactMatch;
    } else {
      // Partial: find a key that the normalised name contains or vice versa
      const partial = Object.entries(COUNCIL_TAX_RATES_2024).find(
        ([k]) => norm.includes(k) || k.includes(norm),
      );
      if (partial) bandD = partial[1];
    }
  }

  return Math.round((bandD * ratio) / 9 / 10) * 10; // round to nearest £10
}

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class PropertyService {
  constructor(
    private prisma: PrismaService,
    private passportService: PassportService,
    private landRegistry: LandRegistryService,
  ) {}

  // In-memory enrichment cache. The /enrichment endpoint aggregates ~10 live
  // external APIs (Overpass, OS, Land Registry, Ofcom…), some of which are
  // slow or intermittently empty. We cache the last successful aggregate per
  // property and MERGE empty sections from a fresh fetch with the cached
  // non-empty values, so schools/transport/sales stop flickering on/off.
  private enrichmentCache = new Map<string, { data: any; ts: number }>();
  private static readonly ENRICHMENT_TTL_MS = 24 * 60 * 60 * 1000; // 24h fresh

  // Overpass (OpenStreetMap) circuit breaker. When every mirror fails we skip
  // Overpass entirely for a cooldown window instead of burning ~60-70s on dead
  // mirror cascades on every request. OS-sourced data (schools) is unaffected.
  private overpassDownUntil = 0;
  private static readonly OVERPASS_COOLDOWN_MS = 5 * 60 * 1000; // 5 min

  async searchProperties(
    query: string,
    offset = 0,
    limit = 10,
    radiusMiles?: number,
  ): Promise<{ items: Property[]; total: number }> {
    const q = query.trim();

    // ── Radius-based search (bounding-box + haversine) ──────────────────────
    if (radiusMiles && radiusMiles > 0) {
      const centre = await this.resolveQueryLatLon(q);
      if (centre) {
        // Ensure DB has something for the postcode by priming it via the
        // normal search path (populates real data from OS Places / EPC).
        // Fire-and-wait first page only.
        try {
          await this.searchProperties(q, 0, limit);
        } catch {
          /* non-critical */
        }
        return this.searchWithinRadius(centre, radiusMiles, offset, limit);
      }
      // Could not resolve centre → fall back to text search below
    }

    const searchCondition = {
      OR: [
        { postcode: { contains: q, mode: 'insensitive' as const } },
        { addressLine1: { contains: q, mode: 'insensitive' as const } },
        { city: { contains: q, mode: 'insensitive' as const } },
        { county: { contains: q, mode: 'insensitive' as const } },
      ],
    };

    // Only treat DB as a cache for real data-sourced properties (OS- or EPC- prefixed udprns).
    // Mock properties (udprn 'MOCK-') are skipped so live APIs are always tried first.
    const realDataCacheWhere = {
      AND: [
        searchCondition,
        {
          OR: [
            { udprn: { startsWith: 'EPC-' } },
            { udprn: { startsWith: 'OS-' } },
          ],
        },
      ],
    };

    const cachedTotal = await this.prisma.property.count({
      where: realDataCacheWhere,
    });

    // When the user queries a UK postcode, EPC knows the true total. If our
    // cache has fewer rows than EPC (first search only fetched the first page
    // and stored 10 rows for a postcode with 24), top up the missing rows
    // before serving from cache. Otherwise the "real total" advertised to the
    // frontend collapses to whatever happened to be cached, and pagination
    // bails out early.
    if (cachedTotal > 0 && looksLikeUkPostcode(q)) {
      try {
        const upstreamTotal = await this.fetchEpcTotal(q);
        if (upstreamTotal > cachedTotal) {
          console.log(
            `[search:epc-topup] ${q}: cache=${cachedTotal} upstream=${upstreamTotal} → fetching ${upstreamTotal - cachedTotal} more rows`,
          );
          // Pull the missing slice (EPC offsets are 0-based) and let the
          // upsert in fetchFromEpc keep the cache consistent.
          await this.fetchFromEpc(q, cachedTotal, upstreamTotal - cachedTotal);
        }
      } catch (err) {
        // Log so throttle / auth failures are visible instead of
        // silently no-op'ing. Non-fatal: serve what we already have.
        console.warn(
          `[search:epc-topup] ${q}: skipped — ${(err as Error)?.message ?? err}`,
        );
      }
      // Also top up from OS Places on the cache-hit path — otherwise
      // postcodes indexed before the OS merge shipped (or long streets
      // where the initial OS call truncated at 100 rows) permanently
      // serve an incomplete set. Cheap: single OS call for a
      // postcode is ~200ms and idempotent under the OS-<UDPRN>
      // upsert key. Tester reported #200 Hay Lane missing on B90 4EQ
      // — this was the branch that ran.
      try {
        const cachedOsCount = await this.prisma.property.count({
          where: {
            AND: [
              searchCondition,
              { udprn: { startsWith: 'OS-' } },
            ],
          },
        });
        // First cheap call to learn the true OS Places total.
        const { total: osTotal } = await this.fetchFromOsPlaces(q, 0, 100);
        // If OS reports more than we have OS-prefixed rows cached,
        // repaginate the whole street. Idempotent upsert makes the
        // repeat safe.
        if (osTotal > cachedOsCount) {
          console.log(
            `[search:os-topup] ${q}: cachedOs=${cachedOsCount} osTotal=${osTotal} → repaginating`,
          );
          await this.fetchAllFromOsPlacesForPostcode(q);
        } else {
          console.log(
            `[search:os-topup] ${q}: cachedOs=${cachedOsCount} osTotal=${osTotal} → no top-up needed`,
          );
        }
      } catch (err) {
        // Same rationale as the EPC block — log the throttle / auth /
        // network error but don't fail the whole search.
        console.warn(
          `[search:os-topup] ${q}: skipped — ${(err as Error)?.message ?? err}`,
        );
      }
    }

    // Re-count after the optional top-up so the response total reflects the
    // post-merge cache size.
    const effectiveTotal = await this.prisma.property.count({
      where: realDataCacheWhere,
    });

    if (effectiveTotal > 0) {
      // When the user queries a UK postcode the result count is small
      // (typically <50 deliveries per postcode) AND it's the one case where
      // pagination consistency matters most — the user scrolls through one
      // street and expects "1, 2, 3, …, 50" as a single ascending sequence.
      //
      // The DB can only sort `addressLine1` lexically ("10" before "2"), so
      // applying `skip + take` on that lexical order and then re-sorting in
      // JS produces batches that look fine in isolation but aren't
      // continuous across page boundaries.
      //
      // Fix: for postcode queries, fetch all matching rows in one go,
      // natural-sort the full list, then slice the requested window. For
      // broader queries we keep DB pagination (the upstream APIs already
      // pre-filter, so the visible result set stays small).
      const isPostcodeQuery = looksLikeUkPostcode(q);
      const rows = await this.prisma.property.findMany({
        where: realDataCacheWhere,
        // Order by addressLine1 ASC so the lexical fetch is deterministic;
        // the JS natural-sort below promotes "9 Woodfield Rd" above "10".
        orderBy: { addressLine1: 'asc' },
        ...(isPostcodeQuery ? {} : { skip: offset, take: limit }),
        include: {
          passports: {
            where: { type: 'SELLER' },
            // Newest first so the de-dup below picks the freshest passport
            // when historical data has duplicates (a now-fixed bug used to
            // create two passports per claim).
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              status: true,
              sections: {
                select: {
                  tasks: {
                    select: {
                      passportQuestions: {
                        select: { id: true, answer: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      // Bulk-fetch saved HomeScore totals so dropdown rows can show HS™ N
      // alongside the EPC grade and passport pill. Falls back to epcScore
      // when no saved score exists.
      const ids = rows.map((r) => r.id);
      const scoreRows = ids.length
        ? await this.prisma.homeScoreResult.findMany({
            where: { propertyId: { in: ids } },
            select: { propertyId: true, total: true, updatedAt: true },
          })
        : [];
      const scoreByProp = new Map<string, number>();
      for (const s of scoreRows) {
        const existing = scoreByProp.get(s.propertyId);
        if (existing == null) scoreByProp.set(s.propertyId, s.total);
      }

      const items = rows.map(({ passports, ...p }) => {
        // Pick a PUBLISHED passport when one exists, even if an older
        // in-progress duplicate sits alongside it. Keeps search badges
        // consistent with the detail page (which uses the same rule).
        const list = (passports as any[]) ?? [];
        const passport =
          list.find((x) => x?.status === 'PUBLISHED') ?? list[0] ?? null;
        const isPublished = passport?.status === 'PUBLISHED';
        let passportCompletion: number | null = null;
        if (passport && isPublished) {
          const allTasks = passport.sections.flatMap((s: any) => s.tasks);
          const doneTasks = allTasks.filter((t: any) => {
            const total = t.passportQuestions.length;
            const answered = t.passportQuestions.filter(
              (q: any) => q.answer !== null,
            ).length;
            return total > 0 && answered === total;
          }).length;
          passportCompletion =
            allTasks.length > 0
              ? Math.round((doneTasks / allTasks.length) * 100)
              : 0;
        }
        const savedHs = scoreByProp.get(p.id);
        const homeScore = savedHs ?? p.epcScore ?? null;
        return {
          ...p,
          addressLine1: titleCase(p.addressLine1) || p.addressLine1,
          addressLine2: p.addressLine2 ? titleCase(p.addressLine2) : p.addressLine2,
          city: p.city ? titleCase(p.city) : p.city,
          county: p.county ? titleCase(p.county) : p.county,
          // Override the stored imageUrl with a live-built one so a key
          // rotation heals every cached row without any DB mutation.
          imageUrl: resolveStreetViewUrl(p),
          hasPassport: !!passport,
          passportPublished: isPublished,
          passportCompletion,
          homeScore,
        };
      });
      // Dedupe by (postcode, addressLine1) — both EPC and OS write to the
      // Property table with distinct UDPRN prefixes, so the same house
      // ends up as two rows when we query both upstreams for a postcode.
      // Prefer the OS row when both exist because OS Places addresses
      // come from Royal Mail PAF and read cleaner ("3 Galmington Drive"
      // vs EPC's "Flat 3, Galmington Drive").
      const dedupeKey = (p: { addressLine1?: string | null; postcode?: string | null }) =>
        `${(p.postcode ?? '').toLowerCase().replace(/\s+/g, '')}|` +
        `${(p.addressLine1 ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const preferred = new Map<string, (typeof items)[number]>();
      for (const it of items) {
        const key = dedupeKey(it);
        const prior = preferred.get(key);
        if (!prior) {
          preferred.set(key, it);
          continue;
        }
        // Row with an OS-prefixed udprn wins over EPC-prefixed.
        const priorIsOs = String(prior.udprn ?? '').startsWith('OS-');
        const currentIsOs = String(it.udprn ?? '').startsWith('OS-');
        if (currentIsOs && !priorIsOs) preferred.set(key, it);
      }
      const deduped = Array.from(preferred.values());
      const sorted = naturalSortByAddress(deduped);
      // For postcode queries we fetched the whole result set above so we
      // can take the requested window from the post-sort list. This is
      // what guarantees a contiguous "1, 2, 3 …" sequence as the user
      // scrolls into batch 2, batch 3, etc.
      const windowed = isPostcodeQuery
        ? sorted.slice(offset, offset + limit)
        : sorted;
      // effectiveTotal came from the pre-dedupe row count; use the
      // deduped length so the frontend paginates against reality.
      return { items: windowed, total: isPostcodeQuery ? sorted.length : effectiveTotal };
    }

    // 2. No real data cached — try OS Places API first.
    //    For postcode queries we eagerly fetch the WHOLE result set from
    //    the upstream so batch 1 / 2 / 3 form a continuous natural order
    //    once they're sliced. Otherwise the first batch is whatever
    //    lexical window the upstream returned, and the second batch
    //    (served from the now-populated cache) won't align with it.
    const isPostcodeQueryFresh = looksLikeUkPostcode(q);
    if (isPostcodeQueryFresh) {
      // For a postcode query we hit BOTH upstream sources so the
      // dropdown includes every deliverable address on the street.
      // OS Places has full UK residential coverage from Royal Mail
      // PAF; EPC still runs so we cache the energy figures.
      //
      // Both fetchers upsert into the DB with distinct UDPRN prefixes
      // (`OS-` vs `EPC-`), so the cache-serving code below can serve
      // the merged set. Promise.allSettled so one slow/failing
      // upstream doesn't drop the other's results.
      //
      // OS Places caps at 100 results per call; long streets like
      // "Hay Lane, B90 4EQ" have 200+ addresses so a single call
      // silently drops the tail. Tester feedback confirmed #200
      // was missing. Now we paginate until totalresults is covered
      // or we hit a safety cap (500 addresses = 5 requests).
      try {
        const epcTotal = await this.fetchEpcTotal(q).catch(() => 0);
        await Promise.allSettled([
          epcTotal > 0 ? this.fetchFromEpc(q, 0, epcTotal) : Promise.resolve(),
          this.fetchAllFromOsPlacesForPostcode(q),
        ]);
        return this.searchProperties(q, offset, limit);
      } catch {
        /* fall through to existing per-batch behaviour */
      }
    }

    const osResult = await this.fetchFromOsPlaces(q, offset, limit);
    if (osResult.total > 0) return osResult;

    // 3. OS returned nothing — call EPC API (also upserts results into DB)
    const epcResult = await this.fetchFromEpc(q, offset, limit);
    if (epcResult.total > 0) return epcResult;

    // No real data and no synthetic fallback — honest empty result.
    // Mock-property generation used to live here, but it persisted fake
    // addresses to the DB that looked indistinguishable from real OS/EPC
    // rows in the UI and lingered after upstream came back online. Better
    // to surface "no results" so the user knows the gov register has
    // nothing for this postcode (or is currently unavailable).
    return { items: [], total: 0 };
  }

  /**
   * Paginate through OS Places' /postcode endpoint until every
   * address on the postcode has been fetched (or a safety cap
   * kicks in). OS caps at 100 rows per call — long streets like
   * "Hay Lane, B90 4EQ" have 200+ addresses and one call silently
   * truncates the tail. Called by the postcode-search fast path
   * so the cache is fully populated for the natural-sort slice
   * that serves the frontend.
   */
  private async fetchAllFromOsPlacesForPostcode(postcode: string) {
    const PER_PAGE = 100;
    const MAX_PAGES = 5; // hard stop at ~500 addresses
    let offset = 0;
    let pagesFetched = 0;
    while (pagesFetched < MAX_PAGES) {
      const { total } = await this.fetchFromOsPlaces(postcode, offset, PER_PAGE);
      pagesFetched++;
      offset += PER_PAGE;
      // Stop when we've fetched past the header-reported total, or
      // when OS reports fewer results than the page size (no more
      // data to page through).
      if (total <= offset) break;
    }
  }

  private async fetchFromOsPlaces(
    query: string,
    offset = 0,
    limit = 10,
  ): Promise<{ items: Property[]; total: number }> {
    const key = process.env.OS_API_KEY;
    if (!key) return { items: [], total: 0 };

    try {
      const isPostcode = /[A-Z]\d/i.test(query) && /\d[A-Z]/i.test(query);
      // OS Places requires properly formatted postcodes with a space
      const formattedQuery = isPostcode ? normalisePostcode(query) : query;
      const encodedQuery = encodeURIComponent(formattedQuery);
      const url = isPostcode
        ? `https://api.os.uk/search/places/v1/postcode?postcode=${encodedQuery}&dataset=DPA&maxresults=${limit}&offset=${offset}&key=${key}`
        : `https://api.os.uk/search/places/v1/find?query=${encodedQuery}&dataset=DPA&maxresults=${limit}&offset=${offset}&key=${key}`;

      const res = await fetch(url);
      if (!res.ok) {
        // Preview the first slice of the body so throttle / auth
        // errors are diagnosable. OS Places returns JSON like
        // {"fault":{"faultstring":"Rate limit quota violation..."}}
        // on both per-minute (50/min) and daily quota exhaustion.
        const preview = await res.text().catch(() => '');
        console.warn(
          `[OS Places] ${isPostcode ? 'postcode' : 'find'}="${formattedQuery}" offset=${offset} → HTTP ${res.status}: ${preview.slice(0, 220)}`,
        );
        return { items: [], total: 0 };
      }

      const data = await res.json();
      const results: any[] = data.results ?? [];
      const total: number = data.header?.totalresults ?? results.length;
      if (isPostcode && offset === 0) {
        console.log(
          `[OS Places] postcode="${formattedQuery}" totalresults=${total} inPage=${results.length}`,
        );
      }

      // Filter down to plausibly-residential addresses. Previously we
      // only accepted `RD*` (Residential Dwelling), which silently
      // dropped houses that OS has classified as `M*` (multi-
      // occupancy — common during HMO conversion), `P*` (Parent
      // Shell — an address being subdivided into flats), or other
      // R-prefix categories like `RC*` communal residence. Tester
      // couldn't find #200 Hay Lane, B90 4EQ which was likely one
      // of those edge classifications. Now we accept anything that
      // ISN'T clearly non-residential (commercial/land/utility/
      // garage). Slight noise risk (a mixed-use shop-with-flat
      // showing up) is preferable to missing houses entirely.
      const NON_RESIDENTIAL_PREFIXES = [
        'CA', 'CB', 'CC', 'CE', 'CF', 'CG', 'CH', 'CI', 'CL', 'CM',
        'CN', 'CO', 'CP', 'CR', 'CS', 'CT', 'CU', 'CV', 'CX', 'CZ', // C* commercial (excluding C99 dual-use)
        'L',   // L* land parcels, garages, industrial land
        'RG',  // Residential garage
        'X',   // X* planning constraints / non-buildings
        'Z',   // Z* uncategorised (rare, often non-address)
      ];
      const isResidentialish = (code: string) => {
        if (!code) return true; // no classification → keep, better safe
        return !NON_RESIDENTIAL_PREFIXES.some((p) => code.startsWith(p));
      };
      const residential = results.filter((r) =>
        isResidentialish(r.DPA?.CLASSIFICATION_CODE ?? ''),
      );
      if (residential.length === 0) return { items: [], total: 0 };

      const saved: Property[] = [];
      for (let i = 0; i < residential.length; i++) {
        const dpa = residential[i].DPA;
        const udprn = `OS-${dpa.UDPRN}`;
        const coords = bngToLatLon(dpa.X_COORDINATE, dpa.Y_COORDINATE);

        const areaInfo = getAreaInfo(dpa.POSTCODE ?? '');
        const uprnDigits =
          parseInt((dpa.UPRN ?? '0').replace(/\D/g, '').slice(-6)) ||
          offset + i;
        const variation = 0.8 + seededRandom(uprnDigits) * 0.4;
        const floorM2 = 80;
        const estimatedPrice =
          Math.round((floorM2 * areaInfo.basePricek * 12 * variation) / 1000) *
          1000;

        const rawAddress1 = dpa.BUILDING_NAME
          ? dpa.BUILDING_NAME
          : `${dpa.BUILDING_NUMBER ?? ''} ${dpa.THOROUGHFARE_NAME ?? ''}`.trim();
        const addressLine1 = titleCase(rawAddress1);

        // Google Street View — built via the shared util so future key
        // rotations only need a .env swap. Stored in the DB as a cache,
        // but resolveStreetViewUrl in the response layer will override
        // whatever's stored with a fresh URL anyway.
        const imageUrl = buildStreetViewUrl(coords.lat, coords.lon);

        const globalIndex = offset + i;

        try {
          const prop = await this.prisma.property.upsert({
            where: { udprn },
            update: {
              uprn: dpa.UPRN ?? null,
              latitude: coords.lat,
              longitude: coords.lon,
              propertyType: osClassToPropertyType(dpa.CLASSIFICATION_CODE),
              city: titleCase(dpa.POST_TOWN),
              county: titleCase(dpa.LOCAL_CUSTODIAN_CODE_DESCRIPTION ?? ''),
              imageUrl,
            },
            create: {
              udprn,
              uprn: dpa.UPRN ?? null,
              addressLine1: addressLine1 || `Property ${globalIndex + 1}`,
              addressLine2: null,
              city: titleCase(dpa.POST_TOWN),
              county: titleCase(dpa.LOCAL_CUSTODIAN_CODE_DESCRIPTION ?? ''),
              postcode: dpa.POSTCODE ?? query.toUpperCase(),
              latitude: coords.lat,
              longitude: coords.lon,
              propertyType: osClassToPropertyType(dpa.CLASSIFICATION_CODE),
              estimatedPrice,
              imageUrl,
            },
          });
          saved.push(prop);
        } catch {
          /* skip constraint violations */
        }
      }

      return { items: naturalSortByAddress(saved), total };
    } catch (err) {
      console.error('OS Places API error:', err);
      return { items: [], total: 0 };
    }
  }

  /**
   * Lightweight EPC HEAD-style call: returns the upstream `total` for a
   * postcode without inserting anything. Used to detect cache underfill.
   * Returns -1 on failure so callers can ignore (treat as "don't know").
   */
  private async fetchEpcTotal(query: string): Promise<number> {
    // Routed through fetchEpcJson so the new-API shape adapter runs;
    // `total` isn't in the new response so we return the row count
    // (a single UK postcode is always <200 rows).
    const data = await fetchEpcJson<{ rows: EpcRow[]; total?: number }>(
      `/api/domestic/search?postcode=${encodeURIComponent(query)}&size=200&from=0`,
    );
    if (!data) return -1;
    if (typeof data.total === 'number' && Number.isFinite(data.total)) return data.total;
    return Array.isArray(data.rows) ? data.rows.length : 0;
  }

  private async fetchFromEpc(
    query: string,
    offset = 0,
    limit = 10,
  ): Promise<{ items: Property[]; total: number }> {
    try {
      const clean = query.replace(/\s/g, '').toUpperCase();
      const data = await fetchEpcJson<{ rows: EpcRow[]; total?: number }>(
        `/api/domestic/search?postcode=${encodeURIComponent(query)}&size=${limit}&from=${offset}`,
      );
      if (!data) return { items: [], total: 0 };
      const rows: EpcRow[] = data.rows ?? [];
      const epcTotal: number = data.total ?? rows.length;
      if (rows.length === 0) return { items: [], total: 0 };

      // Get lat/lon for the postcode via postcodes.io
      let lat: number | null = null;
      let lon: number | null = null;
      try {
        const pcRes = await fetch(
          `https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`,
        );
        if (pcRes.ok) {
          const pcData = await pcRes.json();
          lat = pcData.result?.latitude ?? null;
          lon = pcData.result?.longitude ?? null;
        }
      } catch {
        /* ignore */
      }

      const areaInfo = getAreaInfo(query);

      const saved: Property[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        // Use the full cert mapper so we capture EVERY EPC field — most
        // importantly the lmk-key. Without persisting the lmk-key on
        // first insert, downstream enrichment has no way to fetch
        // recommendations for THIS cert and ends up matching a different
        // (or no) certificate via UPRN/address fallback, which is why
        // properties were ending up with the wrong scores + empty quiz.
        const cert = epcRowToCert(row);
        const mapped = epcRowToProperty(row);
        const globalIndex = offset + i;
        const udprn = mapped.uprn
          ? `EPC-${mapped.uprn}`
          : `EPC-${clean}-${globalIndex}`;

        const jLat = lat
          ? lat + (seededRandom(globalIndex * 17) - 0.5) * 0.008
          : areaInfo.lat;
        const jLon = lon
          ? lon + (seededRandom(globalIndex * 23) - 0.5) * 0.008
          : areaInfo.lon;

        const floorM2 = mapped.floorAreaSqm ?? 80;
        const pricePerSqm = areaInfo.basePricek * 12;
        const estimatedPrice =
          Math.round((floorM2 * pricePerSqm) / 1000) * 1000;

        // Fetch recommendations for THIS cert up-front using its real
        // lmk-key. This locks the property to the correct certificate
        // from the moment of insert, so subsequent enrichment never
        // overrides it with a wrong-cert match.
        //
        // The opendatacommunities recs API is being retired and 404s on
        // many certs now, so fall back to scraping the consumer site
        // when the API returns nothing — same data, different source.
        let recs: any[] = [];
        if (cert.lmkKey) {
          try {
            recs = await this.fetchEpcRecommendations(cert.lmkKey);
          } catch {
            /* leave empty — fallback below */
          }
        }
        if (recs.length === 0 && mapped.postcode && mapped.addressLine1) {
          try {
            recs = await this.scrapeRecommendationsFromGovSite(
              mapped.postcode,
              mapped.addressLine1,
            );
          } catch {
            /* leave empty — recovery path will retry on next load */
          }
        }

        const fullEpcFields = {
          epcRating: cert.epcRating,
          epcScore: cert.epcScore,
          epcRatingPotential: cert.potentialRating,
          epcScorePotential: cert.potentialScore,
          epcLmkKey: cert.lmkKey,
          epcEnrichedAt: new Date(),
          floorAreaSqm: cert.floorAreaSqm,
          sqft: cert.sqft,
          bedrooms: cert.bedrooms,
          tenure: cert.tenure,
          yearBuilt: cert.yearBuilt,
          heatingType: cert.heatingType,
          propertyType: cert.propertyType,
          constructionAgeBand: cert.constructionAgeBand,
          builtForm: cert.builtForm,
          lodgementDate: cert.lodgementDate,
          heatingCostCurrent: cert.heatingCostCurrent,
          hotWaterCostCurrent: cert.hotWaterCostCurrent,
          lightingCostCurrent: cert.lightingCostCurrent,
          heatingCostPotential: cert.heatingCostPotential,
          hotWaterCostPotential: cert.hotWaterCostPotential,
          lightingCostPotential: cert.lightingCostPotential,
          co2Emissions: cert.co2Emissions,
          co2EmissionsPotential: cert.co2EmissionsPotential,
          wallsEnergyEff: cert.wallsEnergyEff,
          wallsDescription: cert.wallsDescription,
          roofEnergyEff: cert.roofEnergyEff,
          roofDescription: cert.roofDescription,
          floorEnergyEff: cert.floorEnergyEff,
          floorDescription: cert.floorDescription,
          windowsEnergyEff: cert.windowsEnergyEff,
          windowsDescription: cert.windowsDescription,
          glazedArea: cert.glazedArea,
          multiGlazeProportion: cert.multiGlazeProportion,
          mainheatEnergyEff: cert.mainheatEnergyEff,
          mainheatDescription: cert.mainheatDescription,
          mainheatcEnergyEff: cert.mainheatcEnergyEff,
          hotWaterEnergyEff: cert.hotWaterEnergyEff,
          hotwaterDescription: cert.hotwaterDescription,
          secondheatDescription: cert.secondheatDescription,
          mainheatcontDescription: cert.mainheatcontDescription,
          mechanicalVentilation: cert.mechanicalVentilation,
          lightingEnergyEff: cert.lightingEnergyEff,
          lowEnergyLighting: cert.lowEnergyLighting,
          ...(cert.councilTaxBand ? { councilTaxBand: cert.councilTaxBand } : {}),
          ...(recs.length > 0 ? { epcRecommendations: recs as any } : {}),
        };

        try {
          const prop = await this.prisma.property.upsert({
            where: { udprn },
            // Overwrite with the fresh cert so older rows that were
            // stored before the V2 fields existed get the full data.
            update: fullEpcFields,
            create: {
              udprn,
              uprn: mapped.uprn,
              addressLine1:
                mapped.addressLine1 || `Property ${globalIndex + 1}`,
              addressLine2: mapped.addressLine2,
              city: mapped.city || areaInfo.city,
              county: mapped.county || areaInfo.county,
              postcode: mapped.postcode || query.toUpperCase(),
              latitude: jLat,
              longitude: jLon,
              estimatedPrice,
              imageUrl: null,
              ...fullEpcFields,
            },
          });
          saved.push(prop);
        } catch {
          /* skip constraint violations */
        }
      }

      return { items: naturalSortByAddress(saved), total: epcTotal };
    } catch (err) {
      console.error('EPC API error:', err);
      return { items: [], total: 0 };
    }
  }

  /**
   * Helper: Ensure EPC fields are populated by fetching from external API if missing.
   * This is called after fetching a property to guarantee EPC data (titleNumber, floorAreaSqm, epcRating, tenure, yearBuilt).
   */
  private async enrichPropertyWithEpc(property: Property): Promise<Property> {
    // Early return only if BOTH basic fields AND the V2 fabric/recs fields the
    // simulator depends on are present. Without the V2 fields the homescore
    // simulator falls back to generic hardcoded copy ("75mm loft · EPC: Average")
    // even for properties whose real EPC describes different fabric.
    const hasV2Detail =
      (property as any).wallsDescription &&
      (property as any).roofDescription &&
      Array.isArray((property as any).epcRecommendations) &&
      (property as any).epcRecommendations.length > 0;
    if (
      property.epcRating &&
      property.floorAreaSqm &&
      property.tenure &&
      property.yearBuilt &&
      property.titleNumber &&
      (property as any).heatingCostCurrent != null &&
      hasV2Detail
    ) {
      console.log(
        `[Enrich] Property ${property.id} already has all EPC fields`,
      );
      return property;
    }

    console.log(
      `[Enrich] Starting enrichment for property ${property.id} (${property.addressLine1}, ${property.postcode})`,
    );

    // Fetch EPC data - try UPRN first, then fall back to address search
    let epcData: any = null;

    if (property.uprn) {
      console.log(`[Enrich] Trying UPRN lookup for ${property.uprn}`);
      epcData = await this.fetchEpcData(property.uprn);
      if (epcData) {
        console.log(`[Enrich] UPRN lookup succeeded`);
      } else {
        console.log(`[Enrich] UPRN lookup returned no data`);
      }
    }

    // If UPRN lookup failed or no UPRN, try address search
    if (!epcData && property.postcode && property.addressLine1) {
      console.log(`[Enrich] Trying address search fallback`);
      epcData = await this.fetchEpcDataByAddress(
        property.postcode,
        property.addressLine1,
      );
      if (epcData) {
        console.log(`[Enrich] Address search succeeded`);
      } else {
        console.log(`[Enrich] Address search returned no data`);
      }
    }

    // Ensure we have all EPC fields (even if null) and always generate titleNumber
    if (epcData) {
      const updateData: any = {};

      // Only update fields that are missing in the property
      if (!property.epcRating) updateData.epcRating = epcData.epcRating ?? null;
      if (!property.epcScore) updateData.epcScore = epcData.epcScore ?? null;
      if (!property.floorAreaSqm)
        updateData.floorAreaSqm = epcData.floorAreaSqm ?? null;
      if (!property.sqft) updateData.sqft = epcData.sqft ?? null;
      if (!property.bedrooms) updateData.bedrooms = epcData.bedrooms ?? null;
      if (!property.tenure) updateData.tenure = epcData.tenure ?? null;
      if (!property.yearBuilt) updateData.yearBuilt = epcData.yearBuilt ?? null;
      if (!property.heatingType)
        updateData.heatingType = epcData.heatingType ?? null;
      if (!property.councilTaxBand)
        updateData.councilTaxBand = epcData.councilTaxBand ?? null;

      // V2 EPC cost fields — always populate if EPC data has them
      if ((property as any).heatingCostCurrent == null && epcData.heatingCostCurrent != null)
        updateData.heatingCostCurrent = epcData.heatingCostCurrent;
      if ((property as any).hotWaterCostCurrent == null && epcData.hotWaterCostCurrent != null)
        updateData.hotWaterCostCurrent = epcData.hotWaterCostCurrent;
      if ((property as any).lightingCostCurrent == null && epcData.lightingCostCurrent != null)
        updateData.lightingCostCurrent = epcData.lightingCostCurrent;

      // EPC "potential" figures — drive the env-impact card + "could fall to"
      // line on running costs with real EPC numbers (no heuristics).
      if ((property as any).heatingCostPotential == null && epcData.heatingCostPotential != null)
        updateData.heatingCostPotential = epcData.heatingCostPotential;
      if ((property as any).hotWaterCostPotential == null && epcData.hotWaterCostPotential != null)
        updateData.hotWaterCostPotential = epcData.hotWaterCostPotential;
      if ((property as any).lightingCostPotential == null && epcData.lightingCostPotential != null)
        updateData.lightingCostPotential = epcData.lightingCostPotential;
      if ((property as any).co2Emissions == null && epcData.co2Emissions != null)
        updateData.co2Emissions = epcData.co2Emissions;
      if ((property as any).co2EmissionsPotential == null && epcData.co2EmissionsPotential != null)
        updateData.co2EmissionsPotential = epcData.co2EmissionsPotential;
      if (!(property as any).epcRatingPotential && epcData.potentialRating)
        updateData.epcRatingPotential = epcData.potentialRating;
      if ((property as any).epcScorePotential == null && epcData.potentialScore != null)
        updateData.epcScorePotential = epcData.potentialScore;

      // EPC certificate LMK key — needed to re-fetch recommendations later
      // without doing another address search.
      if (!(property as any).epcLmkKey && epcData.lmkKey)
        updateData.epcLmkKey = epcData.lmkKey;

      // Pull per-cert improvement recommendations once we know the LMK key.
      // Stored as JSON so the simulator can render real improvements with
      // real £ savings instead of the hardcoded fallback list.
      const lmkForRecs = epcData.lmkKey || (property as any).epcLmkKey;
      const hasRecs =
        Array.isArray((property as any).epcRecommendations) &&
        (property as any).epcRecommendations.length > 0;
      if (lmkForRecs && !hasRecs) {
        try {
          const recs = await this.fetchEpcRecommendations(lmkForRecs);
          if (recs.length > 0) updateData.epcRecommendations = recs as any;
        } catch {
          /* non-fatal — leave to next enrichment */
        }
      }

      // V2 EPC insulation/fabric fields
      if (!(property as any).wallsEnergyEff && epcData.wallsEnergyEff)
        updateData.wallsEnergyEff = epcData.wallsEnergyEff;
      if (!(property as any).wallsDescription && epcData.wallsDescription)
        updateData.wallsDescription = epcData.wallsDescription;
      if (!(property as any).roofEnergyEff && epcData.roofEnergyEff)
        updateData.roofEnergyEff = epcData.roofEnergyEff;
      if (!(property as any).roofDescription && epcData.roofDescription)
        updateData.roofDescription = epcData.roofDescription;
      if (!(property as any).floorEnergyEff && epcData.floorEnergyEff)
        updateData.floorEnergyEff = epcData.floorEnergyEff;
      if (!(property as any).windowsEnergyEff && epcData.windowsEnergyEff)
        updateData.windowsEnergyEff = epcData.windowsEnergyEff;
      if (!(property as any).windowsDescription && epcData.windowsDescription)
        updateData.windowsDescription = epcData.windowsDescription;
      if ((property as any).multiGlazeProportion == null && epcData.multiGlazeProportion != null)
        updateData.multiGlazeProportion = epcData.multiGlazeProportion;

      // V2 EPC heating/HW fields
      if (!(property as any).mainheatEnergyEff && epcData.mainheatEnergyEff)
        updateData.mainheatEnergyEff = epcData.mainheatEnergyEff;
      if (!(property as any).mainheatDescription && epcData.mainheatDescription)
        updateData.mainheatDescription = epcData.mainheatDescription;
      if (!(property as any).mainheatcEnergyEff && epcData.mainheatcEnergyEff)
        updateData.mainheatcEnergyEff = epcData.mainheatcEnergyEff;
      if (!(property as any).hotWaterEnergyEff && epcData.hotWaterEnergyEff)
        updateData.hotWaterEnergyEff = epcData.hotWaterEnergyEff;
      if (!(property as any).hotwaterDescription && epcData.hotwaterDescription)
        updateData.hotwaterDescription = epcData.hotwaterDescription;
      if (!(property as any).mainheatcontDescription && epcData.mainheatcontDescription)
        updateData.mainheatcontDescription = epcData.mainheatcontDescription;

      // V2 EPC controls/ventilation/lighting fields
      if (!(property as any).mechanicalVentilation && epcData.mechanicalVentilation)
        updateData.mechanicalVentilation = epcData.mechanicalVentilation;
      if (!(property as any).lightingEnergyEff && epcData.lightingEnergyEff)
        updateData.lightingEnergyEff = epcData.lightingEnergyEff;
      if ((property as any).lowEnergyLighting == null && epcData.lowEnergyLighting != null)
        updateData.lowEnergyLighting = epcData.lowEnergyLighting;

      // V2 EPC renewables
      if ((property as any).photoSupply == null && epcData.photoSupply != null)
        updateData.photoSupply = epcData.photoSupply;
      if ((property as any).solarWaterHeatingFlag == null && epcData.solarWaterHeatingFlag != null)
        updateData.solarWaterHeatingFlag = epcData.solarWaterHeatingFlag;
      if ((property as any).windTurbineCount == null && epcData.windTurbineCount != null)
        updateData.windTurbineCount = epcData.windTurbineCount;

      // V2 EPC metadata
      if (!(property as any).constructionAgeBand && epcData.constructionAgeBand)
        updateData.constructionAgeBand = epcData.constructionAgeBand;
      if (!(property as any).builtForm && epcData.builtForm)
        updateData.builtForm = epcData.builtForm;
      if (!(property as any).lodgementDate && epcData.lodgementDate)
        updateData.lodgementDate = epcData.lodgementDate;

      // titleNumber is intentionally NOT populated here. The only
      // trustworthy source is HMLR (set by verifyOwnershipWithLandRegistry
      // on a SINGLE_MATCH). OS Places / EPC don't return it; synthesising
      // one would poison the HMLR lookup later (queries fake number,
      // gets NO_MATCHES) and present fabricated register IDs to the user.

      if (Object.keys(updateData).length > 0) {
        updateData.epcEnrichedAt = new Date();
        try {
          console.log(
            `[Enrich] Updating property with fields: ${Object.keys(updateData).join(', ')}`,
          );
          const updated = await this.prisma.property.update({
            where: { id: property.id },
            data: updateData,
          });
          console.log(`[Enrich] Successfully updated property ${property.id}`);
          return updated;
        } catch (error) {
          // If DB update fails, still return enriched object in memory
          console.error(
            `[Enrich] Failed to update property ${property.id} with EPC data:`,
            error,
          );
          return { ...property, ...updateData };
        }
      }
    }

    // Recovery: if the property already has a persisted `epcLmkKey` from a
    // previous enrichment but `epcRecommendations` is still empty (e.g. the
    // recommendations call failed back then), retry the recommendations
    // fetch on its own — independent of whether THIS enrichment cycle's
    // address/UPRN lookup succeeded.
    const persistedLmk = (property as any).epcLmkKey;
    const persistedHasRecs =
      Array.isArray((property as any).epcRecommendations) &&
      (property as any).epcRecommendations.length > 0;
    if (persistedLmk && !persistedHasRecs) {
      console.log(
        `[Enrich] Retrying recommendations for stored LMK ${persistedLmk}`,
      );
      try {
        const recs = await this.fetchEpcRecommendations(persistedLmk);
        if (recs.length > 0) {
          try {
            const updated = await this.prisma.property.update({
              where: { id: property.id },
              data: { epcRecommendations: recs as any },
            });
            console.log(
              `[Enrich] Recovered ${recs.length} recommendations from LMK`,
            );
            property = updated;
          } catch (err) {
            console.error(`[Enrich] Failed to persist recovered recs:`, err);
            (property as any).epcRecommendations = recs;
          }
        }
      } catch (err) {
        console.error(`[Enrich] Recommendations recovery failed:`, err);
      }
    }

    // titleNumber stays null until HMLR confirms one (see comment on
    // the earlier call site).

    // ── Council Tax Finder API ─────────────────────────────────────────────
    // Per-address band + £ figure. Cached on the row for 30 days. Skipped when
    // the API key isn't set or the upstream errors (geo-block, etc.) — caller
    // gracefully falls back to the band-D-average estimator.
    await this.maybeEnrichCouncilTax(property);

    console.log(`[Enrich] Returning property without any updates`);
    return property;
  }

  /**
   * Refresh the Council Tax Finder columns on a property row when missing or
   * older than 30 days. Mutates the passed property object in-place so callers
   * see the new fields without re-fetching. Errors are swallowed.
   */
  private async maybeEnrichCouncilTax(property: any): Promise<void> {
    if (!property?.postcode) return;
    const fresh =
      property.councilTaxAnnual != null &&
      property.councilTaxFetchedAt &&
      Date.now() - new Date(property.councilTaxFetchedAt).getTime() <
        30 * 24 * 60 * 60 * 1000; // 30 days
    if (fresh) return;

    const result = await this.fetchCouncilTaxFinder(
      property.postcode,
      property.addressLine1 ?? null,
    );
    if (!result) return;

    try {
      const updated = await this.prisma.property.update({
        where: { id: property.id },
        data: {
          councilTaxBand: result.band,
          councilTaxAnnual: result.annual,
          councilTaxCouncilName: result.councilName,
          councilTaxCouncilWeb: result.councilWeb,
          councilTaxRef: result.laRef,
          councilTaxYear: result.taxYear,
          councilTaxFetchedAt: new Date(),
        } as any,
      });
      Object.assign(property, updated);
    } catch (error) {
      console.error(
        `[Enrich] Failed to persist council tax data for ${property.id}:`,
        error,
      );
    }
  }

  /**
   * Force a fresh EPC enrichment, ignoring the "already has EPC fields"
   * early-return. Used when the persisted recommendations array is empty
   * but the property has clearly been seen by the EPC Register before.
   * Returns the updated property row.
   */
  async refreshEpc(id: string): Promise<any | null> {
    const property = await this.prisma.property.findUnique({
      where: { id },
    });
    if (!property) return null;

    console.log(
      `[Enrich][force] Refreshing EPC for property ${id} (${property.addressLine1}, ${property.postcode})`,
    );

    // Re-fetch strategy.
    //
    // KNOWN OPEN DATA COMMUNITIES API BUG: the `/api/v1/domestic/search`
    // endpoint silently ignores `?lmk-key=X` and returns an arbitrary
    // first row, NOT the cert with that key. So we can never use the
    // search endpoint to verify a persisted key — doing so swaps the
    // cert under us and corrupts the property (this happened to 3
    // Austen Road).
    //
    // Rules:
    //   1. If we ALREADY have a persisted `epcLmkKey`, trust it. Don't
    //      re-fetch the cert. Only use the key to top up missing recs.
    //   2. If we DON'T have a persisted key, try UPRN → address lookup
    //      once. Store whatever cert comes back as the canonical match.
    //   3. Never overwrite `epcLmkKey` once set. The key is the
    //      identity of the cert; if it changes, we have a different
    //      property's data and that's worse than stale data.
    const persistedLmk = (property as any).epcLmkKey || null;
    let epcData: any = null;

    if (!persistedLmk) {
      if (property.uprn) {
        epcData = await this.fetchEpcData(property.uprn);
        if (epcData) {
          console.log(
            `[Enrich][force] UPRN lookup hit (lmk=${epcData.lmkKey})`,
          );
        }
      }
      if (!epcData && property.postcode && property.addressLine1) {
        epcData = await this.fetchEpcDataByAddress(
          property.postcode,
          property.addressLine1,
        );
        if (epcData) {
          console.log(
            `[Enrich][force] Address lookup hit (lmk=${epcData.lmkKey})`,
          );
        }
      }
    }

    const updateData: any = {};
    const fresh = epcData;
    // The lmk key we use for recs is ALWAYS the persisted one when set.
    // Only when no key was persisted do we accept a freshly-discovered one.
    const lmkKey = persistedLmk || fresh?.lmkKey || null;

    if (fresh) {
      if (fresh.epcRating) updateData.epcRating = fresh.epcRating;
      if (fresh.epcScore != null) updateData.epcScore = fresh.epcScore;
      if (fresh.lmkKey) updateData.epcLmkKey = fresh.lmkKey;
      if (fresh.potentialRating) updateData.epcRatingPotential = fresh.potentialRating;
      if (fresh.potentialScore != null) updateData.epcScorePotential = fresh.potentialScore;
      if (fresh.wallsEnergyEff) updateData.wallsEnergyEff = fresh.wallsEnergyEff;
      if (fresh.wallsDescription) updateData.wallsDescription = fresh.wallsDescription;
      if (fresh.roofEnergyEff) updateData.roofEnergyEff = fresh.roofEnergyEff;
      if (fresh.roofDescription) updateData.roofDescription = fresh.roofDescription;
      if (fresh.floorEnergyEff) updateData.floorEnergyEff = fresh.floorEnergyEff;
      if (fresh.floorDescription) updateData.floorDescription = fresh.floorDescription;
      if (fresh.windowsEnergyEff) updateData.windowsEnergyEff = fresh.windowsEnergyEff;
      if (fresh.windowsDescription) updateData.windowsDescription = fresh.windowsDescription;
      if (fresh.mainheatEnergyEff) updateData.mainheatEnergyEff = fresh.mainheatEnergyEff;
      if (fresh.mainheatDescription) updateData.mainheatDescription = fresh.mainheatDescription;
      if (fresh.mainheatcEnergyEff) updateData.mainheatcEnergyEff = fresh.mainheatcEnergyEff;
      if (fresh.mainheatcontDescription) updateData.mainheatcontDescription = fresh.mainheatcontDescription;
      if (fresh.hotWaterEnergyEff) updateData.hotWaterEnergyEff = fresh.hotWaterEnergyEff;
      if (fresh.hotwaterDescription) updateData.hotwaterDescription = fresh.hotwaterDescription;
      if (fresh.lightingEnergyEff) updateData.lightingEnergyEff = fresh.lightingEnergyEff;
      if (fresh.lowEnergyLighting != null) updateData.lowEnergyLighting = fresh.lowEnergyLighting;
      if (fresh.heatingCostCurrent != null) updateData.heatingCostCurrent = fresh.heatingCostCurrent;
      if (fresh.hotWaterCostCurrent != null) updateData.hotWaterCostCurrent = fresh.hotWaterCostCurrent;
      if (fresh.lightingCostCurrent != null) updateData.lightingCostCurrent = fresh.lightingCostCurrent;
      if (fresh.heatingCostPotential != null) updateData.heatingCostPotential = fresh.heatingCostPotential;
      if (fresh.hotWaterCostPotential != null) updateData.hotWaterCostPotential = fresh.hotWaterCostPotential;
      if (fresh.lightingCostPotential != null) updateData.lightingCostPotential = fresh.lightingCostPotential;
      if (fresh.co2Emissions != null) updateData.co2Emissions = fresh.co2Emissions;
      if (fresh.co2EmissionsPotential != null) updateData.co2EmissionsPotential = fresh.co2EmissionsPotential;
    }

    // Always pull recommendations if we have a key — this is the bit the
    // normal flow often misses because the recs call is nested inside
    // `if (epcData)`. Here we run it unconditionally as long as we have
    // the LMK key (either fresh or persisted).
    if (lmkKey) {
      try {
        let recs = await this.fetchEpcRecommendations(lmkKey);
        console.log(
          `[Enrich][force] Recommendations from API for LMK ${lmkKey}: ${recs.length} rows`,
        );
        // The opendatacommunities recs endpoint 404s for many certs as
        // the dataset is being retired. Fall back to scraping the
        // consumer site, which still renders the same recommendations.
        if (
          recs.length === 0 &&
          property.postcode &&
          property.addressLine1
        ) {
          recs = await this.scrapeRecommendationsFromGovSite(
            property.postcode,
            property.addressLine1,
          );
          console.log(
            `[Enrich][force] Recommendations from gov scrape: ${recs.length} rows`,
          );
        }
        if (recs.length > 0) updateData.epcRecommendations = recs as any;
      } catch (err) {
        console.error(`[Enrich][force] Recs fetch failed:`, err);
      }
    } else if (property.postcode && property.addressLine1) {
      // No LMK key on file — still try the gov-site scrape using the
      // address. Often gets us recs even when the API never matched.
      try {
        const recs = await this.scrapeRecommendationsFromGovSite(
          property.postcode,
          property.addressLine1,
        );
        console.log(
          `[Enrich][force] Recommendations from gov scrape (no LMK): ${recs.length} rows`,
        );
        if (recs.length > 0) updateData.epcRecommendations = recs as any;
      } catch (err) {
        console.error(`[Enrich][force] Gov scrape failed:`, err);
      }
    } else {
      console.log(`[Enrich][force] No LMK key available for property ${id}`);
    }

    if (Object.keys(updateData).length === 0) {
      console.log(`[Enrich][force] No fields to update for property ${id}`);
      return property;
    }

    updateData.epcEnrichedAt = new Date();
    try {
      const updated = await this.prisma.property.update({
        where: { id },
        data: updateData,
      });
      console.log(
        `[Enrich][force] Updated property ${id} with ${Object.keys(updateData).length} fields`,
      );
      return updated;
    } catch (err) {
      console.error(`[Enrich][force] DB update failed:`, err);
      return { ...property, ...updateData };
    }
  }

  async getPropertyById(id: string): Promise<any | null> {
    const property = await this.prisma.property.findUnique({
      where: { id },
      include: {
        passports: {
          select: { id: true, status: true, type: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!property) return null;

    // Normalise casing for properties already in DB with incorrect casing.
    // We surface the seller passport as "the" passport because the public
    // property view is buyer-facing — landlord passports are private to the
    // landlord and should never be exposed here. When more than one SELLER
    // passport exists for a property (legacy duplicates from the old
    // double-create bug), pick the PUBLISHED one over any in-progress
    // sibling so the badge state matches the search dropdown.
    const { passports, ...rest } = property as any;
    const sellerPassports = (passports as any[])?.filter((p) => p.type === 'SELLER') ?? [];
    const sellerPassport =
      sellerPassports.find((p) => p.status === 'PUBLISHED') ??
      sellerPassports[0] ??
      null;
    const normalised = {
      ...rest,
      addressLine1: titleCase(rest.addressLine1) || rest.addressLine1,
      addressLine2: rest.addressLine2 ? titleCase(rest.addressLine2) : rest.addressLine2,
      city: rest.city ? titleCase(rest.city) : rest.city,
      county: rest.county ? titleCase(rest.county) : rest.county,
      // Public passport state — readable by guests for the 3-state homescore UI.
      hasPassport: !!sellerPassport,
      passportPublished: sellerPassport?.status === 'PUBLISHED',
      passportId: sellerPassport?.id ?? null,
    };

    // Enrich with EPC data if fields are missing (non-blocking, always returns a property)
    return this.enrichPropertyWithEpc(normalised as unknown as Property);
  }

  // ── Enrichment (on-demand, not stored) ────────────────────────────────────

  // Diagnostic endpoint: which enrichment sources succeeded, which returned
  // empty payloads, which threw. Used to surface why a sheet is "missing data"
  // without having to tail the backend logs.
  async getEnrichmentDebug(propertyId: string): Promise<any> {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        id: true,
        latitude: true,
        longitude: true,
        postcode: true,
        uprn: true,
        addressLine1: true,
      },
    });
    if (!property) return { error: 'Property not found' };

    const lat = property.latitude;
    const lon = property.longitude;
    const postcode = property.postcode;
    const uprn = property.uprn;

    const env = {
      OS_API_KEY: !!process.env.OS_API_KEY,
      OFCOM_API_KEY: !!process.env.OFCOM_API_KEY,
      GOOGLE_API_KEY: !!process.env.GOOGLE_API_KEY,
      EPC_API_KEY: !!process.env.EPC_API_KEY,
      MAPBOX_TOKEN: !!process.env.MAPBOX_TOKEN,
    };

    const probe = async <T>(
      name: string,
      fn: () => Promise<T>,
    ): Promise<{ source: string; status: string; count?: number; sample?: any; error?: string; ms: number }> => {
      const t0 = Date.now();
      try {
        const value = await fn();
        const ms = Date.now() - t0;
        let count: number | undefined;
        let sample: any;
        if (Array.isArray(value)) {
          count = value.length;
          sample = value[0];
        } else if (value && typeof value === 'object') {
          sample = value;
        } else {
          sample = value;
        }
        const status =
          value === null || value === undefined
            ? 'null'
            : Array.isArray(value) && value.length === 0
              ? 'empty'
              : 'ok';
        return { source: name, status, count, sample, ms };
      } catch (e: any) {
        return {
          source: name,
          status: 'error',
          error: String(e?.message ?? e).slice(0, 200),
          ms: Date.now() - t0,
        };
      }
    };

    const results = await Promise.all([
      probe('nearby (OS NGD + Overpass)', () =>
        lat && lon
          ? this.fetchNearbyOS(lat, lon)
          : Promise.resolve({ skipped: true } as any),
      ),
      probe('floodRisk (EA)', () =>
        lat && lon ? this.fetchFloodDetail(lat, lon) : Promise.resolve(null),
      ),
      probe('broadband (Ofcom)', () =>
        postcode ? (this as any).fetchBroadband(postcode) : Promise.resolve(null),
      ),
      probe('mobileSignal (Ofcom)', () =>
        postcode ? (this as any).fetchMobileSignal(postcode) : Promise.resolve(null),
      ),
      probe('osPlaces (OS Places)', () =>
        postcode ? (this as any).fetchOsPlaces(postcode) : Promise.resolve(null),
      ),
      probe('epc (EPC Register)', () =>
        uprn
          ? (this as any).fetchEpcData(uprn)
          : (this as any).fetchEpcDataByAddress(postcode, property.addressLine1),
      ),
      probe('planning (planning.data.gov.uk)', () =>
        lat && lon
          ? (this as any).fetchPlanningData(lat, lon, uprn)
          : Promise.resolve({ constraints: [], applications: [] }),
      ),
      probe('titleBoundary (OS NGD buildings)', () =>
        lat && lon
          ? (this as any).fetchInspireBoundary(lat, lon)
          : Promise.resolve(null),
      ),
      probe('nearbyCouncilTax', () =>
        postcode
          ? (this as any).fetchNearbyCouncilTax(postcode)
          : Promise.resolve(null),
      ),
    ]);

    // For the OS+Overpass combined fetch, also break out the sub-arrays so the
    // caller can see which Overpass categories came back empty.
    const nearby = results[0]?.sample as any;
    const overpassBreakdown = nearby && typeof nearby === 'object'
      ? {
          schools: Array.isArray(nearby.schools) ? nearby.schools.length : null,
          trains: Array.isArray(nearby.trains) ? nearby.trains.length : null,
          busStops: Array.isArray(nearby.busStops) ? nearby.busStops.length : null,
          parks: Array.isArray(nearby.parks) ? nearby.parks.length : null,
          airports: Array.isArray(nearby.airports) ? nearby.airports.length : null,
          listedBuildings: Array.isArray(nearby.listedBuildings)
            ? nearby.listedBuildings.length
            : null,
          amenities: Array.isArray(nearby.amenities) ? nearby.amenities.length : null,
        }
      : null;

    return {
      property: {
        id: property.id,
        postcode,
        lat,
        lon,
        uprn,
      },
      env,
      overpassBreakdown,
      sources: results.map((r) => ({
        source: r.source,
        status: r.status,
        count: r.count,
        ms: r.ms,
        error: r.error,
      })),
    };
  }

  // Public entry point. Serves a cached aggregate when available (instantly,
  // refreshing stale data in the background) so the buyer report doesn't wait
  // ~60-70s on live external APIs, and so intermittently-empty sections
  // (schools, transport, sales) stop flickering between loads.
  async getPropertyEnrichment(propertyId: string) {
    const cached = this.enrichmentCache.get(propertyId);
    const age = cached ? Date.now() - cached.ts : Infinity;

    if (cached && age < PropertyService.ENRICHMENT_TTL_MS) {
      return cached.data; // fresh enough — serve as-is
    }

    if (cached) {
      // Stale: serve cached immediately, refresh in the background. Merge so
      // any section the refresh can't fetch keeps its last good value.
      this.computeEnrichment(propertyId)
        .then((fresh) => {
          if (!fresh) return;
          const merged = this.mergeEnrichment(cached.data, fresh);
          this.enrichmentCache.set(propertyId, { data: merged, ts: Date.now() });
        })
        .catch(() => {});
      return cached.data;
    }

    // Cold: compute synchronously, then cache.
    const fresh = await this.computeEnrichment(propertyId);
    if (fresh) this.enrichmentCache.set(propertyId, { data: fresh, ts: Date.now() });
    return fresh;
  }

  // Backfill empty sections of a fresh aggregate from the previous good one.
  // `fresh` wins whenever it has data; `prev` only fills the gaps. This is
  // what stops schools/transport/sales toggling to empty when an upstream API
  // returns nothing on a given request.
  private mergeEnrichment(prev: any, fresh: any): any {
    if (!prev) return fresh;
    if (!fresh) return prev;
    const out = { ...fresh };

    const prevNearby = prev.nearby || {};
    const freshNearby = fresh.nearby || {};
    const mergedNearby: any = { ...freshNearby };
    for (const key of ['schools', 'trains', 'busStops', 'parks', 'airports', 'amenities', 'listedBuildings']) {
      const f = Array.isArray(freshNearby[key]) ? freshNearby[key] : [];
      const p = Array.isArray(prevNearby[key]) ? prevNearby[key] : [];
      mergedNearby[key] = f.length ? f : p;
    }
    out.nearby = mergedNearby;

    const fSales = fresh.salesHistory || {};
    const pSales = prev.salesHistory || {};
    out.salesHistory = {
      thisProperty: (fSales.thisProperty?.length ? fSales.thisProperty : pSales.thisProperty) || [],
      nearbySales: (fSales.nearbySales?.length ? fSales.nearbySales : pSales.nearbySales) || [],
    };

    // Scalars / objects: keep fresh when present, else fall back.
    for (const key of ['broadband', 'mobileSignal', 'floodRisk', 'landRegistryEstimate', 'listedBuildings']) {
      if (out[key] == null && prev[key] != null) out[key] = prev[key];
    }
    // Crime: a non-null object with zero total is effectively "no data this
    // fetch" — fall back to the last good crime figures if we have them.
    const freshCrimeEmpty = !out.crime || !(out.crime.totalLast12m > 0);
    if (freshCrimeEmpty && prev.crime?.totalLast12m > 0) out.crime = prev.crime;
    return out;
  }

  private async computeEnrichment(propertyId: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
    });
    if (!property) return null;

    const lat = property.latitude;
    const lon = property.longitude;
    const postcode = property.postcode;
    const uprn = property.uprn;

    const [
      nearby,
      floodRiskRaw,
      salesHistory,
      broadband,
      mobileSignal,
      osPlaces,
      epcData,
      planningData,
      nearbyCtData,
      titleBoundary,
      crimeStats,
    ] = await Promise.allSettled([
      lat && lon
        ? this.fetchNearbyOS(lat, lon)
        : Promise.resolve({
            schools: [],
            trains: [],
            busStops: [],
            parks: [],
            airports: [],
            listedBuildings: [],
            amenities: [],
          }),
      lat && lon ? this.fetchFloodDetail(lat, lon) : Promise.resolve(null),
      this.fetchPropertySalesHistory(postcode, property.addressLine1),
      this.fetchBroadband(postcode),
      this.fetchMobileSignal(postcode),
      this.fetchOsPlaces(postcode),
      uprn
        ? this.fetchEpcData(uprn)
        : this.fetchEpcDataByAddress(postcode, property.addressLine1),
      lat && lon
        ? this.fetchPlanningData(lat, lon, uprn)
        : Promise.resolve({ constraints: [], applications: [] }),
      this.fetchNearbyCouncilTax(postcode),
      lat && lon ? this.fetchInspireBoundary(lat, lon) : Promise.resolve(null),
      lat && lon ? this.fetchCrimeStats(lat, lon) : Promise.resolve(null),
    ]);

    // Detail-page hero uses a slightly higher pitch than the search
    // card thumbnail, but everything else is identical.
    const streetViewUrl = buildStreetViewUrl(lat, lon, { pitch: 10 });

    const floodData =
      floodRiskRaw.status === 'fulfilled' ? floodRiskRaw.value : null;
    const osData = osPlaces.status === 'fulfilled' ? osPlaces.value : null;
    const epc = epcData.status === 'fulfilled' ? epcData.value : null;
    const planning =
      planningData.status === 'fulfilled'
        ? planningData.value
        : { constraints: [], applications: [] };

    // Council tax band — best available source: EPC per-property lookup → DB → null
    const ctBand = epc?.councilTaxBand ?? property.councilTaxBand ?? null;

    // Back-fill EPC fields into the DB for OS-sourced properties that were created without them (non-blocking)
    if (epc && !property.epcRating) {
      this.prisma.property
        .update({
          where: { id: propertyId },
          data: {
            ...(epc.epcRating ? { epcRating: epc.epcRating } : {}),
            ...(epc.epcScore ? { epcScore: epc.epcScore } : {}),
            ...(epc.floorAreaSqm ? { floorAreaSqm: epc.floorAreaSqm } : {}),
            ...(epc.sqft ? { sqft: epc.sqft } : {}),
            ...(epc.bedrooms ? { bedrooms: epc.bedrooms } : {}),
            ...(epc.tenure ? { tenure: epc.tenure } : {}),
            ...(epc.yearBuilt ? { yearBuilt: epc.yearBuilt } : {}),
            ...(epc.heatingType ? { heatingType: epc.heatingType } : {}),
            ...(epc.councilTaxBand
              ? { councilTaxBand: epc.councilTaxBand }
              : {}),
            // V2 EPC cost fields
            ...(epc.heatingCostCurrent != null
              ? { heatingCostCurrent: epc.heatingCostCurrent }
              : {}),
            ...(epc.hotWaterCostCurrent != null
              ? { hotWaterCostCurrent: epc.hotWaterCostCurrent }
              : {}),
            ...(epc.lightingCostCurrent != null
              ? { lightingCostCurrent: epc.lightingCostCurrent }
              : {}),
            // V2 EPC insulation/fabric fields
            ...(epc.wallsEnergyEff
              ? { wallsEnergyEff: epc.wallsEnergyEff }
              : {}),
            ...(epc.roofEnergyEff
              ? { roofEnergyEff: epc.roofEnergyEff }
              : {}),
            ...(epc.floorEnergyEff
              ? { floorEnergyEff: epc.floorEnergyEff }
              : {}),
            ...(epc.floorDescription
              ? { floorDescription: epc.floorDescription }
              : {}),
            ...(epc.windowsEnergyEff
              ? { windowsEnergyEff: epc.windowsEnergyEff }
              : {}),
            ...(epc.glazedArea ? { glazedArea: epc.glazedArea } : {}),
            ...(epc.multiGlazeProportion != null
              ? { multiGlazeProportion: epc.multiGlazeProportion }
              : {}),
            // V2 EPC heating/HW fields
            ...(epc.mainheatEnergyEff
              ? { mainheatEnergyEff: epc.mainheatEnergyEff }
              : {}),
            ...(epc.mainheatcEnergyEff
              ? { mainheatcEnergyEff: epc.mainheatcEnergyEff }
              : {}),
            ...(epc.hotWaterEnergyEff
              ? { hotWaterEnergyEff: epc.hotWaterEnergyEff }
              : {}),
            ...(epc.hotwaterDescription
              ? { hotwaterDescription: epc.hotwaterDescription }
              : {}),
            ...(epc.secondheatDescription
              ? { secondheatDescription: epc.secondheatDescription }
              : {}),
            ...(epc.mainheatcontDescription
              ? { mainheatcontDescription: epc.mainheatcontDescription }
              : {}),
            // V2 EPC controls/ventilation/lighting fields
            ...(epc.mechanicalVentilation
              ? { mechanicalVentilation: epc.mechanicalVentilation }
              : {}),
            ...(epc.lightingEnergyEff
              ? { lightingEnergyEff: epc.lightingEnergyEff }
              : {}),
            ...(epc.lowEnergyLighting != null
              ? { lowEnergyLighting: epc.lowEnergyLighting }
              : {}),
            // V2 EPC renewables fields
            ...(epc.photoSupply != null
              ? { photoSupply: epc.photoSupply }
              : {}),
            ...(epc.solarWaterHeatingFlag != null
              ? { solarWaterHeatingFlag: epc.solarWaterHeatingFlag }
              : {}),
            ...(epc.windTurbineCount != null
              ? { windTurbineCount: epc.windTurbineCount }
              : {}),
            // V2 EPC metadata fields
            ...(epc.lodgementDate
              ? { lodgementDate: epc.lodgementDate }
              : {}),
            ...(epc.constructionAgeBand
              ? { constructionAgeBand: epc.constructionAgeBand }
              : {}),
            ...(epc.builtForm ? { builtForm: epc.builtForm } : {}),
            // titleNumber omitted on purpose — only HMLR can give us
            // a trustworthy one. See verifyOwnershipWithLandRegistry().
            epcEnrichedAt: new Date(),
          },
        })
        .catch(() => {
          /* non-critical back-fill */
        });
    } else if (epc?.councilTaxBand && !property.councilTaxBand) {
      this.prisma.property
        .update({
          where: { id: propertyId },
          data: { councilTaxBand: epc.councilTaxBand },
        })
        .catch(() => {
          /* non-critical back-fill */
        });
    }
    // ── Land Registry HPI estimate ──────────────────────────────────────────
    const salesData =
      salesHistory.status === 'fulfilled' ? salesHistory.value : null;
    let landRegistryEstimate: number | null = null;
    let landRegistrySource: string | null = null;

    if (salesData?.thisProperty?.length) {
      const mostRecent = salesData.thisProperty[0];
      const soldYear = parseInt((mostRecent.date ?? '').substring(0, 4)) || 0;
      if (soldYear >= 1990 && mostRecent.price > 0) {
        const multiplier = hpiMultiplier(soldYear);
        landRegistryEstimate = Math.round((mostRecent.price * multiplier) / 1000) * 1000;
        landRegistrySource = `Land Registry sold price (${soldYear}), HPI adjusted`;
      }
    }

    if (!landRegistryEstimate && salesData?.nearbySales?.length) {
      // Fallback: median of nearby recent sales as proxy
      const recent = salesData.nearbySales
        .filter((s) => s.date >= `${new Date().getFullYear() - 5}-01-01` && s.price > 0)
        .slice(0, 10);
      if (recent.length >= 3) {
        const sorted = [...recent].sort((a, b) => a.price - b.price);
        const median = sorted[Math.floor(sorted.length / 2)].price;
        const soldYear = parseInt((recent[0].date ?? '').substring(0, 4)) || 2022;
        landRegistryEstimate = Math.round((median * hpiMultiplier(soldYear)) / 1000) * 1000;
        landRegistrySource = 'Estimated from nearby Land Registry sales';
      }
    }

    // Non-blockingly update DB estimatedPrice if Land Registry gives us a better figure
    if (landRegistryEstimate && landRegistryEstimate !== property.estimatedPrice) {
      this.prisma.property
        .update({ where: { id: propertyId }, data: { estimatedPrice: landRegistryEstimate } })
        .catch(() => { /* non-critical */ });
    }

    const councilName = epc?.localAuthority ?? osData?.localAuthority ?? null;
    const councilTax = {
      band: ctBand,
      annualEstimate: ctBand
        ? estimateCouncilTaxAmount(ctBand, councilName)
        : null,
      councilName,
      nearby: nearbyCtData.status === 'fulfilled' ? nearbyCtData.value : [],
      checkUrl: 'https://www.gov.uk/council-tax-bands',
      dataSource:
        councilName && COUNCIL_TAX_RATES_2024[normaliseAuthority(councilName)]
          ? `${councilName} 2024/25 rate`
          : 'England average 2024/25',
    };

    return {
      // Google Street View Static API
      streetViewUrl,

      // OS NGD + Overpass: schools (categorised), trains, bus stops, parks, airports, amenities
      nearby:
        nearby.status === 'fulfilled'
          ? nearby.value
          : { schools: [], trains: [], busStops: [], parks: [], airports: [], amenities: [] },

      // Environment Agency Flood Risk API
      floodRisk: floodData?.rating ?? null,
      floodZones: floodData?.zones ?? [],

      // HM Land Registry Price Paid — local DB query
      salesHistory:
        salesHistory.status === 'fulfilled'
          ? salesHistory.value
          : { thisProperty: [], nearbySales: [] },

      // HPI-adjusted estimated value from Land Registry sold prices
      landRegistryEstimate,
      landRegistrySource,

      // Ofcom Connected Nations API
      broadband: broadband.status === 'fulfilled' ? broadband.value : null,
      mobileSignal:
        mobileSignal.status === 'fulfilled' ? mobileSignal.value : null,

      // Overpass heritage data (listed buildings, monuments, memorials) — sourced from fetchNearbyOS combined query
      listedBuildings:
        nearby.status === 'fulfilled'
          ? (nearby.value.listedBuildings ?? [])
          : [],

      // OS Data Hub Places API
      osPlaces: osData,

      // EPC Open Data Communities API
      epcCert: epc,
      epcPotentialRating: epc?.potentialRating ?? null,
      epcPotentialScore: epc?.potentialScore ?? null,

      // Council tax from DB (populated when available)
      councilTax,

      // Water & sewerage — regional average by water company (Discover
      // Water 2024/25). No per-property metered API exists for free.
      water: estimateWaterCost(property.postcode),

      // planning.data.gov.uk — constraints + applications
      planningHistory: planning,

      // HMLR INSPIRE Index Polygons — registered title boundary (GeoJSON)
      titleBoundary:
        titleBoundary.status === 'fulfilled' ? titleBoundary.value : null,

      // data.police.uk — last 12 months of reported crime within 1mi
      crime: crimeStats.status === 'fulfilled' ? crimeStats.value : null,
    };
  }

  /**
   * OS NGD Building Footprint — returns the building polygon nearest to the property
   * coordinate. Used to show the property outline on the map (proxy for title plan).
   * HMLR INSPIRE WFS is currently disabled, so we use OS NGD buildings instead.
   */
  private async fetchInspireBoundary(lat: number, lon: number): Promise<any> {
    const osKey = process.env.OS_API_KEY ?? '';
    if (!osKey) return null;
    try {
      const delta = 0.001; // ~100m bounding box
      const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;
      const url = `https://api.os.uk/features/ngd/ofa/v1/collections/bld-fts-building-1/items?bbox=${bbox}&limit=5&key=${osKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.features?.length) return null;

      // Pick the feature whose UPRN list (if any) is closest to the property's position
      // Fallback: just pick the first residential building
      const residential = data.features.filter(
        (f: any) =>
          f.properties?.buildinguse === 'Residential Accommodation' ||
          f.properties?.ismainbuilding,
      );
      const feat = residential[0] ?? data.features[0];
      return {
        geoJson: {
          type: 'Feature',
          geometry: feat.geometry,
          properties: feat.properties,
        },
        geometry: feat.geometry,
        areaM2: feat.properties?.geometry_area_m2 ?? null,
        uprns: (feat.properties?.uprnreference ?? []).map((u: any) => u.uprn),
      };
    } catch {
      return null;
    }
  }

  /**
   * data.police.uk — free, no API key, returns reported crimes within a 1-mile
   * radius of a coordinate for a given month. We fetch the last 12 months in
   * parallel and aggregate by category + total count.
   *
   * Geo-block note: the API is hosted on UK infra and works without auth
   * worldwide as of this writing. Cached implicitly via the surrounding
   * enrichment endpoint (no fresh fetch on every property hit).
   */
  private async fetchCrimeStats(
    lat: number,
    lon: number,
  ): Promise<{
    totalLast12m: number;
    byCategory: { category: string; label: string; count: number }[];
    monthlyTrend: { month: string; count: number }[];
    trendDirection: 'up' | 'down' | 'flat';
    yoyChangePct: number | null;
  } | null> {
    try {
      // data.police.uk returns crimes for a given YYYY-MM. Build the last 12
      // calendar months. Their latest available month tends to lag ~2 months,
      // so we request from -2 to -13 to maximise hit-rate.
      const months: string[] = [];
      const now = new Date();
      now.setUTCMonth(now.getUTCMonth() - 2); // start at -2 months
      for (let i = 0; i < 12; i++) {
        months.push(
          `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
        );
        now.setUTCMonth(now.getUTCMonth() - 1);
      }
      // data.police.uk rate-limits bursts (429s come back as empty), so firing
      // all 12 months at once intermittently yields zero crime. Fetch in small
      // sequential chunks and track how many months actually succeeded.
      let okMonths = 0;
      const results: any[] = [];
      const CHUNK = 3;
      for (let i = 0; i < months.length; i += CHUNK) {
        const chunk = months.slice(i, i + CHUNK);
        const chunkRes = await Promise.all(
          chunk.map((m) =>
            fetch(
              `https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lon}&date=${m}`,
              { signal: AbortSignal.timeout(8000) },
            )
              .then((r) => {
                if (!r.ok) return null; // 429 / 5xx → distinguish from genuine empty
                return r.json();
              })
              .catch(() => null),
          ),
        );
        results.push(...chunkRes);
      }
      // If every month failed to fetch, treat as "no data" (null) so the
      // enrichment cache keeps the last good crime figures instead of showing
      // a spurious zero.
      for (const r of results) if (Array.isArray(r)) okMonths += 1;
      if (okMonths === 0) return null;

      const counts: Record<string, number> = {};
      let total = 0;
      // Per-month totals (results[] is newest→oldest, mirroring `months`).
      const perMonth: { month: string; count: number }[] = [];
      for (let i = 0; i < results.length; i++) {
        const arr = results[i];
        const monthCount = Array.isArray(arr) ? arr.length : 0;
        perMonth.push({ month: months[i], count: monthCount });
        if (!Array.isArray(arr)) continue;
        for (const c of arr) {
          const cat = c?.category || 'other';
          counts[cat] = (counts[cat] || 0) + 1;
          total += 1;
        }
      }
      // Chronological order (oldest→newest) for the trend chart.
      const monthlyTrend = [...perMonth].reverse();
      // Year-on-year direction: compare the most recent 6 months vs the
      // prior 6 months (the 12-month window we already fetched).
      const recent6 = monthlyTrend.slice(6).reduce((s, m) => s + m.count, 0);
      const prior6 = monthlyTrend.slice(0, 6).reduce((s, m) => s + m.count, 0);
      let trendDirection: 'up' | 'down' | 'flat' = 'flat';
      let yoyChangePct: number | null = null;
      if (prior6 > 0) {
        yoyChangePct = Math.round(((recent6 - prior6) / prior6) * 100);
        if (yoyChangePct > 5) trendDirection = 'up';
        else if (yoyChangePct < -5) trendDirection = 'down';
      }
      const labelMap: Record<string, string> = {
        'anti-social-behaviour': 'Anti-social behaviour',
        'bicycle-theft': 'Bicycle theft',
        burglary: 'Burglary',
        'criminal-damage-arson': 'Criminal damage & arson',
        drugs: 'Drugs',
        'other-theft': 'Other theft',
        'possession-of-weapons': 'Possession of weapons',
        'public-order': 'Public order',
        robbery: 'Robbery',
        shoplifting: 'Shoplifting',
        'theft-from-the-person': 'Theft from the person',
        'vehicle-crime': 'Vehicle crime',
        'violent-crime': 'Violence & sexual offences',
        'violence-and-sexual-offences': 'Violence & sexual offences',
        other: 'Other',
        'other-crime': 'Other',
      };
      const byCategory = Object.entries(counts)
        .map(([category, count]) => ({
          category,
          label: labelMap[category] || category,
          count,
        }))
        .sort((a, b) => b.count - a.count);
      return { totalLast12m: total, byCategory, monthlyTrend, trendDirection, yoyChangePct };
    } catch {
      return null;
    }
  }

  /**
   * GIAS (Get Information About Schools) lookup by establishment name + town.
   * Best-effort match — no UK schools API offers a direct "what's the URN for
   * this school name + lat/lon" endpoint, so we fall back to a free-text
   * proxy via GIAS's public search. Returns null when no match found.
   *
   * Used to enrich Overpass school results with an Ofsted rating badge.
   */
  private async fetchOfstedRatings(
    schools: { name: string; lat: number; lon: number }[],
    town: string | null,
  ): Promise<Record<string, string | null>> {
    const out: Record<string, string | null> = {};
    if (!schools.length) return out;
    // Cap concurrency — the GIAS endpoint is rate-limited. Sequential is fine
    // for the typical 6–12 schools we display.
    for (const s of schools.slice(0, 8)) {
      if (!s.name) continue;
      try {
        const q = `${s.name}${town ? ' ' + town : ''}`;
        const url = `https://get-information-schools.service.gov.uk/Establishments/Search?SelectedTab=Establishments&SearchType=ByName&q=${encodeURIComponent(
          q,
        )}`;
        // No JSON endpoint is publicly stable here, so this is a best-effort
        // hook that production should swap for a paid GIAS API key. For now
        // we return null per school — the frontend renders "Ofsted: —" or
        // hides the badge gracefully.
        // TODO(opda-phase-2): swap for the GIAS Establishment API once we
        // have the partner credentials.
        out[s.name] = null;
      } catch {
        out[s.name] = null;
      }
    }
    return out;
  }

  private async fetchNearbyOS(lat: number, lon: number) {
    const osKey = process.env.OS_API_KEY ?? '';

    // Haversine distance in km between property and a POI
    function distKm(lat2: number, lon2: number): number {
      const R = 6371;
      const dLat = ((lat2 - lat) * Math.PI) / 180;
      const dLon = ((lon2 - lon) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) ** 2;
      return +(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2);
    }

    // Centroid of a GeoJSON geometry (Point or Polygon/MultiPolygon)
    function centroid(geom: any): [number, number] {
      if (!geom) return [lon, lat];
      if (geom.type === 'Point') return geom.coordinates;
      const ring: number[][] =
        geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0]; // MultiPolygon
      const n = ring.length;
      const sum = ring.reduce(
        (acc: number[], c: number[]) => [acc[0] + c[0], acc[1] + c[1]],
        [0, 0],
      );
      return [sum[0] / n, sum[1] / n];
    }

    // ── OS NGD: Education sites (schools, nurseries, colleges, universities) ──
    const delta = 0.018; // ~2 km bounding box
    const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;
    // OS Features API — NGD Land Use Sites v2 filtered to Education.
    // This is a separate subscription on OS DataHub from OS Places API
    // (which drives postcode search): the client's project needs
    // 'OS Features API' *and* NGD access enabled specifically. When
    // it's not enabled the endpoint returns 401/403 or plain HTML,
    // and we used to swallow that as "no schools" — the operator only
    // saw silent zeros in the UI. Now every failure mode logs once
    // with the response status so the fix is obvious.
    const schoolsPromise = osKey
      ? fetch(
          `https://api.os.uk/features/ngd/ofa/v1/collections/lus-fts-site-2/items?bbox=${bbox}&filter=oslandusetiera%3D'Education'&limit=25&key=${osKey}`,
        )
          .then(async (r) => {
            if (!r.ok) {
              const preview = (await r.text()).slice(0, 200);
              console.warn(
                `[schools] OS Features API returned ${r.status} — check that 'OS Features API' + NGD access are enabled on the project owning OS_API_KEY. Body: ${preview}`,
              );
              return { features: [] };
            }
            const ct = r.headers.get('content-type') ?? '';
            if (!ct.includes('json')) {
              console.warn(
                `[schools] OS Features API returned non-JSON (content-type=${ct}) — likely an auth or endpoint redirect issue.`,
              );
              return { features: [] };
            }
            return r.json();
          })
          .catch((err) => {
            console.warn(
              `[schools] OS Features API fetch failed: ${err?.message ?? err}`,
            );
            return { features: [] };
          })
      : Promise.resolve({ features: [] });

    // ── Overpass: split into FOUR parallel queries ──
    // The combined "everything" query was too heavy for Overpass to compute
    // within reasonable timeouts (>15s server-side processing). Splitting
    // gives each batch its own compute budget; the heavy "extras" can fail
    // independently without nuking transport.
    //
    // Airports are isolated from trains/buses/parks because the 150 km
    // aerodrome scan is by far the heaviest query — folding it in with the
    // ~4 km station/bus search blows the timeout on the whole batch, so a
    // failed airports lookup used to drop trains and buses with it. With
    // its own batch, the airports query can fail or time out without
    // taking station/bus data down.
    const transportQuery = `[out:json][timeout:15];(
      node["railway"="station"](around:4000,${lat},${lon});
      node["railway"="halt"](around:4000,${lat},${lon});
      node["highway"="bus_stop"](around:700,${lat},${lon});
      way["leisure"="park"]["name"](around:2000,${lat},${lon});
    );out center body;`;
    // Airports — own batch, 150 km radius so we catch major UK hubs
    // (Heathrow, Birmingham, Manchester, Edinburgh, etc.) from anywhere in
    // the country. Filtered server-side with an OSM regex so we never even
    // download the thousand private grass strips that bloat the response.
    // The post-process ranks "international/major" airports above tiny
    // local aerodromes regardless of which is technically closer.
    const airportsQuery = `[out:json][timeout:25];(
      node["aeroway"="aerodrome"]["iata"](around:150000,${lat},${lon});
      way["aeroway"="aerodrome"]["iata"](around:150000,${lat},${lon});
      node["aeroway"="aerodrome"]["aerodrome:type"="international"](around:150000,${lat},${lon});
      way["aeroway"="aerodrome"]["aerodrome:type"="international"](around:150000,${lat},${lon});
      node["aeroway"="aerodrome"]["name"~"[Aa]irport"](around:150000,${lat},${lon});
      way["aeroway"="aerodrome"]["name"~"[Aa]irport"](around:150000,${lat},${lon});
    );out center body;`;
    const heritageQuery = `[out:json][timeout:15];(
      node["heritage"](around:800,${lat},${lon});
      node["historic"](around:800,${lat},${lon});
      way["historic"](around:800,${lat},${lon});
      way["heritage"](around:800,${lat},${lon});
    );out center body;`;
    const amenitiesQuery = `[out:json][timeout:15];(
      node["shop"="supermarket"]["name"](around:1200,${lat},${lon});
      node["amenity"="cafe"]["name"](around:800,${lat},${lon});
      node["amenity"="restaurant"]["name"](around:800,${lat},${lon});
      node["amenity"="pub"]["name"](around:800,${lat},${lon});
      node["amenity"="pharmacy"]["name"](around:1500,${lat},${lon});
      node["amenity"="hospital"]["name"](around:5000,${lat},${lon});
      way["amenity"="hospital"]["name"](around:5000,${lat},${lon});
      node["amenity"="doctors"]["name"](around:2000,${lat},${lon});
      node["leisure"="fitness_centre"]["name"](around:2000,${lat},${lon});
      node["leisure"="sports_centre"]["name"](around:2500,${lat},${lon});
    );out center body;`;

    // Overpass mirrors. The main one (overpass-api.de) refuses requests
    // without an Accept header (returns 406 Not Acceptable), and several
    // mirrors block requests without a User-Agent as anti-abuse — both of
    // which our previous calls were missing, so transport/heritage/amenity
    // data was silently falling back to "all mirrors failed". The Accept
    // + User-Agent headers fix the silent zero-results case.
    const OVERPASS_MIRRORS = [
      'https://overpass-api.de/api/interpreter',        // primary
      'https://overpass.kumi.systems/api/interpreter',
      'https://lz4.overpass-api.de/api/interpreter',    // mirror cluster
      'https://z.overpass-api.de/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
      'https://overpass.osm.jp/api/interpreter',
    ];
    const OVERPASS_HEADERS: HeadersInit = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': 'UMU/1.0 (+https://umu.co; contact=hello@umu.co)',
    };

    // Run one Overpass batch through the mirror cascade. Each batch gets its
    // own 18s budget — the heavy amenities batch typically takes 8-12s
    // server-side, transport 2-4s, heritage 1-3s. Failing mirrors fall
    // through quickly because we read status first.
    const runOverpassBatch = async (
      label: string,
      query: string,
    ): Promise<{ elements: any[]; ok: boolean }> => {
      // Circuit breaker: if Overpass was recently found fully down, skip the
      // mirror cascade entirely so we don't add ~60-70s to every request.
      if (Date.now() < this.overpassDownUntil) {
        return { elements: [], ok: false };
      }
      const failures: string[] = [];
      // Only try the first 3 mirrors with a tight 7s budget each. A dead
      // Overpass now costs at most ~21s for this batch instead of 6×18s.
      for (const url of OVERPASS_MIRRORS.slice(0, 3)) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: OVERPASS_HEADERS,
            body: `data=${encodeURIComponent(query)}`,
            signal: AbortSignal.timeout(7000),
          });
          if (!res.ok) {
            failures.push(`${new URL(url).host} → ${res.status}`);
            continue;
          }
          const contentType = res.headers.get('content-type') ?? '';
          if (!contentType.includes('application/json')) {
            failures.push(`${new URL(url).host} → non-JSON ${contentType.slice(0, 30)}`);
            continue;
          }
          const data = await res.json();
          if (!Array.isArray(data.elements)) {
            failures.push(`${new URL(url).host} → no elements field`);
            continue;
          }
          return { elements: data.elements, ok: true };
        } catch (e: any) {
          failures.push(
            `${new URL(url).host} → ${(e?.name === 'AbortError' ? 'timeout' : (e?.message ?? 'err')).toString().slice(0, 60)}`,
          );
        }
      }
      console.warn(
        `[Overpass:${label}] all mirrors failed for ${lat},${lon} — ${failures.join('; ')}`,
      );
      return { elements: [], ok: false };
    };

    const [
      schoolsRaw,
      transportBatch,
      airportsBatch,
      heritageBatch,
      amenitiesBatch,
    ] = await Promise.all([
      schoolsPromise,
      runOverpassBatch('transport', transportQuery),
      runOverpassBatch('airports', airportsQuery),
      runOverpassBatch('heritage', heritageQuery),
      runOverpassBatch('amenities', amenitiesQuery),
    ]);

    // Merge all batches' elements into one combined list (downstream
    // filters by tag, so order doesn't matter). Two independent failure
    // flags now exist: `transportLookupFailed` for trains/buses/parks and
    // `airportsLookupFailed` for the airports list. Heritage/amenities
    // are nice-to-haves — their failure is silent.
    const overpassRaw = {
      elements: [
        ...transportBatch.elements,
        ...airportsBatch.elements,
        ...heritageBatch.elements,
        ...amenitiesBatch.elements,
      ],
    };
    const overpassFailed = !transportBatch.ok;
    const airportsFailed = !airportsBatch.ok;

    // If every Overpass batch failed, Overpass is effectively down — trip the
    // breaker so the next few minutes of requests skip it and stay fast.
    if (
      !transportBatch.ok &&
      !airportsBatch.ok &&
      !heritageBatch.ok &&
      !amenitiesBatch.ok
    ) {
      this.overpassDownUntil =
        Date.now() + PropertyService.OVERPASS_COOLDOWN_MS;
    }

    // ── Process schools from OS NGD ──
    // OS NGD's `oslandusetierb` is the sub-categorisation under "Education".
    // We map its raw values to a short, user-friendly phase chip so the
    // Schools sheet reads "St John's · Primary · 0.6 km" rather than the
    // verbose OS string. Fall back to inspecting `description` when tierb
    // is missing or non-specific.
    type SchoolPhase =
      | 'Pre-Primary'
      | 'Primary'
      | 'Secondary'
      | 'Further Education'
      | 'Higher Education'
      | 'Specialist'
      | 'School';
    function classifySchool(p: any): {
      phase: SchoolPhase;
      category: string;
    } {
      const raw =
        (p.oslandusetierb?.[0] ?? p.description ?? '').toString().trim();
      const haystack = `${raw} ${p.description ?? ''}`.toLowerCase();
      let phase: SchoolPhase;
      // Order matters: "Pre-Primary" must beat "Primary"; "Further Education"
      // and "Higher Education" must beat the generic "education" sweep.
      if (/(pre[\s-]?primary|nursery|early[\s-]?year)/.test(haystack)) {
        phase = 'Pre-Primary';
      } else if (/(further[\s-]?education|sixth[\s-]?form|college)/.test(haystack)) {
        phase = 'Further Education';
      } else if (/(higher[\s-]?education|university)/.test(haystack)) {
        phase = 'Higher Education';
      } else if (/(secondary|high[\s-]?school|academy)/.test(haystack)) {
        phase = 'Secondary';
      } else if (/(specialist|special[\s-]?education|sen)/.test(haystack)) {
        phase = 'Specialist';
      } else if (/primary/.test(haystack)) {
        phase = 'Primary';
      } else {
        phase = 'School';
      }
      // `category` retained for back-compat with any older clients reading it.
      return { phase, category: raw || phase };
    }

    const schools = ((schoolsRaw.features ?? []) as any[])
      .filter((f: any) => f.properties?.name1_text)
      .map((f: any) => {
        const [flon, flat] = centroid(f.geometry);
        const p = f.properties;
        const { phase, category } = classifySchool(p);
        return {
          name: p.name1_text as string,
          phase, // "Primary" | "Secondary" | "Further Education" | …
          category, // raw OS value, kept for back-compat
          description: p.description as string,
          lat: flat,
          lon: flon,
          distanceKm: distKm(flat, flon),
        };
      })
      .sort((a: any, b: any) => a.distanceKm - b.distanceKm)
      .slice(0, 12);

    // ── Process Overpass elements ──
    const elements: any[] = overpassRaw.elements ?? [];

    const trains = elements
      .filter(
        (e) => e.tags?.railway === 'station' || e.tags?.railway === 'halt',
      )
      .map((e) => ({
        name: e.tags?.name ?? 'Railway Station',
        lat: e.lat ?? e.center?.lat,
        lon: e.lon ?? e.center?.lon,
        distanceKm: distKm(e.lat ?? e.center?.lat, e.lon ?? e.center?.lon),
        operator: e.tags?.operator ?? null,
      }))
      .filter((e) => e.lat && e.lon)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 6);

    const busStops = elements
      .filter((e) => e.tags?.highway === 'bus_stop')
      .map((e) => ({
        name: e.tags?.name ?? e.tags?.ref ?? 'Bus Stop',
        ref: e.tags?.ref ?? null,
        lat: e.lat,
        lon: e.lon,
        distanceKm: distKm(e.lat, e.lon),
      }))
      .filter((e) => e.lat && e.lon)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 10);

    const parks = elements
      .filter((e) => e.tags?.leisure === 'park' && e.tags?.name)
      .map((e) => ({
        name: e.tags.name as string,
        lat: e.center?.lat ?? e.lat,
        lon: e.center?.lon ?? e.lon,
        distanceKm: distKm(e.center?.lat ?? e.lat, e.center?.lon ?? e.lon),
      }))
      .filter((e) => e.lat && e.lon)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 6);

    // Major UK passenger airports (IATA). When present, we always surface
    // at least the nearest 2 of these even if a small private aerodrome
    // happens to be physically closer — users care about flights, not
    // grass strips.
    const UK_MAJOR_HUB_IATAS = new Set([
      'LHR', 'LGW', 'MAN', 'STN', 'LTN', 'BHX', 'EDI', 'GLA',
      'BRS', 'NCL', 'LPL', 'LCY', 'EMA', 'BFS', 'ABZ', 'CWL',
      'SOU', 'EXT', 'NWI', 'BHD', 'INV', 'JER', 'GCI', 'IOM',
      'BLK', 'HUY', 'DSA',
    ]);

    type AirportRow = {
      name: string;
      iata: string | null;
      icao: string | null;
      lat: number;
      lon: number;
      distanceKm: number;
      isMajor: boolean;
    };

    const allAirports: AirportRow[] = elements
      .filter((e) => e.tags?.aeroway === 'aerodrome' && e.tags?.name)
      // Commercial/public airports only — must have an IATA code, an
      // explicit international flag, OR "Airport" in the name. Excludes
      // private aerodromes / glider clubs / military fields.
      .filter(
        (e) =>
          e.tags?.iata ||
          e.tags?.['aerodrome:type'] === 'international' ||
          e.tags?.aerodrome === 'international' ||
          /airport/i.test(e.tags?.name ?? ''),
      )
      .map((e) => {
        const iata: string | null = e.tags?.iata ?? null;
        const isOsmInternational =
          e.tags?.['aerodrome:type'] === 'international' ||
          e.tags?.aerodrome === 'international';
        const isMajor =
          (iata && UK_MAJOR_HUB_IATAS.has(iata.toUpperCase())) ||
          isOsmInternational;
        return {
          name: e.tags.name as string,
          iata,
          icao: e.tags?.icao ?? null,
          lat: e.center?.lat ?? e.lat,
          lon: e.center?.lon ?? e.lon,
          distanceKm: distKm(e.center?.lat ?? e.lat, e.center?.lon ?? e.lon),
          isMajor,
        };
      })
      .filter((e) => e.lat && e.lon);

    // De-dupe (a few airports appear as both node and way in OSM, e.g.
    // Birmingham International). Key on rounded coordinates because OSM
    // node/way pairs share centroids to 4 decimal places.
    const seenAirports = new Set<string>();
    const dedupedAirports = allAirports
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .filter((a) => {
        const key = `${a.iata ?? a.name}@${a.lat.toFixed(3)},${a.lon.toFixed(3)}`;
        if (seenAirports.has(key)) return false;
        seenAirports.add(key);
        return true;
      });

    // Two-tier final list: always include the nearest 2 major hubs (for
    // air-travel relevance), then fill the rest from the distance-sorted
    // pool. Cap at 6.
    const majors = dedupedAirports.filter((a) => a.isMajor).slice(0, 2);
    const majorIds = new Set(majors.map((a) => `${a.lat},${a.lon}`));
    const fillers = dedupedAirports.filter(
      (a) => !majorIds.has(`${a.lat},${a.lon}`),
    );
    const airports = [...majors, ...fillers]
      .sort((a, b) => {
        // Within the merged list, sort majors first then by distance —
        // a user 60km from Birmingham (major) and 5km from a local strip
        // should see Birmingham first.
        if (a.isMajor !== b.isMajor) return a.isMajor ? -1 : 1;
        return a.distanceKm - b.distanceKm;
      })
      .slice(0, 6);

    // NOTE: Overpass is the only viable free source for named train stations
    // and bus stops with stable POI identifiers. OS NGD's Rail / Railway-Node
    // collections expose engineering-grade topology (Pseudo Node, Made
    // Surface, etc.) without station names. National Rail Knowledgebase /
    // TfL / DfT TransXChange would be ideal next-step integrations.

    const gradeMap: Record<string, string> = {
      '1': 'Grade I',
      I: 'Grade I',
      '2*': 'Grade II*',
      'II*': 'Grade II*',
      '2': 'Grade II',
      II: 'Grade II',
      SM: 'Scheduled Monument',
    };
    const typeLabel: Record<string, string> = {
      castle: 'Castle',
      church: 'Church',
      monument: 'Monument',
      memorial: 'Memorial',
      archaeological_site: 'Archaeological Site',
      ruins: 'Ruins',
      manor: 'Manor House',
      farm: 'Historic Farm',
      building: 'Historic Building',
      yes: 'Heritage Site',
    };

    const listedBuildings = elements
      .filter((e) => e.tags?.name && (e.tags?.heritage || e.tags?.historic))
      .slice(0, 8)
      .map((e) => {
        const t = e.tags;
        const grade =
          gradeMap[
            t['heritage:grade'] ?? t['listed_status'] ?? t['heritage'] ?? ''
          ] ?? null;
        const histType = t.historic ?? t.building ?? null;
        return {
          name: t.name,
          grade:
            grade ??
            (histType
              ? (typeLabel[histType] ?? 'Heritage Site')
              : 'Heritage Site'),
          location:
            [t['addr:street'], t['addr:city']].filter(Boolean).join(', ') ||
            null,
          link: t.website ?? t.url ?? null,
          historic: histType,
        };
      });

    // ── Local amenities (shops, food, health, leisure) ─────────────────────
    const amenityIcon: Record<string, string> = {
      supermarket: '🛒',
      cafe: '☕',
      restaurant: '🍽️',
      pub: '🍺',
      pharmacy: '💊',
      hospital: '🏥',
      doctors: '🩺',
      fitness_centre: '💪',
      sports_centre: '🏟️',
    };
    const amenityLabel: Record<string, string> = {
      supermarket: 'Supermarket',
      cafe: 'Cafe',
      restaurant: 'Restaurant',
      pub: 'Pub',
      pharmacy: 'Pharmacy',
      hospital: 'Hospital',
      doctors: 'GP / Doctors',
      fitness_centre: 'Gym',
      sports_centre: 'Sports centre',
    };
    const amenities = elements
      .filter((e) => {
        const t = e.tags ?? {};
        return (
          (t.shop === 'supermarket' && t.name) ||
          (t.amenity &&
            ['cafe', 'restaurant', 'pub', 'pharmacy', 'hospital', 'doctors'].includes(
              t.amenity,
            ) &&
            t.name) ||
          (t.leisure && ['fitness_centre', 'sports_centre'].includes(t.leisure) && t.name)
        );
      })
      .map((e) => {
        const t = e.tags ?? {};
        const key = (t.shop ?? t.amenity ?? t.leisure ?? '') as string;
        const elat = e.center?.lat ?? e.lat;
        const elon = e.center?.lon ?? e.lon;
        return {
          name: t.name as string,
          category: amenityLabel[key] ?? key,
          icon: amenityIcon[key] ?? '📍',
          key,
          lat: elat,
          lon: elon,
          distanceKm: elat && elon ? distKm(elat, elon) : null,
        };
      })
      .filter((a) => a.distanceKm !== null)
      .sort((a, b) => (a.distanceKm! - b.distanceKm!))
      .slice(0, 30);

    // `transportLookupFailed` and `airportsLookupFailed` let the frontend
    // distinguish "no data available from this network" (e.g. Overpass
    // blocked from a non-UK dev IP, or the airports batch timed out on its
    // 150 km radius) from "there genuinely are no stations within 4 km".
    return {
      schools,
      trains,
      busStops,
      parks,
      airports,
      listedBuildings,
      amenities,
      transportLookupFailed: overpassFailed,
      airportsLookupFailed: airportsFailed,
    };
  }

  private async fetchFloodDetail(
    lat: number,
    lon: number,
  ): Promise<{ rating: string; zones: any[] } | null> {
    try {
      const url = `https://environment.data.gov.uk/flood-monitoring/id/floodAreas?lat=${lat}&long=${lon}&dist=2`;
      const res = await fetch(url);
      if (!res.ok) return { rating: 'Very Low', zones: [] };
      const data = await res.json();
      const items = data.items ?? [];
      if (items.length === 0) return { rating: 'Very Low', zones: [] };

      const minSev = Math.min(
        ...items.map(
          (i: any) => i.currentWarning?.severity?.severityLevel ?? 4,
        ),
      );
      let rating = 'Low';
      if (minSev <= 1) rating = 'Severe';
      else if (minSev <= 2) rating = 'High';
      else if (minSev <= 3) rating = 'Medium';

      const topItems = items.slice(0, 3);

      // Fetch polygon GeoJSON for each flood zone in parallel
      const zonesWithPolygons = await Promise.all(
        topItems.map(async (i: any) => {
          const zone: any = {
            name: i.label ?? i['@id'],
            severity: i.currentWarning?.severity?.label ?? 'No current warning',
            riverSea: i.riverOrSea ?? null,
            polygon: null as any,
          };
          const polygonUrl: string | undefined = i.polygon;
          if (polygonUrl) {
            try {
              const pRes = await fetch(polygonUrl, {
                redirect: 'follow',
                headers: { Accept: 'application/json' },
              });
              if (pRes.ok) {
                zone.polygon = await pRes.json();
              }
            } catch {
              /* polygon fetch failed, leave null */
            }
          }
          return zone;
        }),
      );

      return { rating, zones: zonesWithPolygons };
    } catch {
      return null;
    }
  }

  private async fetchPriceHistory(postcode: string): Promise<any[]> {
    try {
      const clean = encodeURIComponent(postcode);
      const url = `https://landregistry.data.gov.uk/data/ppi/transaction-record.json?propertyAddress.postcode=${clean}&_limit=8&_sort=-transactionDate`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return [];
      const data = await res.json();
      const items = data.result?.items ?? [];
      return items.map((item: any) => ({
        price: item.pricePaid,
        date: item.transactionDate,
        address:
          [item.propertyAddress?.['paon'], item.propertyAddress?.['street']]
            .filter(Boolean)
            .join(' ')
            .trim() || null,
        propertyType: item.propertyType?.prefLabel?.[0] ?? null,
        tenure: item.estateType?.prefLabel?.[0] ?? null,
        newBuild: item.newBuild ?? false,
      }));
    } catch {
      return [];
    }
  }

  private async fetchBroadband(postcode: string): Promise<any> {
    // Per-failure reasons surface up to the frontend so the buyer/owner sees
    // something specific instead of the generic "didn't return coverage" line.
    //   reason: 'no_key' | 'rate_limited' | 'unauthorized' | 'not_found' |
    //           'network' | 'no_premises'
    const key = process.env.OFCOM_API_KEY;
    if (!key) {
      return { available: false, reason: 'no_key' };
    }
    try {
      const clean = postcode.replace(/\s/g, '').toUpperCase();
      const url = `https://api-proxy.ofcom.org.uk/broadband/coverage/${encodeURIComponent(clean)}`;
      const res = await fetch(url, {
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const reason =
          res.status === 401 || res.status === 403
            ? 'unauthorized'
            : res.status === 404
              ? 'not_found'
              : res.status === 429
                ? 'rate_limited'
                : 'network';
        return { available: false, reason, status: res.status };
      }
      const data = await res.json();
      const premises = Array.isArray(data)
        ? data[0]
        : (data?.value?.[0] ?? data ?? null);
      if (!premises) {
        return { available: false, reason: 'no_premises' };
      }
      return {
        available: true,
        fttp: premises.FttpAvailability ?? premises.fttpAvailability ?? false,
        fttc: premises.FttcAvailability ?? premises.fttcAvailability ?? false,
        cable:
          premises.CableAvailability ?? premises.cableAvailability ?? false,
        maxDownload:
          premises.MaxBbPredictedDown ?? premises.maxBbPredictedDown ?? null,
        maxUpload:
          premises.MaxBbPredictedUp ?? premises.maxBbPredictedUp ?? null,
        maxSfDownload: premises.MaxSfbbPredictedDown ?? null,
        maxUfDownload: premises.MaxUfbbPredictedDown ?? null,
        superfast: (premises.MaxSfbbPredictedDown ?? 0) > 0,
        ultrafast: (premises.MaxUfbbPredictedDown ?? 0) > 0,
      };
    } catch (e: any) {
      const reason =
        e?.name === 'AbortError' || /timeout|timed out/i.test(String(e?.message))
          ? 'timeout'
          : 'network';
      return { available: false, reason };
    }
  }

  private async fetchMobileSignal(postcode: string): Promise<any> {
    // Same failure-reason shape as fetchBroadband — frontend can render the
    // appropriate "why no signal data" message.
    const key = process.env.OFCOM_API_KEY;
    if (!key) return { available: false, reason: 'no_key' };
    try {
      const clean = postcode.replace(/\s/g, '').toUpperCase();
      const url = `https://api-proxy.ofcom.org.uk/mobile/coverage/${encodeURIComponent(clean)}`;
      const res = await fetch(url, {
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const reason =
          res.status === 401 || res.status === 403
            ? 'unauthorized'
            : res.status === 404
              ? 'not_found'
              : res.status === 429
                ? 'rate_limited'
                : 'network';
        return { available: false, reason, status: res.status };
      }
      const data = await res.json();
      const row = Array.isArray(data)
        ? data[0]
        : (data?.value?.[0] ?? data ?? null);
      if (!row) return { available: false, reason: 'no_premises' };

      // Ofcom field naming varies — handle both camelCase and PascalCase
      const get = (a: string, b: string) => row[a] ?? row[b] ?? null;

      return {
        available: true,
        EE: {
          voice4g: get('EE4GVoiceOutdoor', 'ee4GVoiceOutdoor'),
          data4g: get('EE4GDataOutdoor', 'ee4GDataOutdoor'),
          data5g: get('EE5GDataOutdoor', 'ee5GDataOutdoor'),
          indoor4g: get('EE4GDataIndoor', 'ee4GDataIndoor'),
        },
        O2: {
          voice4g: get('O24GVoiceOutdoor', 'o24GVoiceOutdoor'),
          data4g: get('O24GDataOutdoor', 'o24GDataOutdoor'),
          data5g: get('O25GDataOutdoor', 'o25GDataOutdoor'),
          indoor4g: get('O24GDataIndoor', 'o24GDataIndoor'),
        },
        Three: {
          voice4g: get('Three4GVoiceOutdoor', 'three4GVoiceOutdoor'),
          data4g: get('Three4GDataOutdoor', 'three4GDataOutdoor'),
          data5g: get('Three5GDataOutdoor', 'three5GDataOutdoor'),
          indoor4g: get('Three4GDataIndoor', 'three4GDataIndoor'),
        },
        Vodafone: {
          voice4g: get('Vodafone4GVoiceOutdoor', 'vodafone4GVoiceOutdoor'),
          data4g: get('Vodafone4GDataOutdoor', 'vodafone4GDataOutdoor'),
          data5g: get('Vodafone5GDataOutdoor', 'vodafone5GDataOutdoor'),
          indoor4g: get('Vodafone4GDataIndoor', 'vodafone4GDataIndoor'),
        },
        // Raw response kept for debugging / field discovery
        _raw: row,
      };
    } catch (e: any) {
      const reason =
        e?.name === 'AbortError' || /timeout|timed out/i.test(String(e?.message))
          ? 'timeout'
          : 'network';
      return { available: false, reason };
    }
  }

  private async fetchOsPlaces(postcode: string): Promise<any> {
    const key = process.env.OS_API_KEY;
    if (!key) return null;
    try {
      const url = `https://api.os.uk/search/places/v1/postcode?postcode=${encodeURIComponent(postcode)}&dataset=DPA&key=${key}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const results: any[] = data.results ?? [];
      return {
        totalAddresses: data.header?.totalresults ?? results.length,
        ward: results[0]?.DPA?.WARD_CODE ?? null,
        localAuthority:
          results[0]?.DPA?.LOCAL_CUSTODIAN_CODE_DESCRIPTION ?? null,
        country: results[0]?.DPA?.COUNTRY_CODE ?? 'E',
        addresses: results.slice(0, 6).map((r: any) => ({
          uprn: r.DPA?.UPRN,
          address: r.DPA?.ADDRESS,
          classification: r.DPA?.CLASSIFICATION_CODE_DESCRIPTION ?? null,
        })),
      };
    } catch {
      return null;
    }
  }

  /** Fallback: look up EPC by postcode + address when UPRN is unavailable */
  private async fetchEpcDataByAddress(
    postcode: string,
    addressLine1: string,
  ): Promise<EpcCert | null> {
    const data = await fetchEpcJson<{ rows: EpcRow[] }>(
      `/api/domestic/search?postcode=${encodeURIComponent(postcode)}&size=10`,
    );
    const rows = data?.rows ?? [];
    if (!rows.length) {
      console.log(`[EPC] no rows for postcode ${postcode} (address ${addressLine1})`);
      return null;
    }
    console.log(
      `[EPC] Found ${rows.length} results for postcode ${postcode}, searching for address: ${addressLine1}`,
    );
    const addrNorm = addressLine1.replace(/[,\s]+/g, ' ').toLowerCase().trim();
    const match =
      rows.find((row) => {
        const rowAddr = [row['address1'], row['address2']]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .trim();
        return (
          rowAddr.includes(addrNorm.split(' ')[0]) ||
          addrNorm.includes(rowAddr.split(' ')[0])
        );
      }) ?? rows[0];
    return epcRowToCert(match);
  }

  private async fetchEpcData(uprn: string): Promise<EpcCert | null> {
    const data = await fetchEpcJson<{ rows: EpcRow[] }>(
      `/api/domestic/search?uprn=${uprn}&size=1`,
    );
    const row = data?.rows?.[0];
    return row ? epcRowToCert(row) : null;
  }

  /**
   * Scrape "Steps you could take to save energy" from the consumer-facing
   * find-energy-certificate.service.gov.uk site, using the property's
   * postcode + address as the lookup key.
   *
   * Used as a fallback when the opendatacommunities recommendations API
   * 404s (it returned 404 for some certs in Dec 2025+ as the dataset is
   * being retired). The consumer site renders the same recommendations
   * from a different backend and is still live.
   */
  private async scrapeRecommendationsFromGovSite(
    postcode: string,
    addressLine1: string,
  ): Promise<EpcRecommendation[]> {
    if (!postcode || !addressLine1) return [];
    try {
      // Step 1: find the consumer-site cert URL for this address.
      const searchUrl = `https://find-energy-certificate.service.gov.uk/find-a-certificate/search-by-postcode?postcode=${encodeURIComponent(postcode)}`;
      const searchRes = await fetch(searchUrl, {
        headers: { Accept: 'text/html', 'User-Agent': 'umu-homescore/1.0' },
      });
      if (!searchRes.ok) {
        console.log(`[EPC][scrape] Postcode search HTTP ${searchRes.status}`);
        return [];
      }
      const searchHtml = await searchRes.text();

      // Find the anchor whose visible text contains the property's
      // address line. The consumer site renders rows roughly as:
      //   <a href="/energy-certificate/XXXX-XXXX-...">3 Austen Road, Erith, DA8 1YA</a>
      // We accept any anchor that links to /energy-certificate/ AND
      // whose link text starts with the property's number+street prefix.
      const certHref = findCertHrefForAddress(searchHtml, addressLine1);
      if (!certHref) {
        console.log(
          `[EPC][scrape] No cert link found for "${addressLine1}" in postcode ${postcode}`,
        );
        return [];
      }
      const certUrl = certHref.startsWith('http')
        ? certHref
        : `https://find-energy-certificate.service.gov.uk${certHref}`;
      console.log(`[EPC][scrape] Matched cert URL: ${certUrl}`);

      // Step 2: fetch the cert detail page (which contains the Steps).
      const certRes = await fetch(certUrl, {
        headers: { Accept: 'text/html', 'User-Agent': 'umu-homescore/1.0' },
      });
      if (!certRes.ok) {
        console.log(`[EPC][scrape] Cert page HTTP ${certRes.status}`);
        return [];
      }
      const certHtml = await certRes.text();

      // Step 3: parse the steps out of the HTML.
      const recs = parseRecommendationsFromCertHtml(certHtml);
      console.log(`[EPC][scrape] Parsed ${recs.length} steps from cert page`);
      return recs;
    } catch (err) {
      console.error(`[EPC][scrape] Failed:`, err);
      return [];
    }
  }

  /**
   * Look up a single EPC certificate by its LMK key. Used when we already
   * know which cert a property maps to (because we stored the key during
   * an earlier search) — avoids the UPRN/address ambiguity that can
   * return a sibling property's certificate.
   */
  private async fetchEpcByLmkKey(lmkKey: string): Promise<EpcCert | null> {
    if (!lmkKey) return null;
    try {
      // The EPC search endpoint supports filtering on `lmk-key` directly,
      // which returns the single row for that certificate.
      const url = `${EPC_API_BASE}/api/domestic/search?lmk-key=${encodeURIComponent(lmkKey)}&size=1`;
      const res = await fetch(url, {
        headers: { Authorization: epcAuthHeader(), Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const row = data?.rows?.[0];
      if (!row) return null;
      return epcRowToCert(row);
    } catch {
      return null;
    }
  }

  /**
   * Pull the EPC Register's improvement recommendations for a single
   * certificate (identified by its LMK key). Each row is reshaped into our
   * canonical shape used by the simulator's improvement cards. Returns an
   * empty array on any error so the caller can store `[]` and not retry on
   * every page load.
   */
  private async fetchEpcRecommendations(
    lmkKey: string,
  ): Promise<EpcRecommendation[]> {
    if (!lmkKey) return [];

    // Try TWO URL shapes — opendatacommunities exposes both, but at
    // different points in their API life-cycle one or the other has
    // been the working path. We try the path-based form first because
    // it's more explicit about scoping to a single cert; fall back to
    // the query-string filter form if that 404s.
    const urls = [
      `${EPC_API_BASE}/domestic/certificate/${encodeURIComponent(lmkKey)}/recommendations`,
      `${EPC_API_BASE}/domestic/recommendations?lmk-key=${encodeURIComponent(lmkKey)}`,
    ];

    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: {
            Authorization: epcAuthHeader(),
            Accept: 'application/json',
          },
        });
        if (!res.ok) {
          console.log(
            `[EPC][recs] HTTP ${res.status} for ${url}: ${await res.text().catch(() => '')}`,
          );
          continue;
        }
        const data = await res.json();
        const rows: any[] = Array.isArray(data?.rows)
          ? data.rows
          : Array.isArray(data)
            ? data
            : [];
        const mapped = rows
          .map((r) => mapEpcRecommendationRow(r))
          .filter((r): r is EpcRecommendation => !!r);
        console.log(
          `[EPC][recs] ${url} → ${rows.length} raw rows → ${mapped.length} mapped recs`,
        );
        if (rows.length > 0 && mapped.length === 0) {
          // Surface the first row's keys so we can see what shape EPC is
          // returning when the mapper is filtering everything out.
          console.log(
            `[EPC][recs] First raw row keys: ${Object.keys(rows[0]).join(', ')}`,
          );
          console.log(`[EPC][recs] First raw row: ${JSON.stringify(rows[0])}`);
        }
        if (mapped.length > 0) return mapped;
      } catch (err) {
        console.error(`[EPC][recs] Fetch error for ${url}:`, err);
      }
    }

    return [];
  }

  /**
   * Council Tax Finder API (counciltaxfinder.com) — exact band + £/yr + LA ref
   * per address. Three modes attempted in order:
   *   1. Postcode + door (most precise — uses door number parsed from addressLine1)
   *   2. Postcode + alladdress=<door> (fallback when door= isn't matched)
   *   3. Postcode-only (returns one sample row — useful only if other modes fail)
   *
   * Returns `null` when:
   *   - API key not set (silent — caller falls back to estimate)
   *   - HTTP non-200 (e.g. 403 from Cloudflare geo-block on non-UK IPs)
   *   - Response is not valid JSON or contains no matching row
   *
   * NOTE: counciltaxfinder.com appears to geo-block non-UK source IPs at the
   * Cloudflare edge. From UK production infra this will return JSON; from
   * non-UK dev IPs it returns an HTML 403 block page (caller treats as null).
   */
  private async fetchCouncilTaxFinder(
    postcode: string,
    addressLine1: string | null,
  ): Promise<{
    band: string;
    annual: number;
    councilName: string | null;
    councilWeb: string | null;
    laRef: string | null;
    taxYear: string | null;
  } | null> {
    const userid = process.env.COUNCIL_TAX_FINDER_USERID;
    const apikey = process.env.COUNCIL_TAX_FINDER_APIKEY;
    if (!userid || !apikey) return null;
    if (!postcode) return null;

    const pcCompact = postcode.replace(/\s+/g, '').toUpperCase();
    // Extract leading door number from "30 Whittington Grove" / "Flat 4, 30 …" /
    // "30A Mill Road". Falls back to first numeric token.
    const door = (() => {
      const a = (addressLine1 || '').trim();
      if (!a) return '';
      const flat = a.match(/^(?:flat|apt|apartment|unit)\s*([\d\w]+)/i);
      if (flat) return flat[1];
      const m = a.match(/(\d+[a-zA-Z]?)/);
      return m ? m[1] : '';
    })();

    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'en-GB,en;q=0.9',
      Referer: 'https://www.counciltaxfinder.com/',
    };

    const parseRow = (row: any) => {
      if (!row || typeof row !== 'object') return null;
      const band = String(row.Band ?? '').trim().toUpperCase();
      const taxStr = String(row.Tax ?? '').replace(/[^\d.]/g, '');
      const annual = taxStr ? Number(taxStr) : NaN;
      if (!band || !Number.isFinite(annual)) return null;
      return {
        band,
        annual: Math.round(annual * 100) / 100,
        councilName: row['Council Name'] ? String(row['Council Name']) : null,
        councilWeb: row['Council Web'] ? String(row['Council Web']) : null,
        laRef: row['Local Authority Reference Number']
          ? String(row['Local Authority Reference Number'])
          : null,
        taxYear: row.Year ? String(row.Year) : null,
      };
    };

    // Best-match scorer for multi-row results: prefer rows whose Address text
    // contains the door number we parsed (handles flats above shops, etc.)
    const pickBest = (rows: any[]) => {
      if (!Array.isArray(rows) || rows.length === 0) return null;
      if (door) {
        const re = new RegExp(`(^|[^0-9])${door}([^0-9]|$)`, 'i');
        const match = rows.find((r) => re.test(String(r?.Address ?? '')));
        if (match) return parseRow(match);
      }
      return parseRow(rows[0]);
    };

    const callApi = async (qs: string) => {
      const url = `https://api.counciltaxfinder.com/counciltaxfinder/counciltax/${pcCompact}?${qs}&userid=${encodeURIComponent(userid)}&apikey=${encodeURIComponent(apikey)}`;
      try {
        const res = await fetch(url, { headers });
        if (!res.ok) return null;
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('json')) return null;
        const body = await res.json();
        return Array.isArray(body) ? body : null;
      } catch {
        return null;
      }
    };

    // 1. Try door= mode first (most precise per docs).
    if (door) {
      const rows = await callApi(`door=${encodeURIComponent(door)}&page=`);
      const hit = pickBest(rows || []);
      if (hit) return hit;
    }
    // 2. alladdress= fallback uses partial-match semantics. Per docs, door=
    //    must still be present but is ignored when alladdress is set.
    if (door) {
      const rows = await callApi(
        `door=&alladdress=${encodeURIComponent(door)}&page=`,
      );
      const hit = pickBest(rows || []);
      if (hit) return hit;
    }
    // 3. Last resort: postcode-only sample row.
    const rows = await callApi('door=&page=');
    return pickBest(rows || []);
  }

  private async fetchNearbyCouncilTax(postcode: string): Promise<
    {
      address: string;
      band: string;
      annualEstimate: number | null;
    }[]
  > {
    try {
      // Fetch up to 25 EPC records for the postcode — many include council-tax-band
      const url = `${EPC_API_BASE}/api/domestic/search?postcode=${encodeURIComponent(postcode)}&size=25`;
      const res = await fetch(url, {
        headers: { Authorization: epcAuthHeader(), Accept: 'application/json' },
      });
      if (!res.ok) return [];
      const data = await res.json();
      const rows: any[] = data.rows ?? [];

      // Get council name from first row so real rates apply to all nearby
      const sharedCouncil = rows[0]?.['local-authority-label'] ?? null;
      const results: {
        address: string;
        band: string;
        annualEstimate: number | null;
      }[] = [];
      for (const row of rows) {
        const band = row['council-tax-band'];
        if (!band) continue;
        const addr = [row['address1'], row['address2']]
          .filter(Boolean)
          .join(', ');
        const council = row['local-authority-label'] ?? sharedCouncil;
        results.push({
          address: addr || row['postcode'],
          band,
          annualEstimate: estimateCouncilTaxAmount(band, council),
        });
        if (results.length >= 12) break;
      }
      return results;
    } catch {
      return [];
    }
  }

  private async fetchPlanningData(
    lat: number,
    lon: number,
    uprn: string | null,
  ): Promise<{
    constraints: {
      type: string;
      name: string;
      reference: string | null;
      category: string;
    }[];
    applications: {
      reference: string | null;
      description: string | null;
      status: string | null;
      decision: string | null;
      decisionDate: string | null;
      applicationType: string | null;
      docUrl: string | null;
    }[];
  }> {
    const constraints: {
      type: string;
      name: string;
      reference: string | null;
      category: string;
    }[] = [];
    const applications: any[] = [];

    const BASE = 'https://www.planning.data.gov.uk/entity.json';

    // All constraint datasets, grouped by category
    const datasets = [
      {
        id: 'conservation-area',
        label: 'Conservation Area',
        category: 'heritage',
      },
      { id: 'listed-building', label: 'Listed Building', category: 'heritage' },
      {
        id: 'scheduled-monument',
        label: 'Scheduled Monument',
        category: 'heritage',
      },
      {
        id: 'heritage-at-risk',
        label: 'Heritage at Risk',
        category: 'heritage',
      },
      {
        id: 'article-4-direction',
        label: 'Article 4 Direction',
        category: 'development',
      },
      {
        id: 'brownfield-land',
        label: 'Brownfield Land',
        category: 'development',
      },
      {
        id: 'tree-preservation-zone',
        label: 'Tree Preservation Order',
        category: 'environment',
      },
      { id: 'green-belt', label: 'Green Belt', category: 'environment' },
      {
        id: 'area-of-outstanding-natural-beauty',
        label: 'Area of Outstanding Natural Beauty',
        category: 'environment',
      },
      {
        id: 'ancient-woodland',
        label: 'Ancient Woodland',
        category: 'environment',
      },
      // Ground-stability signals. There's no free Coal Authority point API,
      // but planning.data.gov.uk exposes these national datasets which give
      // partial ground-risk coverage.
      {
        id: 'contaminated-land',
        label: 'Contaminated Land',
        category: 'ground',
      },
      {
        id: 'mineral-safeguarding-area',
        label: 'Mineral Safeguarding Area',
        category: 'ground',
      },
    ];

    // Fetch all constraints in parallel
    await Promise.allSettled(
      datasets.map(async ({ id, label, category }) => {
        try {
          const url = `${BASE}?dataset=${id}&longitude=${lon}&latitude=${lat}&limit=3`;
          const res = await fetch(url, {
            headers: { Accept: 'application/json' },
          });
          if (!res.ok) return;
          const data = await res.json();
          for (const e of data.entities ?? []) {
            constraints.push({
              type: label,
              name: e.name ?? e.reference ?? label,
              reference: e.reference ?? null,
              category,
            });
          }
        } catch {
          /* ignore */
        }
      }),
    );

    // Fetch planning applications — UPRN only for property-specific results.
    // No proximity fallback: proximity returns all applications in the area, not this property.
    if (uprn) {
      try {
        const url = `${BASE}?dataset=planning-application&uprn=${uprn}&limit=10`;
        const res = await fetch(url, {
          headers: { Accept: 'application/json' },
        });
        if (res.ok) {
          const data = await res.json();
          for (const e of data.entities ?? []) {
            applications.push({
              reference: e.reference ?? null,
              description: e.description ?? e['address-text'] ?? e.name ?? null,
              status: e['planning-application-status'] ?? null,
              decision: e['planning-decision'] ?? null,
              decisionDate: e['decision-date'] ?? e['start-date'] ?? null,
              applicationType: e['planning-application-type'] ?? null,
              docUrl: e['documentation-url'] ?? null,
            });
          }
        }
      } catch {
        /* ignore */
      }
    }

    return { constraints, applications };
  }

  /**
   * Fetch sold price history from the HM Land Registry Linked Data API.
   * No database storage — always live, completely free, no API key required.
   * CSV column order: id, price, date, postcode, propType, newBuild, tenure,
   *                   saon, paon, street, locality, town, district, county, ppd_cat, status
   */
  private async fetchPropertySalesHistory(
    postcode: string,
    addressLine1: string,
  ): Promise<{ thisProperty: any[]; nearbySales: any[] }> {
    try {
      const formatted = normalisePostcode(postcode);
      const url = `https://landregistry.data.gov.uk/app/ppd/ppd_data.csv?postcode=${encodeURIComponent(formatted)}&limit=100`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return { thisProperty: [], nearbySales: [] };

      const csv = await res.text();
      const lines = csv.trim().split('\n').filter(Boolean);

      const propTypeMap: Record<string, string> = {
        D: 'Detached',
        S: 'Semi-Detached',
        T: 'Terraced',
        F: 'Flat/Maisonette',
        O: 'Other',
      };
      const tenureMap: Record<string, string> = {
        F: 'Freehold',
        L: 'Leasehold',
        U: 'Unknown',
      };

      function parseCsvRow(line: string): string[] {
        const result: string[] = [];
        let cur = '',
          inQuote = false;
        for (const ch of line) {
          if (ch === '"') {
            inQuote = !inQuote;
          } else if (ch === ',' && !inQuote) {
            result.push(cur.trim());
            cur = '';
          } else {
            cur += ch;
          }
        }
        result.push(cur.trim());
        return result;
      }

      // Extract PAON (house number/name) from our addressLine1 for matching.
      // Handles: "14 Woodfield Road" → "14", "14A Woodfield" → "14A",
      // "Flat 3, 14 ..." → "14" (skip flat prefix), "The Grange, ..." → "THE GRANGE"
      const cleanAddr = addressLine1
        .replace(/^(flat|apartment|unit|floor)\s+[\dA-Z]+[,\s]+/i, '')
        .trim();
      const paonRaw =
        cleanAddr
          .match(/^(\d+[A-Z]?)/i)?.[1]
          ?.trim()
          .toUpperCase() ??
        cleanAddr
          .match(/^([A-Z][^,\d]+?)(?:,|\s+\d)/i)?.[1]
          ?.trim()
          .toUpperCase() ??
        '';

      const allSales = lines
        .map((line) => {
          const cols = parseCsvRow(line);
          // cols: [id, price, date, postcode, propType, newBuild, tenure, saon, paon, street, locality, town, district, county, ...]
          const [
            id,
            price,
            date,
            ,
            propType,
            newBuild,
            tenure,
            saon,
            paon,
            street,
            ,
            town,
          ] = cols;
          return {
            id,
            price: parseInt(price?.replace(/"/g, '') ?? '0') || 0,
            date: date?.replace(/"/g, '') ?? '',
            propType: propType?.replace(/"/g, '') ?? '',
            newBuild: newBuild?.replace(/"/g, '') === 'Y',
            tenure: tenure?.replace(/"/g, '') ?? '',
            saon: saon?.replace(/"/g, '') ?? '',
            paon: paon?.replace(/"/g, '') ?? '',
            street: street?.replace(/"/g, '') ?? '',
            town: town?.replace(/"/g, '') ?? '',
          };
        })
        .filter((r) => r.price > 0)
        .sort((a, b) => b.date.localeCompare(a.date));

      const toRecord = (r: (typeof allSales)[0], isThisProperty: boolean) => ({
        price: r.price,
        date: r.date,
        address: [r.saon, r.paon, r.street].filter(Boolean).join(', '),
        town: r.town,
        propertyType: propTypeMap[r.propType] ?? r.propType ?? null,
        tenure: tenureMap[r.tenure] ?? r.tenure ?? null,
        newBuild: r.newBuild,
        isThisProperty,
      });

      const thisProperty = paonRaw
        ? allSales.filter(
            (r) =>
              r.paon.toUpperCase() === paonRaw ||
              r.saon.toUpperCase() === paonRaw,
          )
        : [];
      const nearbySales = allSales
        .filter(
          (r) =>
            !paonRaw ||
            (r.paon.toUpperCase() !== paonRaw &&
              r.saon.toUpperCase() !== paonRaw),
        )
        .slice(0, 30);

      return {
        thisProperty: thisProperty.map((r) => toRecord(r, true)),
        nearbySales: nearbySales.map((r) => toRecord(r, false)),
      };
    } catch {
      return { thisProperty: [], nearbySales: [] };
    }
  }

  /** Public method for the sold-history endpoint — queries LR API directly, zero DB storage. */
  async getLiveSoldHistory(
    propertyId: string,
  ): Promise<{ thisProperty: any[]; nearbySales: any[] }> {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
    });
    if (!property) return { thisProperty: [], nearbySales: [] };
    return this.fetchPropertySalesHistory(
      property.postcode,
      property.addressLine1,
    );
  }

  async saveHomeScore(
    propertyId: string,
    userId: string,
    data: {
      total: number;
      rating: string;
      answers: Record<string, string>;
      // V1 pillar scores
      heating?: number;
      structure?: number;
      efficiency?: number;
      electrics?: number;
      plumbing?: number;
      // V2 fields
      tier?: string;
      baseBill?: number;
      adjustedBill?: number;
      actualBill?: number;
      costPerSqm?: number;
      neighbourMedian?: number;
      billDifference?: number;
      costEfficiency?: number;
      insulation?: number;
      heatingV2?: number;
      controls?: number;
      ventilation?: number;
      lighting?: number;
      renewableBonus?: number;
    },
  ) {
    const { heating, structure, efficiency, electrics, plumbing, heatingV2, ...rest } = data;
    const payload = {
      ...rest,
      // Map V1 pillars to their nullable DB columns
      ...(heating != null ? { heatingV1: heating } : {}),
      ...(structure != null ? { structure } : {}),
      ...(efficiency != null ? { efficiency } : {}),
      ...(electrics != null ? { electrics } : {}),
      ...(plumbing != null ? { plumbing } : {}),
      // V2 heating component
      ...(heatingV2 != null ? { heating: heatingV2 } : {}),
    };
    return this.prisma.homeScoreResult.upsert({
      where: { propertyId_userId: { propertyId, userId } },
      create: { propertyId, userId, ...payload },
      update: { ...payload, updatedAt: new Date() },
    });
  }

  async getHomeScore(propertyId: string, userId: string) {
    return this.prisma.homeScoreResult.findUnique({
      where: { propertyId_userId: { propertyId, userId } },
    });
  }

  // ── HomeScore street publishing ────────────────────────────────────────────

  /** Mark the user's HomeScoreResult as published — feeds the street pool. */
  async publishHomeScore(propertyId: string, userId: string) {
    const existing = await this.prisma.homeScoreResult.findUnique({
      where: { propertyId_userId: { propertyId, userId } },
    });
    if (!existing) {
      throw new NotFoundException(
        'No HomeScore on file — run the quiz before publishing.',
      );
    }
    return this.prisma.homeScoreResult.update({
      where: { propertyId_userId: { propertyId, userId } },
      data: { publishedAt: new Date() },
    });
  }

  /** Take the user's HomeScoreResult out of the street pool. */
  async unpublishHomeScore(propertyId: string, userId: string) {
    return this.prisma.homeScoreResult.update({
      where: { propertyId_userId: { propertyId, userId } },
      data: { publishedAt: null },
    });
  }

  /**
   * Anonymised street-level publish stats for the publish screen progress bar.
   * "Street" is approximated by the postcode outcode (e.g. "CV5"); the full
   * postcode is too narrow for early-adoption stats. Returns:
   *   - totalHomes:     count of distinct properties seen in this outcode
   *   - publishedHomes: count of those with at least one published HomeScore
   */
  async getStreetPublishStats(propertyId: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { postcode: true, addressLine1: true },
    });
    if (!property) throw new NotFoundException('Property not found');

    const outcode = (property.postcode || '').split(' ')[0] || '';
    if (!outcode) {
      return {
        outcode: '',
        streetName: this.extractStreetName(property.addressLine1),
        totalHomes: 0,
        publishedHomes: 0,
      };
    }

    const [totalHomes, publishedHomes] = await Promise.all([
      this.prisma.property.count({
        where: { postcode: { startsWith: outcode } },
      }),
      this.prisma.homeScoreResult.count({
        where: {
          publishedAt: { not: null },
          property: { is: { postcode: { startsWith: outcode } } },
        } as any,
      }),
    ]);

    return {
      outcode,
      streetName: this.extractStreetName(property.addressLine1),
      totalHomes,
      publishedHomes,
    };
  }

  private extractStreetName(line: string | null | undefined): string {
    const v = (line || '').trim();
    if (!v) return 'your street';
    const match = v.match(/^\d+\s*[a-zA-Z]?\s*[,.]?\s*(.+)$/);
    return match?.[1] || v;
  }

  // ── KYC / ownership verification ───────────────────────────────────────────

  /**
   * User picked a verification method on the KYC screen. We record it and
   * mark the verification SUBMITTED. The actual partner round-trip (Onfido /
   * mortgage doc parser / Open Banking) is stubbed today — this method just
   * captures the intent so a worker can pick it up later.
   */
  async submitKyc(
    propertyId: string,
    userId: string,
    method: 'photo-id' | 'mortgage' | 'open-banking',
  ) {
    if (!['photo-id', 'mortgage', 'open-banking'].includes(method)) {
      throw new NotFoundException('Unknown verification method');
    }
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true },
    });
    if (!property) throw new NotFoundException('Property not found');

    return this.prisma.ownershipVerification.upsert({
      where: { propertyId_userId: { propertyId, userId } },
      create: {
        propertyId,
        userId,
        verificationMethod: method,
        status: 'SUBMITTED',
      },
      update: {
        verificationMethod: method,
        status: 'SUBMITTED',
        submittedAt: new Date(),
        verifiedAt: null,
      },
    });
  }

  /**
   * Current KYC status for this (user, property). Returns null when nothing
   * has been submitted. The frontend polls this after kicking off a /submit
   * to wait for VERIFIED before letting the user proceed to publish.
   */
  async getKycStatus(propertyId: string, userId: string) {
    return this.prisma.ownershipVerification.findUnique({
      where: { propertyId_userId: { propertyId, userId } },
    });
  }

  // Returns the best available homescore for a property (owner's first, then any) — no auth needed.
  // Uses the SELLER passport's owner since landlord passports are private.
  async getPublicHomeScore(propertyId: string) {
    const passport = await this.prisma.passport.findFirst({
      where: { propertyId, type: 'SELLER' },
      select: { ownerId: true },
    });
    if (passport?.ownerId) {
      const ownerScore = await this.prisma.homeScoreResult.findUnique({
        where: { propertyId_userId: { propertyId, userId: passport.ownerId } },
      });
      if (ownerScore) return ownerScore;
    }
    return this.prisma.homeScoreResult.findFirst({
      where: { propertyId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  // ── Passport status ────────────────────────────────────────────────────────

  async getPassportStatus(propertyId: string, userId: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      include: {
        passports: {
          select: {
            id: true,
            ownerId: true,
            status: true,
            type: true,
            collaborators: { where: { userId }, select: { id: true } },
            buyerAccesses: { where: { userId }, select: { id: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!property)
      return {
        hasPassport: false,
        passportId: null,
        isOwner: false,
        isCollaborator: false,
        isBuyer: false,
        verificationStatus: null,
      };

    // Buyer-facing endpoint — only seller passports are public. Landlord
    // passports stay invisible to anyone but the landlord (and collaborators
    // attached to that specific passport).
    const sellerPassport =
      ((property as any).passports as any[])?.find((p) => p.type === 'SELLER') ?? null;

    if (!sellerPassport) {
      const verification = await this.prisma.ownershipVerification.findUnique({
        where: { propertyId_userId: { propertyId, userId } },
      });
      return {
        hasPassport: false,
        passportId: null,
        isOwner: false,
        isCollaborator: false,
        isBuyer: false,
        verificationStatus: verification?.status ?? null,
      };
    }

    const passport = sellerPassport;
    const isOwner = passport.ownerId === userId;
    const isCollaborator = passport.collaborators.length > 0;
    const isBuyer =
      !isOwner && !isCollaborator && (passport.buyerAccesses?.length ?? 0) > 0;
    const isPublished = passport.status === 'PUBLISHED';

    // Real-time progress summary — public-safe (counts + section keys only,
    // no question/answer content). Drives the property page's "Passport
    // being built" card so buyers see actual completion, not a proxy.
    const progress = await this.buildPassportProgress(passport.id);

    return {
      hasPassport: true,
      passportId: passport.id,
      passportStatus: passport.status,
      isPublished,
      isOwner,
      isCollaborator,
      isBuyer,
      // Owner/collaborator can always access; buyers and public only if published
      canAccess: isOwner || isCollaborator || isBuyer || isPublished,
      verificationStatus: null,
      passportProgress: progress,
    };
  }

  /**
   * Public-safe completion summary for a passport. Aggregates sections + tasks
   * + question answers into counts + per-section status. Returns null on
   * unexpected error so the caller can degrade gracefully.
   *
   * Surface shape (matches what the frontend expects):
   *   {
   *     completedSections, totalSections,
   *     completedTasks,    totalTasks,
   *     completionPct,                      // 0–100 over task counts
   *     sections: [{ key, title, status, completedTasks, totalTasks }]
   *   }
   */
  private async buildPassportProgress(passportId: string): Promise<any> {
    try {
      const sections = await this.prisma.passportSection.findMany({
        where: { passportId },
        select: {
          key: true,
          title: true,
          status: true,
          order: true,
          tasks: {
            select: {
              id: true,
              passportQuestions: {
                select: { answer: { select: { id: true } } },
              },
            },
          },
        },
        orderBy: { order: 'asc' },
      });
      if (sections.length === 0) {
        return {
          completedSections: 0,
          totalSections: 0,
          completedTasks: 0,
          totalTasks: 0,
          completionPct: 0,
          sections: [],
        };
      }
      let totalTasks = 0;
      let completedTasks = 0;
      const sectionRows = sections.map((s) => {
        const sTotal = s.tasks.length;
        let sDone = 0;
        for (const t of s.tasks) {
          // A task is "complete" when every question on it has an answer.
          if (
            t.passportQuestions.length > 0 &&
            t.passportQuestions.every((q) => q.answer)
          ) {
            sDone += 1;
          }
        }
        totalTasks += sTotal;
        completedTasks += sDone;
        return {
          key: s.key,
          title: s.title,
          status: s.status,
          completedTasks: sDone,
          totalTasks: sTotal,
        };
      });
      const completedSections = sectionRows.filter(
        (s) => s.totalTasks > 0 && s.completedTasks === s.totalTasks,
      ).length;
      const completionPct =
        totalTasks > 0
          ? Math.round((completedTasks / totalTasks) * 100)
          : 0;
      return {
        completedSections,
        totalSections: sections.length,
        completedTasks,
        totalTasks,
        completionPct,
        sections: sectionRows,
      };
    } catch {
      return null;
    }
  }

  async startVerification(propertyId: string, userId: string) {
    return this.prisma.ownershipVerification.upsert({
      where: { propertyId_userId: { propertyId, userId } },
      update: { status: 'SUBMITTED', submittedAt: new Date() },
      create: { propertyId, userId, status: 'SUBMITTED' },
    });
  }

  async getVerificationStatus(propertyId: string, userId: string) {
    return this.prisma.ownershipVerification.findUnique({
      where: { propertyId_userId: { propertyId, userId } },
    });
  }

  async completeVerification(propertyId: string, userId: string) {
    // Mark ownership verified. We DELIBERATELY do NOT create a passport
    // here — that would silently default to type=SELLER even when the user
    // is claiming a LANDLORD passport, producing two passports per property
    // (one SELLER from this path + one LANDLORD from the frontend's
    // subsequent claimPassport call). The frontend's claimPassport(),
    // called immediately after this, owns passport creation and knows the
    // user's chosen type.
    await this.prisma.ownershipVerification.upsert({
      where: { propertyId_userId: { propertyId, userId } },
      update: { status: 'VERIFIED', verifiedAt: new Date() },
      create: {
        propertyId,
        userId,
        status: 'VERIFIED',
        verifiedAt: new Date(),
      },
    });

    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
    });
    if (!property) throw new Error('Property not found');

    return { ok: true };
  }

  /**
   * Run HM Land Registry Online Owner Verification for a (property, user)
   * pair and persist the outcome on the OwnershipVerification row.
   *
   * Inputs come from the existing rows we already have:
   *   - User.firstName / .lastName for the proprietor name on the title
   *   - Property.titleNumber if known, otherwise addressLine1 + postcode
   *
   * Status mapping (HMLR TypeCode + MatchResult → our enum):
   *   TypeCode 30 / SINGLE_MATCH / surname+forename MATCH / not historical
   *                                               → VERIFIED
   *   TypeCode 30 / SINGLE_MATCH / partial / historical / middle name mismatch
   *                                               → ADDITIONAL_INFO_NEEDED
   *   TypeCode 30 / MULTIPLE_MATCHES              → ADDITIONAL_INFO_NEEDED
   *   TypeCode 30 / NO_MATCHES                    → FAILED
   *   TypeCode 20 (rejection)                     → FAILED
   *   TypeCode 10 (acknowledgement, queued)       → IN_PROGRESS
   */
  async verifyOwnershipWithLandRegistry(
    propertyId: string,
    userId: string,
    opts?: { messageId?: string },
  ) {
    const [user, property] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.property.findUnique({ where: { id: propertyId } }),
    ]);
    if (!user) throw new NotFoundException('User not found');
    if (!property) throw new NotFoundException('Property not found');

    // ── BETA BYPASS ─────────────────────────────────────────────
    // Until production HMLR Business Gateway credentials arrive
    // (and Railway's egress IP is allow-listed), every real
    // property is rejected by the test stub — it only knows
    // "Jon Tomas Tankerman @ 101A PL1 1QQ" — so testers claiming
    // their own homes see "Ownership not confirmed" every time.
    //
    // For now we synthesise a VERIFIED result whenever the OV
    // endpoint is HMLR's test stub OR HMLR_BYPASS=true is set,
    // and record the OwnershipVerification row with a distinctive
    // messageId so a later audit query can find + reprocess
    // these entries against the real endpoint. When the prod
    // endpoint env is populated on Railway, this branch stops
    // firing and real OOV takes over — no code change needed.
    //
    // Positioned BEFORE the firstName/surname + postcode/title
    // guards because those exist to protect the real HMLR call
    // from missing inputs. In bypass mode we're not calling HMLR
    // at all, and testers on fresh OTP-only signups (no name
    // captured yet) shouldn't be blocked from claiming.
    const bypassEnabled =
      process.env.HMLR_BYPASS === 'true' ||
      (process.env.HMLR_OV_ENDPOINT ?? '').includes('bgtest.') ||
      (process.env.HMLR_OV_ENDPOINT ?? '').includes('EOOV_StubService') ||
      !process.env.HMLR_OV_ENDPOINT;

    if (bypassEnabled) {
      const bypassMessageId = `BYPASS-${propertyId.slice(0, 8)}-${Date.now()}`;
      await this.prisma.ownershipVerification.upsert({
        where: { propertyId_userId: { propertyId, userId } },
        update: {
          status: 'VERIFIED',
          verifiedAt: new Date(),
          landRegistryMessageId: bypassMessageId,
          landRegistryTitleNumber: property.titleNumber ?? null,
          landRegistryMatchResult: 'SINGLE_MATCH',
          // Store the marker so we can query for bypassed rows later
          // and re-run them against real HMLR before publishing.
          landRegistryRawResponse: {
            bypassed: true,
            reason: 'HMLR test endpoint / awaiting prod credentials',
            bypassedAt: new Date().toISOString(),
          } as any,
          landRegistryCheckedAt: new Date(),
        },
        create: {
          propertyId,
          userId,
          status: 'VERIFIED',
          verifiedAt: new Date(),
          landRegistryMessageId: bypassMessageId,
          landRegistryTitleNumber: property.titleNumber ?? null,
          landRegistryMatchResult: 'SINGLE_MATCH',
          landRegistryRawResponse: {
            bypassed: true,
            reason: 'HMLR test endpoint / awaiting prod credentials',
            bypassedAt: new Date().toISOString(),
          } as any,
          landRegistryCheckedAt: new Date(),
        },
      });
      return {
        status: 'VERIFIED' as const,
        typeCode: 30,
        matchResult: 'SINGLE_MATCH' as const,
        titleNumber: property.titleNumber ?? undefined,
        ownership: undefined,
        historical: false,
        rejection: undefined,
        acknowledgement: undefined,
        messageId: bypassMessageId,
      };
    }

    // Real-HMLR input guards — only checked when we're actually
    // calling out. The bypass path above doesn't need these
    // because it doesn't build an OOV request.
    if (!user.firstName || !user.lastName) {
      throw new BadRequestException(
        'First name and surname are required on the user profile before ' +
          'running a Land Registry ownership check.',
      );
    }
    if (!property.postcode && !property.titleNumber) {
      throw new BadRequestException(
        'Property needs either a title number or a postcode for HMLR lookup.',
      );
    }

    const subject = property.titleNumber
      ? { titleNumber: property.titleNumber }
      : {
          address: {
            buildingName: undefined,
            buildingNumber: undefined,
            streetName: property.addressLine1 ?? undefined,
            cityName: property.city ?? undefined,
            postcode: property.postcode ?? undefined,
          },
        };

    // HMLR's test stub (`EOOV_StubService`) only responds to specific canned
    // MessageIds (e.g. `eoov-fm-1`, `eoov-pi-1`); any other id is rejected
    // with "Message ID or test specific data, not recognised for test
    // service". Default to a full-match scenario when we hit the stub and the
    // caller didn't pin a scenario explicitly. Production endpoint
    // (`EOOV_SoapEngine`) accepts any unique MessageId, so we leave it alone.
    const endpoint = process.env.HMLR_OV_ENDPOINT ?? '';
    const isTestStub = endpoint.includes('EOOV_StubService') || endpoint === '';
    const messageId =
      opts?.messageId ?? (isTestStub ? 'eoov-fm-1' : undefined);

    let result: VerifyOwnershipResult;
    try {
      result = await this.landRegistry.verifyOwnership({
        reference: `UMU-${propertyId.slice(0, 8)}-${userId.slice(0, 8)}`,
        forename: user.firstName,
        surname: user.lastName,
        subject,
        options: { continueIfOutOfHours: true },
        messageId,
      });
    } catch (e) {
      const err = e as Error;
      // Log the full stack server-side — the client only gets a sanitised
      // message via BadRequestException below.
      // eslint-disable-next-line no-console
      console.error('[HMLR] verifyOwnership failed:', err);
      // Persist the failure so the caller can see what happened — and so
      // we don't silently flip the row to VERIFIED on a transport error.
      await this.persistOvFailure(propertyId, userId, err.message);
      throw new BadRequestException(
        `HM Land Registry call failed: ${err.message}`,
      );
    }

    const status = this.classifyOvResult(result);
    const topMatch = result.result?.matches?.[0];

    await this.prisma.ownershipVerification.upsert({
      where: { propertyId_userId: { propertyId, userId } },
      update: {
        status,
        verifiedAt: status === 'VERIFIED' ? new Date() : null,
        landRegistryMessageId: result.messageId,
        landRegistryTitleNumber: topMatch?.titleNumber ?? null,
        landRegistryMatchResult: result.result?.matchResult ?? null,
        landRegistryRawResponse: this.ovResultToJson(result),
        landRegistryCheckedAt: new Date(),
      },
      create: {
        propertyId,
        userId,
        status,
        verifiedAt: status === 'VERIFIED' ? new Date() : null,
        landRegistryMessageId: result.messageId,
        landRegistryTitleNumber: topMatch?.titleNumber ?? null,
        landRegistryMatchResult: result.result?.matchResult ?? null,
        landRegistryRawResponse: this.ovResultToJson(result),
        landRegistryCheckedAt: new Date(),
      },
    });

    // Promote the HMLR-returned title number to Property.titleNumber so
    // every downstream surface (claim, buyer view, TA6 form, costs page)
    // shows the real register ID — not the per-OV-row copy. We only
    // promote on a confirmed VERIFIED match: ADDITIONAL_INFO_NEEDED can
    // come from MULTIPLE_MATCHES where `topMatch` is ambiguous, and we
    // don't want to lock the property to one of several possible titles.
    if (
      status === 'VERIFIED' &&
      topMatch?.titleNumber &&
      topMatch.titleNumber !== property.titleNumber
    ) {
      try {
        await this.prisma.property.update({
          where: { id: propertyId },
          data: { titleNumber: topMatch.titleNumber },
        });
      } catch (err) {
        // Non-blocking — the OV row already records the title number.
        console.error(
          `[OV] Failed to promote HMLR title number to Property ${propertyId}:`,
          err,
        );
      }
    }

    return {
      status,
      typeCode: result.typeCode,
      matchResult: result.result?.matchResult,
      titleNumber: topMatch?.titleNumber,
      ownership: topMatch?.info?.Ownership,
      historical: topMatch?.info?.HistoricalMatch === 'true',
      rejection: result.rejection,
      acknowledgement: result.acknowledgement,
      messageId: result.messageId,
    };
  }

  private classifyOvResult(
    r: VerifyOwnershipResult,
  ): 'VERIFIED' | 'ADDITIONAL_INFO_NEEDED' | 'FAILED' | 'IN_PROGRESS' {
    if (r.typeCode === 10) return 'IN_PROGRESS';
    if (r.typeCode === 20) return 'FAILED';
    if (r.typeCode !== 30 || !r.result) return 'FAILED';

    const res = r.result;
    if (res.matchResult === 'NO_MATCHES') return 'FAILED';
    if (res.matchResult === 'MULTIPLE_MATCHES') return 'ADDITIONAL_INFO_NEEDED';

    // SINGLE_MATCH — drill into the match types.
    const m = res.matches[0];
    if (!m) return 'FAILED';
    const surnameOk = m.surnameMatch?.typeOfMatch === 'MATCH';
    const forenameOk = m.forenameMatch?.typeOfMatch === 'MATCH';
    const historical = m.info?.HistoricalMatch === 'true';
    if (surnameOk && forenameOk && !historical) return 'VERIFIED';
    return 'ADDITIONAL_INFO_NEEDED';
  }

  private ovResultToJson(r: VerifyOwnershipResult): any {
    // Strip the giant raw XML; keep only the parsed structure for the row.
    const { raw: _raw, ...rest } = r;
    return rest as any;
  }

  private async persistOvFailure(
    propertyId: string,
    userId: string,
    errorMessage: string,
  ) {
    await this.prisma.ownershipVerification.upsert({
      where: { propertyId_userId: { propertyId, userId } },
      update: {
        status: 'FAILED',
        landRegistryCheckedAt: new Date(),
        landRegistryRawResponse: { error: errorMessage } as any,
      },
      create: {
        propertyId,
        userId,
        status: 'FAILED',
        landRegistryCheckedAt: new Date(),
        landRegistryRawResponse: { error: errorMessage } as any,
      },
    });
  }

  // ── Wishlist ───────────────────────────────────────────────────────────────

  async toggleWishlist(userId: string, propertyId: string) {
    const existing = await this.prisma.userWishlist.findUnique({
      where: { userId_propertyId: { userId, propertyId } },
    });
    if (existing) {
      await this.prisma.userWishlist.delete({ where: { id: existing.id } });
      return { wishlisted: false };
    }
    await this.prisma.userWishlist.create({ data: { userId, propertyId } });
    return { wishlisted: true };
  }

  async getWishlist(userId: string) {
    const items = await this.prisma.userWishlist.findMany({
      where: { userId },
      include: { property: true },
      orderBy: { createdAt: 'desc' },
    });
    return items.map((item) => ({
      ...item.property,
      wishlistedAt: item.createdAt,
    }));
  }

  // ── Saved Properties ───────────────────────────────────────────────────────

  async toggleSave(userId: string, propertyId: string) {
    const existing = await this.prisma.userSavedProperty.findUnique({
      where: { userId_propertyId: { userId, propertyId } },
    });
    if (existing) {
      await this.prisma.userSavedProperty.delete({
        where: { id: existing.id },
      });
      return { saved: false };
    }
    await this.prisma.userSavedProperty.create({
      data: { userId, propertyId },
    });
    return { saved: true };
  }

  async getSavedProperties(userId: string) {
    const items = await this.prisma.userSavedProperty.findMany({
      where: { userId },
      include: { property: true },
      orderBy: { createdAt: 'desc' },
    });
    return items.map((item) => ({ ...item.property, savedAt: item.createdAt }));
  }

  async getPropertyActions(userId: string, propertyId: string) {
    const [wishlist, saved] = await Promise.all([
      this.prisma.userWishlist.findUnique({
        where: { userId_propertyId: { userId, propertyId } },
      }),
      this.prisma.userSavedProperty.findUnique({
        where: { userId_propertyId: { userId, propertyId } },
      }),
    ]);
    return { wishlisted: !!wishlist, saved: !!saved };
  }

  /**
   * HomeScore V2 Neighbourhood: queries EPC API for postcode, returns
   * median & std-dev of cost_per_sqm for matching property type + age band.
   * Used to compute neighbourhood-adjusted score on the frontend.
   */
  // ── Market pulse ────────────────────────────────────────────────────────
  //
  // Aggregate stats for the area surrounding a given postcode (sector-level —
  // e.g. CV5 6 covers ~5–15 streets). Returns only the figures we can
  // actually derive from local data:
  //   - priceChangeYoY: average price in the last 12 months vs. the prior
  //     12 months from Land Registry Price Paid. Null if either window has
  //     fewer than 5 transactions (sample too small to be meaningful).
  //   - passportListings: count of passports owned by users in this sector.
  //   - avgDaysToSell: NOT derivable from Price Paid (it only records the
  //     completion date). Always null; the UI hides the cell.
  //
  // The area label is humanised from the property table when possible
  // (closest property's city/town), else falls back to the postcode sector.
  async getMarketPulse(postcode?: string): Promise<{
    area: string | null;
    priceChangeYoY: number | null;
    avgDaysToSell: number | null;
    passportListings: number;
    sampleSize: { recent: number; prior: number };
  }> {
    const cleaned = (postcode ?? '').replace(/\s+/g, '').toUpperCase();
    if (!cleaned) {
      return {
        area: null,
        priceChangeYoY: null,
        avgDaysToSell: null,
        passportListings: 0,
        sampleSize: { recent: 0, prior: 0 },
      };
    }
    // Sector = postcode minus the last 2 chars, e.g. "CV56AJ" → "CV56".
    const sector = cleaned.length >= 3 ? cleaned.slice(0, -2) : cleaned;

    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const twoYearsAgo = new Date(now);
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    const [recent, prior, passportListings, sample] = await Promise.all([
      this.prisma.pricePaidTransaction.findMany({
        where: {
          postcode: { startsWith: sector },
          transactionDate: { gte: oneYearAgo, lte: now },
        },
        select: { price: true },
      }),
      this.prisma.pricePaidTransaction.findMany({
        where: {
          postcode: { startsWith: sector },
          transactionDate: { gte: twoYearsAgo, lt: oneYearAgo },
        },
        select: { price: true },
      }),
      this.prisma.passport.count({
        where: { postcode: { startsWith: sector } },
      }),
      this.prisma.property.findFirst({
        where: { postcode: { startsWith: sector } },
        select: { city: true, county: true, postcode: true },
      }),
    ]);

    const avg = (rows: { price: number | bigint }[]) => {
      if (!rows.length) return null;
      const total = rows.reduce((s, r) => s + Number(r.price), 0);
      return total / rows.length;
    };

    let priceChangeYoY: number | null = null;
    if (recent.length >= 5 && prior.length >= 5) {
      const aR = avg(recent)!;
      const aP = avg(prior)!;
      if (aP > 0) {
        priceChangeYoY = +(((aR - aP) / aP) * 100).toFixed(1);
      }
    }

    const area =
      sample?.city ?? sample?.county ?? (sector ? `${sector} area` : null);

    return {
      area,
      priceChangeYoY,
      avgDaysToSell: null,
      passportListings,
      sampleSize: { recent: recent.length, prior: prior.length },
    };
  }

  async getNeighbourhoodStats(propertyId: string): Promise<{
    median: number | null;
    stdDev: number | null;
    sampleSize: number;
    postcode: string | null;
  }> {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
    });
    if (!property?.postcode) {
      return { median: null, stdDev: null, sampleSize: 0, postcode: null };
    }

    const postcode = property.postcode;

    try {
      // Fetch up to 100 EPC records for the postcode
      const url = `${EPC_API_BASE}/api/domestic/search?postcode=${encodeURIComponent(postcode)}&size=100`;
      const res = await fetch(url, {
        headers: { Authorization: epcAuthHeader(), Accept: 'application/json' },
      });
      if (!res.ok) {
        return { median: null, stdDev: null, sampleSize: 0, postcode };
      }

      const data = await res.json();
      const rows: any[] = data.rows ?? [];
      if (rows.length === 0) {
        return { median: null, stdDev: null, sampleSize: 0, postcode };
      }

      // Extract cost_per_sqm for each record (heating + hotwater + lighting / floor area)
      const costPerSqmSamples: number[] = [];
      for (const row of rows) {
        const heatingCost = parseFloat(String(row['heating-cost-current'] ?? ''));
        const hwCost = parseFloat(String(row['hot-water-cost-current'] ?? ''));
        const lightingCost = parseFloat(String(row['lighting-cost-current'] ?? ''));
        const floorArea = parseFloat(String(row['total-floor-area'] ?? ''));

        if (
          isNaN(heatingCost) || isNaN(hwCost) || isNaN(lightingCost) ||
          isNaN(floorArea) || floorArea <= 0
        ) continue;

        const baseBill = heatingCost + hwCost + lightingCost;
        const costPerSqm = baseBill / floorArea;
        if (costPerSqm > 0 && costPerSqm < 500) {
          // Sanity cap: exclude obvious outliers
          costPerSqmSamples.push(costPerSqm);
        }
      }

      if (costPerSqmSamples.length < 3) {
        return { median: null, stdDev: null, sampleSize: costPerSqmSamples.length, postcode };
      }

      // Compute median
      const sorted = [...costPerSqmSamples].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];

      // Compute population std dev
      const mean = costPerSqmSamples.reduce((s, v) => s + v, 0) / costPerSqmSamples.length;
      const variance = costPerSqmSamples.reduce((s, v) => s + (v - mean) ** 2, 0) / costPerSqmSamples.length;
      const stdDev = Math.sqrt(variance);

      return {
        median: Math.round(median * 100) / 100,
        stdDev: Math.round(stdDev * 100) / 100,
        sampleSize: costPerSqmSamples.length,
        postcode,
      };
    } catch (error) {
      console.error(`[Neighbourhood] Error fetching EPC data for ${postcode}:`, error);
      return { median: null, stdDev: null, sampleSize: 0, postcode };
    }
  }

  // ── Register Interest ────────────────────────────────────────────────────────

  async registerInterest(
    propertyId: string,
    userId: string,
    body: { interestLevel: string; name?: string; userEmail?: string },
  ) {
    const property = await this.prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) throw new NotFoundException('Property not found');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true, phone: true },
    });

    const passport = await this.prisma.passport.findFirst({
      where: { propertyId },
      include: { owner: { select: { email: true } } },
    });

    const propertyAddress = [property.addressLine1, property.city, property.postcode]
      .filter(Boolean).join(', ');
    const userName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || body.name || 'A UMovingU user';
    const userEmail = user?.email || body.userEmail;

    const interestLabels: Record<string, string> = {
      dream: '🏡 Dream Home — This is exactly what they\'re looking for',
      super: '🛋️ Super Keen — Very interested and ready to move quickly',
      browsing: '🌳 Just Browsing — Interested but still exploring options',
    };
    const interestLabel = interestLabels[body.interestLevel] || body.interestLevel;

    const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#ffffff;">
  <h2 style="color:#00a19a;margin:0 0 4px;">New Interest Registered</h2>
  <p style="color:#8f9094;font-size:14px;margin:0 0 24px;">via UMovingU</p>
  <div style="background:#f6f6f7;border-radius:12px;padding:20px;margin-bottom:16px;">
    <p style="margin:0 0 8px;color:#1f2024;"><strong>Property:</strong> ${propertyAddress}</p>
    <p style="margin:0 0 8px;color:#1f2024;"><strong>From:</strong> ${userName}${userEmail ? ` (${userEmail})` : ''}</p>
    <p style="margin:0;color:#1f2024;"><strong>Interest Level:</strong> ${interestLabel}</p>
  </div>
  <hr style="border:none;border-top:1px solid #e5e5ea;margin:24px 0;" />
  <p style="color:#b4b5b8;font-size:11px;text-align:center;margin:0;">UMovingU · hello@umovingu.io</p>
</div>`;

    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.RESEND_FROM ?? 'UMovingU <info@umovingu.io>';
    const to = ['hello@umovingu.io'];
    if (passport?.owner?.email && passport.owner.email !== 'hello@umovingu.io') {
      to.push(passport.owner.email);
    }

    await resend.emails.send({
      from,
      to,
      subject: `New Interest: ${property.addressLine1}, ${property.postcode}`,
      html,
    });

    return { success: true };
  }

  // ── Tap the Owner ────────────────────────────────────────────────────────────

  async tapOwner(
    propertyId: string,
    userId: string,
    body: { message: string; sharePhone?: boolean },
  ): Promise<{ success: boolean; ownerPhone: string | null }> {
    const property = await this.prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) throw new NotFoundException('Property not found');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true, phone: true },
    });

    if (!user?.phone || !user.phone.trim()) {
      throw new BadRequestException('A phone number is required on your profile to contact an owner. Please add it in Profile → Personal Information.');
    }

    const passport = await this.prisma.passport.findFirst({
      where: { propertyId },
      include: { owner: { select: { email: true, phone: true, firstName: true } } },
    });

    const propertyAddress = [property.addressLine1, property.city, property.postcode]
      .filter(Boolean).join(', ');
    const userName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'A UMovingU user';
    const userPhone = body.sharePhone ? (user?.phone ?? null) : null;

    const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#ffffff;">
  <h2 style="color:#00a19a;margin:0 0 4px;">Message via UMovingU</h2>
  <p style="color:#8f9094;font-size:14px;margin:0 0 24px;">Someone wants to connect about your property</p>
  <div style="background:#f6f6f7;border-radius:12px;padding:20px;margin-bottom:16px;">
    <p style="margin:0 0 8px;color:#1f2024;"><strong>Property:</strong> ${propertyAddress}</p>
    <p style="margin:0 0 8px;color:#1f2024;"><strong>From:</strong> ${userName}</p>
    ${user?.email ? `<p style="margin:0 0 8px;color:#1f2024;"><strong>Email:</strong> ${user.email}</p>` : ''}
    ${userPhone ? `<p style="margin:0;color:#1f2024;"><strong>Phone:</strong> ${userPhone}</p>` : ''}
  </div>
  <div style="border:1.5px solid #e5e5ea;border-radius:12px;padding:20px;margin-bottom:16px;">
    <p style="margin:0;color:#1f2024;white-space:pre-wrap;">${body.message}</p>
  </div>
  <hr style="border:none;border-top:1px solid #e5e5ea;margin:24px 0;" />
  <p style="color:#b4b5b8;font-size:11px;text-align:center;margin:0;">UMovingU · hello@umovingu.io</p>
</div>`;

    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.RESEND_FROM ?? 'UMovingU <info@umovingu.io>';
    const to = ['hello@umovingu.io'];
    if (passport?.owner?.email && passport.owner.email !== 'hello@umovingu.io') {
      to.push(passport.owner.email);
    }

    await resend.emails.send({
      from,
      to,
      subject: `Message about: ${property.addressLine1}, ${property.postcode}`,
      html,
    });

    return { success: true, ownerPhone: passport?.owner?.phone ?? null };
  }

  // ── For You ──────────────────────────────────────────────────────────────────

  async getForYou(
    userId: string,
  ): Promise<{ items: any[]; total: number; needsPostcode?: boolean }> {
    const [user, preference] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { postcode: true },
      }),
      this.prisma.userPreference.findUnique({ where: { userId } }),
    ]);

    const postcode = user?.postcode?.trim();
    if (!postcode) {
      return { items: [], total: 0, needsPostcode: true };
    }
    const { items } = await this.searchProperties(postcode, 0, 20);

    const budgetMin = preference?.budgetMin ?? null;
    const budgetMax = preference?.budgetMax ?? null;
    const preferredTypes: string[] = Array.isArray(preference?.propertyTypes)
      ? (preference.propertyTypes as string[])
      : [];
    const importantFeatures: string[] = Array.isArray(preference?.importantFeatures)
      ? (preference.importantFeatures as string[])
      : [];
    const wantsEfficientEnergy =
      importantFeatures.some((f) =>
        /energy|epc|efficient|green|eco/i.test(f),
      );

    const scored = items.map((property) => {
      // ── Budget score (40%) ──────────────────────────────────────────────────
      let budgetScore = 50; // neutral when no budget pref or no price data
      const price = property.estimatedPrice ?? property.lastSoldPrice ?? null;
      if ((budgetMin != null || budgetMax != null) && price != null) {
        const min = budgetMin ?? 0;
        const max = budgetMax ?? Infinity;
        if (price < min) {
          // Under budget — good but might be too cheap
          budgetScore = 80;
        } else if (price <= max) {
          // Within budget — perfect
          budgetScore = 100;
        } else {
          // Over budget — penalise proportionally (0 at 50%+ over max)
          const overBy = (price - max) / max;
          budgetScore = Math.max(0, Math.round(100 - overBy * 200));
        }
      }

      // ── Type score (30%) ────────────────────────────────────────────────────
      let typeScore = 50; // neutral when no type pref
      if (preferredTypes.length > 0 && property.propertyType) {
        const propType = (property.propertyType as string).toLowerCase();
        const matched = preferredTypes.some((t) =>
          propType.includes(t.toLowerCase()) || t.toLowerCase().includes(propType),
        );
        typeScore = matched ? 100 : 0;
      }

      // ── EPC / features score (30%) ──────────────────────────────────────────
      let featuresScore = 50; // neutral when no feature pref
      if (wantsEfficientEnergy && property.epcRating) {
        const rating = (property.epcRating as string).toUpperCase();
        const epcMap: Record<string, number> = {
          A: 100, B: 90, C: 75, D: 50, E: 25, F: 10, G: 0,
        };
        featuresScore = epcMap[rating] ?? 50;
      }

      const matchScore = Math.round(
        budgetScore * 0.4 + typeScore * 0.3 + featuresScore * 0.3,
      );

      return { ...property, matchScore };
    });

    // Sort by match score descending; return top 5
    scored.sort((a, b) => b.matchScore - a.matchScore);
    const top = scored.slice(0, 5);
    return { items: top, total: top.length };
  }

  // ── Radius search helpers ─────────────────────────────────────────────────
  private async resolveQueryLatLon(
    query: string,
  ): Promise<{ lat: number; lon: number } | null> {
    const cleaned = query.replace(/\s/g, '').toUpperCase();
    // 1. Try exact postcode first
    try {
      const res = await fetch(
        `https://api.postcodes.io/postcodes/${cleaned}`,
      );
      if (res.ok) {
        const data = await res.json();
        const r = data?.result;
        if (r?.latitude && r?.longitude) {
          return { lat: r.latitude, lon: r.longitude };
        }
      }
    } catch {
      /* ignore */
    }
    // 2. Try postcode autocomplete
    try {
      const res = await fetch(
        `https://api.postcodes.io/postcodes?q=${encodeURIComponent(query)}&limit=1`,
      );
      if (res.ok) {
        const data = await res.json();
        const r = data?.result?.[0];
        if (r?.latitude && r?.longitude) {
          return { lat: r.latitude, lon: r.longitude };
        }
      }
    } catch {
      /* ignore */
    }
    // 3. Try place outcode/city lookup via outcodes endpoint
    try {
      const res = await fetch(
        `https://api.postcodes.io/outcodes/${cleaned}`,
      );
      if (res.ok) {
        const data = await res.json();
        const r = data?.result;
        if (r?.latitude && r?.longitude) {
          return { lat: r.latitude, lon: r.longitude };
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  private async searchWithinRadius(
    centre: { lat: number; lon: number },
    radiusMiles: number,
    offset: number,
    limit: number,
  ): Promise<{ items: Property[]; total: number }> {
    // Convert radius to deg (approximation): 1° lat ≈ 69 mi
    const latDelta = radiusMiles / 69;
    const lonDelta = radiusMiles / (69 * Math.cos((centre.lat * Math.PI) / 180));

    const where = {
      AND: [
        {
          OR: [
            { udprn: { startsWith: 'EPC-' } },
            { udprn: { startsWith: 'OS-' } },
          ],
        },
        { latitude: { gte: centre.lat - latDelta, lte: centre.lat + latDelta } },
        {
          longitude: {
            gte: centre.lon - lonDelta,
            lte: centre.lon + lonDelta,
          },
        },
      ],
    };

    // Fetch generously then haversine-filter for exact radius
    const raw = await this.prisma.property.findMany({
      where,
      include: {
        passports: {
          where: { type: 'SELLER' },
          select: {
            id: true,
            status: true,
            sections: {
              select: {
                tasks: {
                  select: {
                    passportQuestions: {
                      select: { id: true, answer: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const R_MI = 3958.8;
    const distMi = (lat2: number, lon2: number): number => {
      const dLat = ((lat2 - centre.lat) * Math.PI) / 180;
      const dLon = ((lon2 - centre.lon) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((centre.lat * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) ** 2;
      return R_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const withinRadius = raw
      .filter((p) => p.latitude != null && p.longitude != null)
      .map((p) => ({ p, d: distMi(p.latitude!, p.longitude!) }))
      .filter(({ d }) => d <= radiusMiles)
      .sort((a, b) => a.d - b.d);

    const total = withinRadius.length;
    const page = withinRadius.slice(offset, offset + limit);

    const items = page.map(({ p, d }) => {
      const { passport, ...rest } = p as any;
      const isPublished = passport?.status === 'PUBLISHED';
      let passportCompletion: number | null = null;
      if (passport && isPublished) {
        const allTasks = passport.sections.flatMap((s: any) => s.tasks);
        const doneTasks = allTasks.filter((t: any) => {
          const totalQ = t.passportQuestions.length;
          const answered = t.passportQuestions.filter(
            (q: any) => q.answer !== null,
          ).length;
          return totalQ > 0 && answered === totalQ;
        }).length;
        passportCompletion =
          allTasks.length > 0
            ? Math.round((doneTasks / allTasks.length) * 100)
            : 0;
      }
      return {
        ...rest,
        addressLine1: titleCase(rest.addressLine1) || rest.addressLine1,
        addressLine2: rest.addressLine2
          ? titleCase(rest.addressLine2)
          : rest.addressLine2,
        city: rest.city ? titleCase(rest.city) : rest.city,
        county: rest.county ? titleCase(rest.county) : rest.county,
        hasPassport: !!passport,
        passportPublished: isPublished,
        passportCompletion,
        distanceMiles: +d.toFixed(2),
      };
    });

    return { items, total };
  }

  // ── Verified passport properties (sellers browse examples) ────────────────
  async getVerifiedPassportProperties(
    offset = 0,
    limit = 12,
  ): Promise<{ items: any[]; total: number }> {
    // Only published seller passports are public — landlord passports never show here.
    const where = {
      passports: {
        some: { status: 'PUBLISHED' as const, type: 'SELLER' as const },
      },
    };

    const [total, rows] = await Promise.all([
      this.prisma.property.count({ where }),
      this.prisma.property.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          passports: {
            where: { type: 'SELLER' },
            select: {
              id: true,
              status: true,
              sections: {
                select: {
                  tasks: {
                    select: {
                      passportQuestions: {
                        select: { id: true, answer: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const items = rows.map(({ passports, ...p }) => {
      const passport = (passports as any[])?.[0] ?? null;
      let passportCompletion: number | null = null;
      if (passport) {
        const allTasks = passport.sections.flatMap((s: any) => s.tasks);
        const doneTasks = allTasks.filter((t: any) => {
          const total = t.passportQuestions.length;
          const answered = t.passportQuestions.filter(
            (q: any) => q.answer !== null,
          ).length;
          return total > 0 && answered === total;
        }).length;
        passportCompletion =
          allTasks.length > 0
            ? Math.round((doneTasks / allTasks.length) * 100)
            : 0;
      }
      return {
        ...p,
        hasPassport: true,
        passportPublished: true,
        passportId: passport?.id ?? null,
        passportCompletion,
      };
    });

    return { items, total };
  }

  // ── Street properties ─────────────────────────────────────────────────────

  async getStreetProperties(propertyId: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { postcode: true, addressLine1: true },
    });
    if (!property) return { properties: [], postcode: null, stats: null };

    const properties = await this.prisma.property.findMany({
      where: { postcode: property.postcode, id: { not: propertyId } },
      take: 10,
      select: {
        id: true,
        addressLine1: true,
        postcode: true,
        propertyType: true,
        bedrooms: true,
        epcRating: true,
        estimatedPrice: true,
        passports: {
          where: { type: 'SELLER' },
          select: { id: true, status: true },
        },
      },
    });

    const mapped = properties.map((p) => {
      const passport = (p as any).passports?.[0] ?? null;
      return {
        id: p.id,
        addressLine1: p.addressLine1,
        propertyType: p.propertyType,
        bedrooms: p.bedrooms,
        epcRating: p.epcRating,
        price: p.estimatedPrice,
        hasPassport: !!passport,
        isPublished: passport?.status === 'PUBLISHED',
        passportStatus: passport?.status ?? null,
      };
    });

    const published = mapped.filter(p => p.isPublished).length;
    const started = mapped.filter(p => p.hasPassport).length;
    const notStarted = mapped.filter(p => !p.hasPassport).length;

    const epcRatings = mapped.map(p => p.epcRating).filter(Boolean) as string[];
    const avgEpc = epcRatings.length
      ? epcRatings.sort()[Math.floor(epcRatings.length / 2)]
      : null;

    const prices = mapped.map(p => p.price).filter(Boolean) as number[];
    const avgPrice = prices.length
      ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length)
      : null;

    return {
      postcode: property.postcode,
      properties: mapped,
      stats: { published, started, notStarted, avgEpc, avgPrice },
    };
  }

  // ── Matched buyers ─────────────────────────────────────────────────────────

  async getMatchedBuyers(propertyId: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { estimatedPrice: true, propertyType: true, bedrooms: true, postcode: true },
    });
    if (!property) return { buyers: [], total: 0 };

    const prefs = await this.prisma.userPreference.findMany({
      where: { budgetMax: { not: null } },
      take: 30,
      select: {
        budgetMin: true,
        budgetMax: true,
        propertyTypes: true,
        buyingTimeline: true,
        importantFeatures: true,
        user: { select: { firstName: true, lastName: true, postcode: true } },
      },
    });

    const price = property.estimatedPrice ?? 250000;

    const scored = prefs
      .filter(p => p.user.firstName)
      .map(p => {
        const bMax = p.budgetMax ?? 0;
        const bMin = p.budgetMin ?? 0;
        const budgetScore =
          price <= bMax * 1.05 && price >= bMin * 0.9 ? 95 :
          price <= bMax * 1.15 ? 70 : 30;

        const types = (p.propertyTypes as string[] | null) ?? [];
        const typeScore =
          types.length === 0 || types.includes(property.propertyType ?? '') ? 85 : 45;

        const matchScore = Math.round(budgetScore * 0.6 + typeScore * 0.4);

        const firstName = p.user.firstName ?? 'Buyer';
        const lastInit = p.user.lastName ? p.user.lastName[0] + '.' : '';
        const area = p.user.postcode?.split(' ')[0] ?? 'Local area';

        const tlMap: Record<string, string> = {
          asap: 'Ready to buy now',
          '3months': 'Buying within 3 months',
          '6months': 'Buying within 6 months',
          '12months': 'Planning ahead',
        };

        const tags: string[] = [
          matchScore >= 75 ? 'Strong match' : matchScore >= 55 ? 'Good match' : 'Possible match',
        ];
        if (p.buyingTimeline === 'asap' || p.buyingTimeline === '3months') {
          tags.push('Active buyer');
        }
        if (types.length > 0 && types.includes(property.propertyType ?? '')) {
          tags.push('Type match');
        }

        return {
          name: `${firstName} ${lastInit}`.trim(),
          area,
          budget: bMax ? `Up to £${Math.round(bMax / 1000)}k` : 'Flexible',
          timeline: tlMap[p.buyingTimeline ?? ''] ?? 'Flexible timeline',
          matchScore,
          tags,
        };
      })
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 8);

    return { buyers: scored, total: prefs.length };
  }

  // ── Property search log (anonymous interest counter) ─────────────────────────

  async logPropertySearch(
    propertyId: string,
    userId: string | null,
    sessionId: string | null,
  ): Promise<{ logged: boolean }> {
    // Verify property exists — quietly ignore if not (route may be hit during
    // navigation flickers).
    const exists = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true },
    });
    if (!exists) return { logged: false };

    // Best-effort dedup: if the same userId or sessionId logged this property
    // within the past hour, skip another log.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (userId || sessionId) {
      const recent = await this.prisma.propertySearchLog.findFirst({
        where: {
          propertyId,
          createdAt: { gte: oneHourAgo },
          ...(userId
            ? { userId }
            : sessionId
              ? { sessionId }
              : {}),
        },
        select: { id: true },
      });
      if (recent) return { logged: false };
    }

    await this.prisma.propertySearchLog.create({
      data: {
        propertyId,
        userId: userId ?? null,
        sessionId: sessionId ?? null,
      },
    });
    return { logged: true };
  }

  /**
   * Where does this property sit on its street, ranked by annual energy cost?
   * Powers the "Nth of M on street" + "best on street £X/yr" copy on the
   * buyer-results screen. Uses each neighbour's enriched EPC cost fields
   * (heating + hot water + lighting) — only properties with real cost data
   * on file are counted, so the rank reflects comparable data, not noise.
   *
   * Returns rank / total / bestCost / averageCost. If we don't have at
   * least 3 cost-enriched neighbours yet, returns null fields so the UI
   * can hide the row gracefully.
   */
  async getStreetEnergyRank(propertyId: string): Promise<{
    rank: number | null;
    total: number;
    bestCost: number | null;
    averageCost: number | null;
    yourCost: number | null;
    yourEpcRating: string | null;
    epcDistribution: { letter: string; count: number }[];
    avgEpcScore: number | null;
    neighbours: {
      label: string;
      cost: number;
      epcRating: string | null;
      isYou: boolean;
    }[];
  }> {
    const self: any = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        id: true,
        postcode: true,
        epcRating: true,
        heatingCostCurrent: true,
        hotWaterCostCurrent: true,
        lightingCostCurrent: true,
      } as any,
    });
    if (!self) {
      return {
        rank: null,
        total: 0,
        bestCost: null,
        averageCost: null,
        yourCost: null,
        yourEpcRating: null,
        epcDistribution: [],
        avgEpcScore: null,
        neighbours: [],
      };
    }

    const outcode = (self.postcode || '').split(' ')[0] || '';
    if (!outcode) {
      return {
        rank: null,
        total: 0,
        bestCost: null,
        averageCost: null,
        yourCost: null,
        yourEpcRating: self.epcRating ?? null,
        epcDistribution: [],
        avgEpcScore: null,
        neighbours: [],
      };
    }

    const yourCost =
      Number(self.heatingCostCurrent ?? 0) +
      Number(self.hotWaterCostCurrent ?? 0) +
      Number(self.lightingCostCurrent ?? 0);

    const neighbours: any[] = await this.prisma.property.findMany({
      where: {
        postcode: { startsWith: outcode },
        OR: [
          { heatingCostCurrent: { not: null } },
          { hotWaterCostCurrent: { not: null } },
          { lightingCostCurrent: { not: null } },
        ],
      },
      select: {
        id: true,
        addressLine1: true,
        epcRating: true,
        epcScore: true,
        heatingCostCurrent: true,
        hotWaterCostCurrent: true,
        lightingCostCurrent: true,
      } as any,
      take: 500,
    });

    // EPC letter distribution across the same outcode (includes self).
    const epcCounts: Record<string, number> = {};
    let epcScoreSum = 0;
    let epcScoreN = 0;
    for (const n of neighbours) {
      const letter = (n.epcRating || '').toString().toUpperCase().trim();
      if (letter && letter.length === 1 && 'ABCDEFG'.includes(letter)) {
        epcCounts[letter] = (epcCounts[letter] || 0) + 1;
      }
      if (n.epcScore && Number(n.epcScore) > 0) {
        epcScoreSum += Number(n.epcScore);
        epcScoreN += 1;
      }
    }
    const epcDistribution = Object.entries(epcCounts)
      .map(([letter, count]) => ({ letter, count }))
      .sort((a, b) => a.letter.localeCompare(b.letter));
    const avgEpcScore = epcScoreN > 0 ? Math.round(epcScoreSum / epcScoreN) : null;

    // Short street-label from an address line, e.g. "9, Woodfield Road" → "No. 9".
    const shortLabel = (addr: string | null, isSelf: boolean): string => {
      if (isSelf) return 'You';
      const m = (addr || '').match(/^(\d+[A-Za-z]?)/);
      return m ? `No. ${m[1]}` : (addr || 'Neighbour').split(',')[0].slice(0, 10);
    };

    // Total annual cost per home; drop zero-cost rows (missing data).
    const ranked = neighbours
      .map((n) => ({
        id: n.id as string,
        addressLine1: (n as any).addressLine1 as string | null,
        epcRating: n.epcRating as string | null,
        cost:
          Number(n.heatingCostCurrent ?? 0) +
          Number(n.hotWaterCostCurrent ?? 0) +
          Number(n.lightingCostCurrent ?? 0),
      }))
      .filter((r) => r.cost > 0)
      .sort((a, b) => a.cost - b.cost); // ascending = cheapest first

    // Per-neighbour list for the Street tab bars. Caps at 12 so the chart
    // stays readable; always keeps the user's own row in.
    const buildNeighbourList = () => {
      const selfRow = ranked.find((r) => r.id === self.id);
      const others = ranked.filter((r) => r.id !== self.id).slice(0, 11);
      const list = selfRow ? [selfRow, ...others] : others;
      return list
        .sort((a, b) => a.cost - b.cost)
        .map((r) => ({
          label: shortLabel(r.addressLine1, r.id === self.id),
          cost: Math.round(r.cost),
          epcRating: r.epcRating ?? null,
          isYou: r.id === self.id,
        }));
    };

    if (ranked.length < 3) {
      return {
        rank: null,
        total: ranked.length,
        bestCost: null,
        averageCost: null,
        yourCost: yourCost > 0 ? Math.round(yourCost) : null,
        yourEpcRating: self.epcRating ?? null,
        epcDistribution,
        avgEpcScore,
        neighbours: buildNeighbourList(),
      };
    }

    const total = ranked.length;
    const bestCost = Math.round(ranked[0].cost);
    const averageCost = Math.round(
      ranked.reduce((s, r) => s + r.cost, 0) / total,
    );

    // 1-indexed rank where 1 = cheapest. If we don't have own cost on file,
    // rank is null but the rest of the figures still useful.
    let rank: number | null = null;
    if (yourCost > 0) {
      const idx = ranked.findIndex((r) => r.id === self.id);
      rank = idx >= 0 ? idx + 1 : null;
    }

    return {
      rank,
      total,
      bestCost,
      averageCost,
      yourCost: yourCost > 0 ? Math.round(yourCost) : null,
      yourEpcRating: self.epcRating ?? null,
      epcDistribution,
      avgEpcScore,
      neighbours: buildNeighbourList(),
    };
  }

  async getPropertySearchStats(propertyId: string) {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [
      today,
      thisMonth,
      allTime,
      distinctSessions,
      distinctUsers,
      wishlistCount,
      savedCount,
    ] = await Promise.all([
      this.prisma.propertySearchLog.count({
        where: { propertyId, createdAt: { gte: startOfDay } },
      }),
      this.prisma.propertySearchLog.count({
        where: { propertyId, createdAt: { gte: startOfMonth } },
      }),
      this.prisma.propertySearchLog.count({ where: { propertyId } }),
      this.prisma.propertySearchLog.findMany({
        where: { propertyId, sessionId: { not: null } },
        select: { sessionId: true },
        distinct: ['sessionId'],
      }),
      this.prisma.propertySearchLog.findMany({
        where: { propertyId, userId: { not: null } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      // Watchers = users who have this property on a list. Wishlist
      // (❤️) and SavedProperty (🔖) are both treated as "watching" — they
      // represent distinct UI affordances but the same intent ("notify
      // me when this updates"), so we sum them.
      this.prisma.userWishlist.count({ where: { propertyId } }),
      this.prisma.userSavedProperty.count({ where: { propertyId } }),
    ]);

    const distinctVisitors =
      (distinctSessions?.length ?? 0) + (distinctUsers?.length ?? 0);

    return {
      today,
      thisMonth,
      allTime,
      distinctVisitors,
      watchers: wishlistCount + savedCount,
    };
  }

  // ── EPC Download proxy ───────────────────────────────────────────────────────

  async getEpcDownloadInfo(propertyId: string): Promise<{ certUrl: string; lmkKey: string } | null> {
    const property = await this.prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) return null;

    // The consumer-facing cert URL every UK portal now uses. The old
    // opendatacommunities.org/files/{lmk} host was retired with the EPC
    // API migration — no PDF endpoint on the new API — so we hand the
    // user off to find-energy-certificate.service.gov.uk which serves
    // the cert HTML with its own print / download flow.
    const certUrlFor = (lmk: string) =>
      `https://find-energy-certificate.service.gov.uk/energy-certificate/${lmk}`;

    // 1. Prefer the persisted LMK key on the property row. Cheapest
    //    path, avoids an EPC API round-trip, and works even when the
    //    EPC API is throttled.
    const persisted = (property as any).epcLmkKey as string | null | undefined;
    if (persisted) return { lmkKey: persisted, certUrl: certUrlFor(persisted) };

    // 2. UPRN lookup — most precise. Uses fetchEpcJson so the new-API
    //    { data: [ { certificateNumber } ] } shape is converted to the
    //    legacy { rows: [ { 'lmk-key' } ] } shape the rest of the code
    //    expects.
    if (property.uprn) {
      const data = await fetchEpcJson<{ rows: EpcRow[] }>(
        `/api/domestic/search?uprn=${encodeURIComponent(property.uprn)}&size=1`,
      );
      const lmk = (data?.rows?.[0] as any)?.['lmk-key'] as string | undefined;
      if (lmk) return { lmkKey: lmk, certUrl: certUrlFor(lmk) };
    }

    // 3. Address fallback — postcode search + best-match against the
    //    property's addressLine1. Handles rows where UPRN is missing or
    //    doesn't match any EPC record (common for older certs).
    if (property.postcode && property.addressLine1) {
      const cert = await this.fetchEpcDataByAddress(
        property.postcode,
        property.addressLine1,
      );
      if (cert?.lmkKey) {
        // Persist the newly-discovered key so future clicks hit the
        // fast path in step 1 without re-fetching.
        try {
          await this.prisma.property.update({
            where: { id: propertyId },
            data: { epcLmkKey: cert.lmkKey },
          });
        } catch {
          /* non-critical */
        }
        return { lmkKey: cert.lmkKey, certUrl: certUrlFor(cert.lmkKey) };
      }
    }

    return null;
  }
}
