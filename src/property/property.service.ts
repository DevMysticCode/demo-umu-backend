import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PassportService } from '../passport/passport.service';
import { Property } from '@prisma/client';

// ── EPC API helpers ──────────────────────────────────────────────────────────

function epcAuthHeader(): string {
  const email = process.env.EPC_EMAIL ?? '';
  const key = process.env.EPC_API_KEY ?? '';
  return `Basic ${Buffer.from(`${email}:${key}`).toString('base64')}`;
}

interface EpcRow {
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
  'transaction-type'?: string;
  'lodgement-date'?: string;
  'council-tax-band'?: string;
  'potential-energy-rating'?: string;
  'potential-energy-efficiency'?: number | string;
  'local-authority-label'?: string;
  // HomeScore V2 cost fields
  'heating-cost-current'?: number | string;
  'hot-water-cost-current'?: number | string;
  'lighting-cost-current'?: number | string;
  // HomeScore V2 insulation fields
  'walls-energy-eff'?: string;
  'roof-energy-eff'?: string;
  'floor-energy-eff'?: string;
  'floor-description'?: string;
  'windows-energy-eff'?: string;
  'glazed-area'?: string;
  'multi-glaze-proportion'?: number | string;
  // HomeScore V2 heating fields
  'mainheat-energy-eff'?: string;
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
    addressLine1: address1.trim(),
    addressLine2: address2.trim() || null,
    city: town.trim() || null,
    county: county.trim() || null,
    postcode: postcode.trim(),
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
    councilTaxBand: row['council-tax-band'] ?? null,
    epcEnrichedAt: new Date(),
  };
}

// ── EpcCert type + builder (all fields used by HomeScore V2) ─────────────────

interface EpcCert {
  certUrl: string | null;
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
  // HomeScore V2 insulation
  wallsEnergyEff: string | null;
  roofEnergyEff: string | null;
  floorEnergyEff: string | null;
  floorDescription: string | null;
  windowsEnergyEff: string | null;
  glazedArea: string | null;
  multiGlazeProportion: number | null;
  // HomeScore V2 heating
  mainheatEnergyEff: string | null;
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
    // Cost
    heatingCostCurrent: parseFloat2(row['heating-cost-current']),
    hotWaterCostCurrent: parseFloat2(row['hot-water-cost-current']),
    lightingCostCurrent: parseFloat2(row['lighting-cost-current']),
    // Insulation
    wallsEnergyEff: str(row['walls-energy-eff']),
    roofEnergyEff: str(row['roof-energy-eff']),
    floorEnergyEff: str(row['floor-energy-eff']),
    floorDescription: str(row['floor-description']),
    windowsEnergyEff: str(row['windows-energy-eff']),
    glazedArea: str(row['glazed-area']),
    multiGlazeProportion: parseFloat2(row['multi-glaze-proportion']),
    // Heating
    mainheatEnergyEff: str(row['mainheat-energy-eff']),
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

// ── Fallback mock data (used when EPC API returns no results) ─────────────────

const STREET_NAMES = [
  'High Street',
  'Maple Road',
  'Oak Avenue',
  'Church Lane',
  'Victoria Road',
  'Station Road',
  'Park Avenue',
  'The Green',
  'Mill Lane',
  'Woodland Drive',
];
const PROPERTY_TYPES = ['Detached', 'Semi-Detached', 'Terraced', 'Flat'];
const TENURES = ['Freehold', 'Leasehold'];
const EPC_RATINGS = ['A', 'B', 'C', 'D', 'E'];
const PEXELS_IMAGES = [
  'https://images.pexels.com/photos/106399/pexels-photo-106399.jpeg?auto=compress&cs=tinysrgb&w=800',
  'https://images.pexels.com/photos/1350789/pexels-photo-1350789.jpeg?auto=compress&cs=tinysrgb&w=800',
  'https://images.pexels.com/photos/1457842/pexels-photo-1457842.jpeg?auto=compress&cs=tinysrgb&w=800',
  'https://images.pexels.com/photos/1643387/pexels-photo-1643387.jpeg?auto=compress&cs=tinysrgb&w=800',
  'https://images.pexels.com/photos/1568605/pexels-photo-1568605.jpeg?auto=compress&cs=tinysrgb&w=800',
  'https://images.pexels.com/photos/1732414/pexels-photo-1732414.jpeg?auto=compress&cs=tinysrgb&w=800',
];

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
  ) {}

  async searchProperties(
    query: string,
    offset = 0,
    limit = 10,
  ): Promise<{ items: Property[]; total: number }> {
    const q = query.trim();

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

    if (cachedTotal > 0) {
      const rows = await this.prisma.property.findMany({
        where: realDataCacheWhere,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          passport: {
            select: {
              id: true,
              status: true,
              sections: {
                select: {
                  tasks: { select: { status: true } },
                },
              },
            },
          },
        },
      });
      const items = rows.map(({ passport, ...p }) => {
        const isPublished = passport?.status === 'PUBLISHED';
        // Compute completion % from tasks
        let passportCompletion: number | null = null;
        if (passport && isPublished) {
          const allTasks = passport.sections.flatMap((s) => s.tasks);
          const done = allTasks.filter((t) => t.status === 'COMPLETED').length;
          passportCompletion =
            allTasks.length > 0 ? Math.round((done / allTasks.length) * 100) : 0;
        }
        return {
          ...p,
          hasPassport: !!passport,
          passportPublished: isPublished,
          passportCompletion,
        };
      });
      return { items, total: cachedTotal };
    }

    // 2. No real data cached — try OS Places API first
    const osResult = await this.fetchFromOsPlaces(q, offset, limit);
    if (osResult.total > 0) return osResult;

    // 3. OS returned nothing — call EPC API (also upserts results into DB)
    const epcResult = await this.fetchFromEpc(q, offset, limit);
    if (epcResult.total > 0) return epcResult;

    // 4. EPC returned nothing — fall back to any existing mock data for this postcode
    const mockWhere = {
      AND: [searchCondition, { udprn: { startsWith: 'MOCK-' } }],
    };
    const mockTotal = await this.prisma.property.count({ where: mockWhere });
    if (mockTotal > 0) {
      const items = await this.prisma.property.findMany({
        where: mockWhere,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      });
      return { items, total: mockTotal };
    }

    // 5. Nothing at all — generate mocks as last resort (offset 0 only)
    if (offset === 0) {
      let postcodeInfo: {
        latitude: number;
        longitude: number;
        postcode: string;
      } | null = null;
      try {
        const clean = q.replace(/\s/g, '').toUpperCase();
        const res = await fetch(`https://api.postcodes.io/postcodes/${clean}`);
        if (res.ok) {
          const data = await res.json();
          postcodeInfo = data.result;
        }
      } catch {
        /* ignore */
      }

      if (!postcodeInfo) {
        try {
          const res = await fetch(
            `https://api.postcodes.io/postcodes?q=${encodeURIComponent(q)}&limit=1`,
          );
          if (res.ok) {
            const data = await res.json();
            if (data.result?.length > 0) postcodeInfo = data.result[0];
          }
        } catch {
          /* ignore */
        }
      }

      const mocks = await this.generateAndSaveMockProperties(q, postcodeInfo);
      return { items: mocks, total: mocks.length };
    }

    return { items: [], total: 0 };
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
      if (!res.ok) return { items: [], total: 0 };

      const data = await res.json();
      const results: any[] = data.results ?? [];
      const total: number = data.header?.totalresults ?? results.length;

      // Filter to residential dwellings only
      const residential = results.filter((r) =>
        r.DPA?.CLASSIFICATION_CODE?.startsWith('RD'),
      );
      if (residential.length === 0) return { items: [], total: 0 };

      const titleCase = (str: string) =>
        (str ?? '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

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

        const addressLine1 = dpa.BUILDING_NAME
          ? dpa.BUILDING_NAME
          : `${dpa.BUILDING_NUMBER ?? ''} ${dpa.THOROUGHFARE_NAME ?? ''}`.trim();

        // Use Google Street View for a real property photo
        const googleKey = process.env.GOOGLE_API_KEY ?? '';
        const imageUrl = googleKey
          ? `https://maps.googleapis.com/maps/api/streetview?size=800x500&location=${coords.lat},${coords.lon}&key=${googleKey}&fov=90&pitch=5&radius=200&source=outdoor&return_error_codes=true`
          : PEXELS_IMAGES[(offset + i) % PEXELS_IMAGES.length];

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

      return { items: saved, total };
    } catch (err) {
      console.error('OS Places API error:', err);
      return { items: [], total: 0 };
    }
  }

  private async fetchFromEpc(
    query: string,
    offset = 0,
    limit = 10,
  ): Promise<{ items: Property[]; total: number }> {
    try {
      const clean = query.replace(/\s/g, '').toUpperCase();
      const url = `https://epc.opendatacommunities.org/api/v1/domestic/search?postcode=${encodeURIComponent(query)}&size=${limit}&from=${offset}`;

      const res = await fetch(url, {
        headers: {
          Authorization: epcAuthHeader(),
          Accept: 'application/json',
        },
      });

      if (!res.ok) return { items: [], total: 0 };
      const data = await res.json();
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
        const imgIndex = globalIndex % PEXELS_IMAGES.length;

        try {
          const prop = await this.prisma.property.upsert({
            where: { udprn },
            update: {
              epcRating: mapped.epcRating,
              epcScore: mapped.epcScore,
              floorAreaSqm: mapped.floorAreaSqm,
              heatingType: mapped.heatingType,
              co2Emissions: mapped.co2Emissions,
              ...(mapped.councilTaxBand
                ? { councilTaxBand: mapped.councilTaxBand }
                : {}),
              epcEnrichedAt: new Date(),
            },
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
              propertyType: mapped.propertyType,
              bedrooms: mapped.bedrooms,
              sqft: mapped.sqft,
              floorAreaSqm: mapped.floorAreaSqm,
              epcRating: mapped.epcRating,
              epcScore: mapped.epcScore,
              tenure: mapped.tenure,
              yearBuilt: mapped.yearBuilt,
              heatingType: mapped.heatingType,
              co2Emissions: mapped.co2Emissions,
              councilTaxBand: mapped.councilTaxBand,
              estimatedPrice,
              imageUrl: PEXELS_IMAGES[imgIndex],
              epcEnrichedAt: new Date(),
            },
          });
          saved.push(prop);
        } catch {
          /* skip constraint violations */
        }
      }

      return { items: saved, total: epcTotal };
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
    // If all basic AND V2 cost fields are present, return as-is
    if (
      property.epcRating &&
      property.floorAreaSqm &&
      property.tenure &&
      property.yearBuilt &&
      property.titleNumber &&
      (property as any).heatingCostCurrent != null
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

      // V2 EPC insulation/fabric fields
      if (!(property as any).wallsEnergyEff && epcData.wallsEnergyEff)
        updateData.wallsEnergyEff = epcData.wallsEnergyEff;
      if (!(property as any).roofEnergyEff && epcData.roofEnergyEff)
        updateData.roofEnergyEff = epcData.roofEnergyEff;
      if (!(property as any).floorEnergyEff && epcData.floorEnergyEff)
        updateData.floorEnergyEff = epcData.floorEnergyEff;
      if (!(property as any).windowsEnergyEff && epcData.windowsEnergyEff)
        updateData.windowsEnergyEff = epcData.windowsEnergyEff;
      if ((property as any).multiGlazeProportion == null && epcData.multiGlazeProportion != null)
        updateData.multiGlazeProportion = epcData.multiGlazeProportion;

      // V2 EPC heating/HW fields
      if (!(property as any).mainheatEnergyEff && epcData.mainheatEnergyEff)
        updateData.mainheatEnergyEff = epcData.mainheatEnergyEff;
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

      // Generate titleNumber if missing
      if (!property.titleNumber) {
        updateData.titleNumber = this.generateTitleNumber(property);
      }

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

    // Generate titleNumber even if no EPC data found
    if (!property.titleNumber) {
      const titleNumber = this.generateTitleNumber(property);
      console.log(
        `[Enrich] Generating titleNumber for property: ${titleNumber}`,
      );
      try {
        const updated = await this.prisma.property.update({
          where: { id: property.id },
          data: { titleNumber },
        });
        return updated;
      } catch (error) {
        console.error(`[Enrich] Failed to update titleNumber: ${error}`);
        return { ...property, titleNumber };
      }
    }

    console.log(`[Enrich] Returning property without any updates`);
    return property;
  }

  /**
   * Generate a meaningful titleNumber for properties that don't have one.
   * Format: Postcode (2 chars) + UPRN (6 chars) or Postcode + hash
   */
  private generateTitleNumber(property: Property): string {
    const postcode =
      property.postcode?.replace(/\s/g, '').substring(0, 2) ?? 'XX';
    if (property.uprn) {
      const uprnEnd = property.uprn
        .toString()
        .replace(/\D/g, '')
        .slice(-6)
        .padStart(6, '0');
      return `${postcode}${uprnEnd}`;
    }
    // Fallback: use property ID hash
    const hash =
      property.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) %
      1000000;
    return `${postcode}${hash.toString().padStart(6, '0')}`;
  }

  async getPropertyById(id: string): Promise<Property | null> {
    const property = await this.prisma.property.findUnique({ where: { id } });
    if (!property) return null;

    // Enrich with EPC data if fields are missing (non-blocking, always returns a property)
    return this.enrichPropertyWithEpc(property);
  }

  // ── Enrichment (on-demand, not stored) ────────────────────────────────────

  async getPropertyEnrichment(propertyId: string) {
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
    ]);

    const googleKey = process.env.GOOGLE_API_KEY ?? '';
    const streetViewUrl =
      lat && lon && googleKey
        ? `https://maps.googleapis.com/maps/api/streetview?size=800x500&location=${lat},${lon}&key=${googleKey}&fov=90&pitch=10&radius=200&source=outdoor&return_error_codes=true`
        : null;

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
            // Generate titleNumber if missing
            ...(epc.uprn && !property.titleNumber
              ? {
                  titleNumber: `${property.postcode?.replace(/\s/g, '').substring(0, 2) ?? 'XX'}${epc.uprn.toString().replace(/\D/g, '').slice(-6).padStart(6, '0')}`,
                }
              : {}),
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
    } else if (!property.titleNumber && (property.uprn || property.postcode)) {
      // Ensure titleNumber is generated even if no EPC data
      const postcode =
        property.postcode?.replace(/\s/g, '').substring(0, 2) ?? 'XX';
      const uprn = property.uprn
        ?.toString()
        .replace(/\D/g, '')
        .slice(-6)
        .padStart(6, '0');
      const titleNumber = uprn
        ? `${postcode}${uprn}`
        : `${postcode}${property.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 1000000}`;
      this.prisma.property
        .update({
          where: { id: propertyId },
          data: { titleNumber },
        })
        .catch(() => {
          /* non-critical */
        });
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

      // OS NGD + Overpass: schools (categorised), trains, bus stops, parks, airports
      nearby:
        nearby.status === 'fulfilled'
          ? nearby.value
          : { schools: [], trains: [], busStops: [], parks: [], airports: [] },

      // Environment Agency Flood Risk API
      floodRisk: floodData?.rating ?? null,
      floodZones: floodData?.zones ?? [],

      // HM Land Registry Price Paid — local DB query
      salesHistory:
        salesHistory.status === 'fulfilled'
          ? salesHistory.value
          : { thisProperty: [], nearbySales: [] },

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

      // planning.data.gov.uk — constraints + applications
      planningHistory: planning,

      // HMLR INSPIRE Index Polygons — registered title boundary (GeoJSON)
      titleBoundary:
        titleBoundary.status === 'fulfilled' ? titleBoundary.value : null,
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
    const schoolsPromise = osKey
      ? fetch(
          `https://api.os.uk/features/ngd/ofa/v1/collections/lus-fts-site-2/items?bbox=${bbox}&filter=oslandusetiera%3D'Education'&limit=25&key=${osKey}`,
        )
          .then((r) => r.json())
          .catch(() => ({ features: [] }))
      : Promise.resolve({ features: [] });

    // ── Overpass: trains, bus stops, parks, airports + heritage (single request to avoid rate limit) ──
    const overpassQuery = `[out:json][timeout:25];(
      node["railway"="station"](around:4000,${lat},${lon});
      node["railway"="halt"](around:4000,${lat},${lon});
      node["highway"="bus_stop"](around:700,${lat},${lon});
      way["leisure"="park"]["name"](around:2000,${lat},${lon});
      node["aeroway"="aerodrome"](around:50000,${lat},${lon});
      way["aeroway"="aerodrome"](around:50000,${lat},${lon});
      node["heritage"](around:800,${lat},${lon});
      node["historic"](around:800,${lat},${lon});
      way["historic"](around:800,${lat},${lon});
      way["heritage"](around:800,${lat},${lon});
    );out center body;`;

    // Retry up to 2 times with 3s delay — Overpass rate-limits to 2 concurrent slots
    const fetchOverpass = async (attempt = 0): Promise<{ elements: any[] }> => {
      try {
        const res = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(overpassQuery)}`,
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data.elements)) throw new Error('bad response');
        return data;
      } catch (err) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 3000 + attempt * 2000));
          return fetchOverpass(attempt + 1);
        }
        return { elements: [] };
      }
    };
    const overpassPromise = fetchOverpass();

    const [schoolsRaw, overpassRaw] = await Promise.all([
      schoolsPromise,
      overpassPromise,
    ]);

    // ── Process schools from OS NGD ──
    const schools = ((schoolsRaw.features ?? []) as any[])
      .filter((f: any) => f.properties?.name1_text)
      .map((f: any) => {
        const [flon, flat] = centroid(f.geometry);
        const p = f.properties;
        return {
          name: p.name1_text as string,
          category: (p.oslandusetierb?.[0] ??
            p.description ??
            'School') as string,
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

    const airports = elements
      .filter((e) => e.tags?.aeroway === 'aerodrome' && e.tags?.name)
      // Only commercial/public airports: must have an IATA code or "Airport" in name
      .filter((e) => e.tags?.iata || /airport/i.test(e.tags?.name ?? ''))
      .map((e) => ({
        name: e.tags.name as string,
        iata: e.tags?.iata ?? null,
        icao: e.tags?.icao ?? null,
        lat: e.center?.lat ?? e.lat,
        lon: e.center?.lon ?? e.lon,
        distanceKm: distKm(e.center?.lat ?? e.lat, e.center?.lon ?? e.lon),
      }))
      .filter((e) => e.lat && e.lon)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 5);

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

    return { schools, trains, busStops, parks, airports, listedBuildings };
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
    const key = process.env.OFCOM_API_KEY;
    if (!key) return null;
    try {
      const clean = postcode.replace(/\s/g, '').toUpperCase();
      // Ofcom API — register free at api.ofcom.org.uk, key passed as Ocp-Apim-Subscription-Key
      const url = `https://api-proxy.ofcom.org.uk/broadband/coverage/${encodeURIComponent(clean)}`;
      const res = await fetch(url, {
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      // Response is an array of premises (one per address in postcode)
      const premises = Array.isArray(data)
        ? data[0]
        : (data?.value?.[0] ?? data ?? null);
      if (!premises) return null;
      return {
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
    } catch {
      return null;
    }
  }

  private async fetchMobileSignal(postcode: string): Promise<any> {
    const key = process.env.OFCOM_API_KEY;
    if (!key) return null;
    try {
      const clean = postcode.replace(/\s/g, '').toUpperCase();
      // Ofcom API mobile endpoint
      const url = `https://api-proxy.ofcom.org.uk/mobile/coverage/${encodeURIComponent(clean)}`;
      const res = await fetch(url, {
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const row = Array.isArray(data)
        ? data[0]
        : (data?.value?.[0] ?? data ?? null);
      if (!row) return null;

      // Ofcom field naming varies — handle both camelCase and PascalCase
      const get = (a: string, b: string) => row[a] ?? row[b] ?? null;

      return {
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
    } catch {
      return null;
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
    try {
      const url = `https://epc.opendatacommunities.org/api/v1/domestic/search?postcode=${encodeURIComponent(postcode)}&size=10`;
      const res = await fetch(url, {
        headers: { Authorization: epcAuthHeader(), Accept: 'application/json' },
      });
      if (!res.ok) {
        console.log(`[EPC] API error for postcode ${postcode}: ${res.status}`);
        return null;
      }
      const data = await res.json();
      const rows: any[] = data.rows ?? [];
      console.log(
        `[EPC] Found ${rows.length} results for postcode ${postcode}, searching for address: ${addressLine1}`,
      );
      if (!rows.length) return null;

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
    } catch (error) {
      console.error(`[EPC] Error fetching data for ${postcode}/${addressLine1}:`, error);
      return null;
    }
  }

  private async fetchEpcData(uprn: string): Promise<EpcCert | null> {
    try {
      const url = `https://epc.opendatacommunities.org/api/v1/domestic/search?uprn=${uprn}&size=1`;
      const res = await fetch(url, {
        headers: { Authorization: epcAuthHeader(), Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const row = data.rows?.[0];
      if (!row) return null;
      return epcRowToCert(row);
    } catch {
      return null;
    }
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
      const url = `https://epc.opendatacommunities.org/api/v1/domestic/search?postcode=${encodeURIComponent(postcode)}&size=25`;
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

  // ── Passport status ────────────────────────────────────────────────────────

  async getPassportStatus(propertyId: string, userId: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      include: {
        passport: {
          select: {
            id: true,
            ownerId: true,
            status: true,
            collaborators: { where: { userId }, select: { id: true } },
            buyerAccesses: { where: { userId }, select: { id: true } },
          },
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

    if (!property.passport) {
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

    const passport = property.passport;
    const isOwner = passport.ownerId === userId;
    const isCollaborator = passport.collaborators.length > 0;
    const isBuyer =
      !isOwner && !isCollaborator && (passport.buyerAccesses?.length ?? 0) > 0;
    const isPublished = passport.status === 'PUBLISHED';

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
    };
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

    const { passportId } = await this.passportService.createPassport(
      userId,
      property.addressLine1,
      property.postcode,
      property.id,
    );

    await this.prisma.ownershipVerification.update({
      where: { propertyId_userId: { propertyId, userId } },
      data: { passportId },
    });

    return { passportId };
  }

  private async generateAndSaveMockProperties(
    query: string,
    postcodeInfo: {
      latitude: number;
      longitude: number;
      postcode: string;
    } | null,
  ): Promise<Property[]> {
    const areaInfo = getAreaInfo(query);
    const lat = postcodeInfo?.latitude ?? areaInfo.lat;
    const lon = postcodeInfo?.longitude ?? areaInfo.lon;
    const basePostcode = postcodeInfo?.postcode ?? query.toUpperCase();

    const count = 5;
    const created: Property[] = [];

    for (let i = 0; i < count; i++) {
      const seed = basePostcode.charCodeAt(0) * 100 + i * 37;
      const streetIndex = Math.floor(seededRandom(seed) * STREET_NAMES.length);
      const houseNumber = Math.floor(seededRandom(seed + 1) * 120) + 1;
      const typeIndex = Math.floor(
        seededRandom(seed + 2) * PROPERTY_TYPES.length,
      );
      const tenureIndex = Math.floor(seededRandom(seed + 3) * TENURES.length);
      const epcIndex = Math.floor(seededRandom(seed + 4) * EPC_RATINGS.length);
      const imgIndex = i % PEXELS_IMAGES.length;
      const propType = PROPERTY_TYPES[typeIndex];
      const bedrooms =
        propType === 'Flat'
          ? Math.floor(seededRandom(seed + 5) * 2) + 1
          : Math.floor(seededRandom(seed + 5) * 3) + 2;
      const sqft = bedrooms * 300 + Math.floor(seededRandom(seed + 6) * 400);
      const priceVariance = 0.8 + seededRandom(seed + 7) * 0.8;
      const price = Math.round(areaInfo.basePricek * priceVariance) * 1000;
      const yearBuilt = 1960 + Math.floor(seededRandom(seed + 8) * 64);
      const addressLine1 = `${houseNumber}, ${STREET_NAMES[streetIndex]}`;
      const udprn = `MOCK-${basePostcode.replace(/\s/g, '')}-${i}`;
      const jLat = lat + (seededRandom(seed + 9) - 0.5) * 0.01;
      const jLon = lon + (seededRandom(seed + 10) - 0.5) * 0.01;

      try {
        const prop = await this.prisma.property.upsert({
          where: { udprn },
          update: {},
          create: {
            udprn,
            addressLine1,
            city: areaInfo.city,
            county: areaInfo.county,
            postcode: basePostcode,
            latitude: jLat,
            longitude: jLon,
            propertyType: propType,
            bedrooms,
            sqft,
            epcRating: EPC_RATINGS[epcIndex],
            tenure: TENURES[tenureIndex],
            yearBuilt,
            estimatedPrice: price,
            imageUrl: PEXELS_IMAGES[imgIndex],
            titleNumber: `${basePostcode.replace(/\s/g, '').substring(0, 2)}${100000 + Math.floor(seededRandom(seed + 11) * 900000)}`,
          },
        });
        created.push(prop);
      } catch {
        /* skip */
      }
    }

    if (created.length === 0) {
      return this.prisma.property.findMany({
        where: { postcode: { contains: query, mode: 'insensitive' } },
        take: 10,
      });
    }

    return created;
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
      const url = `https://epc.opendatacommunities.org/api/v1/domestic/search?postcode=${encodeURIComponent(postcode)}&size=100`;
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
}
