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
  'address1': string;
  'address2'?: string;
  'address3'?: string;
  'town'?: string;
  'county'?: string;
  'postcode': string;
  'uprn'?: string;
  'property-type'?: string;
  'built-form'?: string;
  'current-energy-rating'?: string;
  'current-energy-efficiency'?: number | string;
  'total-floor-area'?: number | string;
  'number-habitable-rooms'?: number | string;
  'tenure'?: string;
  'construction-age-band'?: string;
  'main-heating-description'?: string;
  'co2-emissions-current'?: number | string;
  'transaction-type'?: string;
  'lodgement-date'?: string;
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

  // Rooms → bedrooms (rough: subtract 1 for living room)
  const habRooms = parseInt(String(row['number-habitable-rooms'] ?? '0'));
  const bedrooms = habRooms > 1 ? habRooms - 1 : habRooms || null;

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
    sqft: row['total-floor-area'] ? Math.round(parseFloat(String(row['total-floor-area'])) * 10.764) : null,
    epcRating: row['current-energy-rating'] ?? null,
    epcScore: parseInt(String(row['current-energy-efficiency'] ?? '0')) || null,
    tenure: row['tenure'] ?? null,
    yearBuilt: yearBuilt,
    heatingType: row['main-heating-description'] ?? null,
    co2Emissions: parseFloat(String(row['co2-emissions-current'] ?? '0')) || null,
    epcEnrichedAt: new Date(),
  };
}

// ── Fallback mock data (used when EPC API returns no results) ─────────────────

const STREET_NAMES = ['High Street', 'Maple Road', 'Oak Avenue', 'Church Lane', 'Victoria Road', 'Station Road', 'Park Avenue', 'The Green', 'Mill Lane', 'Woodland Drive'];
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

const POSTCODE_AREAS: Record<string, { city: string; county: string; basePricek: number; lat: number; lon: number }> = {
  E: { city: 'London', county: 'Greater London', basePricek: 650, lat: 51.515, lon: -0.072 },
  W: { city: 'London', county: 'Greater London', basePricek: 950, lat: 51.512, lon: -0.188 },
  N: { city: 'London', county: 'Greater London', basePricek: 700, lat: 51.565, lon: -0.103 },
  SE: { city: 'London', county: 'Greater London', basePricek: 580, lat: 51.477, lon: -0.021 },
  SW: { city: 'London', county: 'Greater London', basePricek: 850, lat: 51.468, lon: -0.172 },
  EC: { city: 'London', county: 'Greater London', basePricek: 900, lat: 51.519, lon: -0.098 },
  WC: { city: 'London', county: 'Greater London', basePricek: 1100, lat: 51.517, lon: -0.125 },
  NW: { city: 'London', county: 'Greater London', basePricek: 780, lat: 51.548, lon: -0.165 },
  TW: { city: 'Twickenham', county: 'Surrey', basePricek: 620, lat: 51.449, lon: -0.337 },
  KT: { city: 'Kingston upon Thames', county: 'Surrey', basePricek: 680, lat: 51.412, lon: -0.303 },
  CR: { city: 'Croydon', county: 'Surrey', basePricek: 450, lat: 51.376, lon: -0.098 },
  SM: { city: 'Sutton', county: 'Surrey', basePricek: 480, lat: 51.365, lon: -0.192 },
  BR: { city: 'Bromley', county: 'Greater London', basePricek: 510, lat: 51.406, lon: 0.019 },
  GU: { city: 'Guildford', county: 'Surrey', basePricek: 500, lat: 51.236, lon: -0.570 },
  SL: { city: 'Slough', county: 'Berkshire', basePricek: 400, lat: 51.509, lon: -0.595 },
  B: { city: 'Birmingham', county: 'West Midlands', basePricek: 280, lat: 52.486, lon: -1.890 },
  CV: { city: 'Coventry', county: 'West Midlands', basePricek: 240, lat: 52.408, lon: -1.511 },
  LE: { city: 'Leicester', county: 'Leicestershire', basePricek: 230, lat: 52.636, lon: -1.132 },
  M: { city: 'Manchester', county: 'Greater Manchester', basePricek: 300, lat: 53.483, lon: -2.244 },
  LS: { city: 'Leeds', county: 'West Yorkshire', basePricek: 280, lat: 53.800, lon: -1.549 },
  S: { city: 'Sheffield', county: 'South Yorkshire', basePricek: 220, lat: 53.383, lon: -1.465 },
  L: { city: 'Liverpool', county: 'Merseyside', basePricek: 200, lat: 53.409, lon: -2.978 },
  NE: { city: 'Newcastle upon Tyne', county: 'Tyne and Wear', basePricek: 190, lat: 54.978, lon: -1.618 },
  SO: { city: 'Southampton', county: 'Hampshire', basePricek: 320, lat: 50.904, lon: -1.404 },
  PO: { city: 'Portsmouth', county: 'Hampshire', basePricek: 280, lat: 50.820, lon: -1.091 },
  BN: { city: 'Brighton', county: 'East Sussex', basePricek: 430, lat: 50.823, lon: -0.137 },
  DEFAULT: { city: 'United Kingdom', county: 'England', basePricek: 300, lat: 51.509, lon: -0.118 },
};

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function getAreaInfo(postcode: string) {
  const upper = postcode.trim().toUpperCase();
  const twoChar = upper.substring(0, 2).replace(/[0-9]/g, '');
  const oneChar = upper.substring(0, 1);
  return POSTCODE_AREAS[twoChar] || POSTCODE_AREAS[oneChar] || POSTCODE_AREAS['DEFAULT'];
}

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class PropertyService {
  constructor(
    private prisma: PrismaService,
    private passportService: PassportService,
  ) {}

  async searchProperties(query: string, offset = 0, limit = 10): Promise<{ items: Property[]; total: number }> {
    const q = query.trim();

    // 1. Check our DB first — count + paginate
    const where = {
      OR: [
        { postcode: { contains: q, mode: 'insensitive' as const } },
        { addressLine1: { contains: q, mode: 'insensitive' as const } },
        { city: { contains: q, mode: 'insensitive' as const } },
        { county: { contains: q, mode: 'insensitive' as const } },
      ],
    };

    const dbTotal = await this.prisma.property.count({ where });

    if (dbTotal > 0) {
      const items = await this.prisma.property.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      });
      return { items, total: dbTotal };
    }

    // 2. Nothing in DB — fetch from EPC API (first page seeds the DB)
    const epcResult = await this.fetchFromEpc(q, offset, limit);
    if (epcResult.total > 0) return epcResult;

    // 3. Fallback: generate mocks (offset 0 only — mocks are always 5 total)
    if (offset === 0) {
      let postcodeInfo: { latitude: number; longitude: number; postcode: string } | null = null;
      try {
        const clean = q.replace(/\s/g, '').toUpperCase();
        const res = await fetch(`https://api.postcodes.io/postcodes/${clean}`);
        if (res.ok) { const data = await res.json(); postcodeInfo = data.result; }
      } catch { /* ignore */ }

      if (!postcodeInfo) {
        try {
          const res = await fetch(`https://api.postcodes.io/postcodes?q=${encodeURIComponent(q)}&limit=1`);
          if (res.ok) { const data = await res.json(); if (data.result?.length > 0) postcodeInfo = data.result[0]; }
        } catch { /* ignore */ }
      }

      const mocks = await this.generateAndSaveMockProperties(q, postcodeInfo);
      return { items: mocks, total: mocks.length };
    }

    return { items: [], total: 0 };
  }

  private async fetchFromEpc(query: string, offset = 0, limit = 10): Promise<{ items: Property[]; total: number }> {
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
        const pcRes = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`);
        if (pcRes.ok) {
          const pcData = await pcRes.json();
          lat = pcData.result?.latitude ?? null;
          lon = pcData.result?.longitude ?? null;
        }
      } catch { /* ignore */ }

      const areaInfo = getAreaInfo(query);

      const saved: Property[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const mapped = epcRowToProperty(row);
        const globalIndex = offset + i;
        const udprn = mapped.uprn ? `EPC-${mapped.uprn}` : `EPC-${clean}-${globalIndex}`;

        const jLat = lat ? lat + (seededRandom(globalIndex * 17) - 0.5) * 0.008 : areaInfo.lat;
        const jLon = lon ? lon + (seededRandom(globalIndex * 23) - 0.5) * 0.008 : areaInfo.lon;

        const floorM2 = mapped.floorAreaSqm ?? 80;
        const pricePerSqm = areaInfo.basePricek * 12;
        const estimatedPrice = Math.round((floorM2 * pricePerSqm) / 1000) * 1000;
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
              epcEnrichedAt: new Date(),
            },
            create: {
              udprn,
              uprn: mapped.uprn,
              addressLine1: mapped.addressLine1 || `Property ${globalIndex + 1}`,
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
              estimatedPrice,
              imageUrl: PEXELS_IMAGES[imgIndex],
              epcEnrichedAt: new Date(),
            },
          });
          saved.push(prop);
        } catch { /* skip constraint violations */ }
      }

      return { items: saved, total: epcTotal };
    } catch (err) {
      console.error('EPC API error:', err);
      return { items: [], total: 0 };
    }
  }

  async getPropertyById(id: string): Promise<Property | null> {
    return this.prisma.property.findUnique({ where: { id } });
  }

  // ── Enrichment (on-demand, not stored) ────────────────────────────────────

  async getPropertyEnrichment(propertyId: string) {
    const property = await this.prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) return null;

    const lat = property.latitude;
    const lon = property.longitude;
    const postcode = property.postcode;

    const [nearby, floodRisk, priceHistory] = await Promise.allSettled([
      lat && lon ? this.fetchNearbyPlaces(lat, lon) : Promise.resolve({ schools: [], trains: [], parks: [] }),
      lat && lon ? this.fetchFloodRisk(lat, lon) : Promise.resolve(null),
      this.fetchPriceHistory(postcode),
    ]);

    const googleKey = process.env.GOOGLE_API_KEY ?? '';
    const streetViewUrl = lat && lon && googleKey
      ? `https://maps.googleapis.com/maps/api/streetview?size=600x400&location=${lat},${lon}&key=${googleKey}&return_error_codes=true`
      : null;

    return {
      streetViewUrl,
      nearby: nearby.status === 'fulfilled' ? nearby.value : { schools: [], trains: [], parks: [] },
      floodRisk: floodRisk.status === 'fulfilled' ? floodRisk.value : null,
      priceHistory: priceHistory.status === 'fulfilled' ? priceHistory.value : [],
    };
  }

  private async fetchNearbyPlaces(lat: number, lon: number) {
    const key = process.env.GOOGLE_API_KEY;
    if (!key) return { schools: [], trains: [], parks: [] };

    const base = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';
    const location = `${lat},${lon}`;

    const [schoolsRes, trainsRes, parksRes] = await Promise.allSettled([
      fetch(`${base}?location=${location}&radius=1500&type=school&key=${key}`).then((r) => r.json()),
      fetch(`${base}?location=${location}&radius=2000&type=train_station&key=${key}`).then((r) => r.json()),
      fetch(`${base}?location=${location}&radius=1000&type=park&key=${key}`).then((r) => r.json()),
    ]);

    function mapPlaces(res: PromiseSettledResult<any>, limit = 3) {
      if (res.status !== 'fulfilled') return [];
      return (res.value?.results ?? []).slice(0, limit).map((p: any) => ({
        name: p.name,
        rating: p.rating ?? null,
        distance: null, // could compute with Haversine if needed
        vicinity: p.vicinity,
      }));
    }

    return {
      schools: mapPlaces(schoolsRes),
      trains: mapPlaces(trainsRes),
      parks: mapPlaces(parksRes),
    };
  }

  private async fetchFloodRisk(lat: number, lon: number): Promise<string | null> {
    try {
      const url = `https://environment.data.gov.uk/flood-monitoring/id/floodAreas?lat=${lat}&long=${lon}&dist=1`;
      const res = await fetch(url);
      if (!res.ok) return 'Unknown';
      const data = await res.json();
      const items = data.items ?? [];
      if (items.length === 0) return 'Very Low';
      // Check severity: 1=severe, 2=high, 3=medium, 4=low
      const minSev = Math.min(...items.map((i: any) => i.currentWarning?.severity?.severityLevel ?? 4));
      if (minSev <= 1) return 'Severe';
      if (minSev <= 2) return 'High';
      if (minSev <= 3) return 'Medium';
      return 'Low';
    } catch {
      return null;
    }
  }

  private async fetchPriceHistory(postcode: string): Promise<any[]> {
    try {
      const clean = encodeURIComponent(postcode);
      const url = `https://landregistry.data.gov.uk/data/ppi/transaction-record.json?propertyAddress.postcode=${clean}&_limit=5&_sort=-transactionDate`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return [];
      const data = await res.json();
      const items = data.result?.items ?? [];
      return items.map((item: any) => ({
        price: item.pricePaid,
        date: item.transactionDate,
        address: item.propertyAddress?.['paon'] ? `${item.propertyAddress['paon']} ${item.propertyAddress['street'] ?? ''}`.trim() : null,
        propertyType: item.propertyType?.prefLabel?.[0] ?? null,
      }));
    } catch {
      return [];
    }
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

    if (!property) return { hasPassport: false, passportId: null, isOwner: false, isCollaborator: false, isBuyer: false, verificationStatus: null };

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
    const isBuyer = !isOwner && !isCollaborator && (passport.buyerAccesses?.length ?? 0) > 0;

    return {
      hasPassport: true,
      passportId: passport.id,
      passportStatus: passport.status,
      isOwner,
      isCollaborator,
      isBuyer,
      canAccess: isOwner || isCollaborator || isBuyer,
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
      create: { propertyId, userId, status: 'VERIFIED', verifiedAt: new Date() },
    });

    const property = await this.prisma.property.findUnique({ where: { id: propertyId } });
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
    postcodeInfo: { latitude: number; longitude: number; postcode: string } | null,
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
      const typeIndex = Math.floor(seededRandom(seed + 2) * PROPERTY_TYPES.length);
      const tenureIndex = Math.floor(seededRandom(seed + 3) * TENURES.length);
      const epcIndex = Math.floor(seededRandom(seed + 4) * EPC_RATINGS.length);
      const imgIndex = i % PEXELS_IMAGES.length;
      const propType = PROPERTY_TYPES[typeIndex];
      const bedrooms = propType === 'Flat' ? Math.floor(seededRandom(seed + 5) * 2) + 1 : Math.floor(seededRandom(seed + 5) * 3) + 2;
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
      } catch { /* skip */ }
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
    return items.map((item) => ({ ...item.property, wishlistedAt: item.createdAt }));
  }

  // ── Saved Properties ───────────────────────────────────────────────────────

  async toggleSave(userId: string, propertyId: string) {
    const existing = await this.prisma.userSavedProperty.findUnique({
      where: { userId_propertyId: { userId, propertyId } },
    });
    if (existing) {
      await this.prisma.userSavedProperty.delete({ where: { id: existing.id } });
      return { saved: false };
    }
    await this.prisma.userSavedProperty.create({ data: { userId, propertyId } });
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
      this.prisma.userWishlist.findUnique({ where: { userId_propertyId: { userId, propertyId } } }),
      this.prisma.userSavedProperty.findUnique({ where: { userId_propertyId: { userId, propertyId } } }),
    ]);
    return { wishlisted: !!wishlist, saved: !!saved };
  }
}
