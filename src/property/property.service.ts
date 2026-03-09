import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PassportService } from '../passport/passport.service';
import { Property } from '@prisma/client';

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
  'Queens Road',
  'Kings Avenue',
  'Manor Road',
  'Elm Close',
  'Cedar Way',
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

// Area names mapped from common UK postcode prefixes
const POSTCODE_AREAS: Record<string, { city: string; county: string; basePricek: number; lat: number; lon: number }> = {
  // London
  E: { city: 'London', county: 'Greater London', basePricek: 650, lat: 51.515, lon: -0.072 },
  W: { city: 'London', county: 'Greater London', basePricek: 950, lat: 51.512, lon: -0.188 },
  N: { city: 'London', county: 'Greater London', basePricek: 700, lat: 51.565, lon: -0.103 },
  SE: { city: 'London', county: 'Greater London', basePricek: 580, lat: 51.477, lon: -0.021 },
  SW: { city: 'London', county: 'Greater London', basePricek: 850, lat: 51.468, lon: -0.172 },
  EC: { city: 'London', county: 'Greater London', basePricek: 900, lat: 51.519, lon: -0.098 },
  WC: { city: 'London', county: 'Greater London', basePricek: 1100, lat: 51.517, lon: -0.125 },
  NW: { city: 'London', county: 'Greater London', basePricek: 780, lat: 51.548, lon: -0.165 },
  // Home Counties
  TW: { city: 'Twickenham', county: 'Surrey', basePricek: 620, lat: 51.449, lon: -0.337 },
  KT: { city: 'Kingston upon Thames', county: 'Surrey', basePricek: 680, lat: 51.412, lon: -0.303 },
  CR: { city: 'Croydon', county: 'Surrey', basePricek: 450, lat: 51.376, lon: -0.098 },
  SM: { city: 'Sutton', county: 'Surrey', basePricek: 480, lat: 51.365, lon: -0.192 },
  BR: { city: 'Bromley', county: 'Greater London', basePricek: 510, lat: 51.406, lon: 0.019 },
  RH: { city: 'Redhill', county: 'Surrey', basePricek: 420, lat: 51.237, lon: -0.173 },
  GU: { city: 'Guildford', county: 'Surrey', basePricek: 500, lat: 51.236, lon: -0.570 },
  SL: { city: 'Slough', county: 'Berkshire', basePricek: 400, lat: 51.509, lon: -0.595 },
  // Midlands
  B: { city: 'Birmingham', county: 'West Midlands', basePricek: 280, lat: 52.486, lon: -1.890 },
  CV: { city: 'Coventry', county: 'West Midlands', basePricek: 240, lat: 52.408, lon: -1.511 },
  LE: { city: 'Leicester', county: 'Leicestershire', basePricek: 230, lat: 52.636, lon: -1.132 },
  NN: { city: 'Northampton', county: 'Northamptonshire', basePricek: 250, lat: 52.238, lon: -0.902 },
  // North
  M: { city: 'Manchester', county: 'Greater Manchester', basePricek: 300, lat: 53.483, lon: -2.244 },
  LS: { city: 'Leeds', county: 'West Yorkshire', basePricek: 280, lat: 53.800, lon: -1.549 },
  S: { city: 'Sheffield', county: 'South Yorkshire', basePricek: 220, lat: 53.383, lon: -1.465 },
  L: { city: 'Liverpool', county: 'Merseyside', basePricek: 200, lat: 53.409, lon: -2.978 },
  NE: { city: 'Newcastle upon Tyne', county: 'Tyne and Wear', basePricek: 190, lat: 54.978, lon: -1.618 },
  // South
  SO: { city: 'Southampton', county: 'Hampshire', basePricek: 320, lat: 50.904, lon: -1.404 },
  PO: { city: 'Portsmouth', county: 'Hampshire', basePricek: 280, lat: 50.820, lon: -1.091 },
  BN: { city: 'Brighton', county: 'East Sussex', basePricek: 430, lat: 50.823, lon: -0.137 },
  CT: { city: 'Canterbury', county: 'Kent', basePricek: 350, lat: 51.279, lon: 1.079 },
  // Default
  DEFAULT: { city: 'United Kingdom', county: 'England', basePricek: 300, lat: 51.509, lon: -0.118 },
};

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function getAreaInfo(postcode: string) {
  const upper = postcode.trim().toUpperCase();
  // Try 2-char prefix first, then 1-char
  const twoChar = upper.substring(0, 2).replace(/[0-9]/g, '');
  const oneChar = upper.substring(0, 1);
  return POSTCODE_AREAS[twoChar] || POSTCODE_AREAS[oneChar] || POSTCODE_AREAS['DEFAULT'];
}

@Injectable()
export class PropertyService {
  constructor(
    private prisma: PrismaService,
    private passportService: PassportService,
  ) {}

  async searchProperties(query: string): Promise<Property[]> {
    const q = query.trim();

    // Search our DB for matching properties
    const found = await this.prisma.property.findMany({
      where: {
        OR: [
          { postcode: { contains: q, mode: 'insensitive' } },
          { addressLine1: { contains: q, mode: 'insensitive' } },
          { city: { contains: q, mode: 'insensitive' } },
          { county: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (found.length > 0) return found;

    // Nothing in DB — validate postcode with postcodes.io then generate mocks
    let postcodeInfo: { latitude: number; longitude: number; postcode: string } | null = null;
    try {
      const clean = q.replace(/\s/g, '').toUpperCase();
      const res = await fetch(`https://api.postcodes.io/postcodes/${clean}`);
      if (res.ok) {
        const data = await res.json();
        postcodeInfo = data.result;
      }
    } catch {
      // postcodes.io not reachable — continue with fallback
    }

    // If postcodes.io returned nothing, try autocomplete endpoint
    if (!postcodeInfo) {
      try {
        const res = await fetch(`https://api.postcodes.io/postcodes?q=${encodeURIComponent(q)}&limit=1`);
        if (res.ok) {
          const data = await res.json();
          if (data.result && data.result.length > 0) {
            postcodeInfo = data.result[0];
          }
        }
      } catch {
        // ignore
      }
    }

    return this.generateAndSaveMockProperties(q, postcodeInfo);
  }

  async getPropertyById(id: string): Promise<Property | null> {
    return this.prisma.property.findUnique({ where: { id } });
  }

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
    // Mark verification as verified
    await this.prisma.ownershipVerification.upsert({
      where: { propertyId_userId: { propertyId, userId } },
      update: { status: 'VERIFIED', verifiedAt: new Date() },
      create: { propertyId, userId, status: 'VERIFIED', verifiedAt: new Date() },
    });

    // Get property details to create passport
    const property = await this.prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) throw new Error('Property not found');

    // Use PassportService to create a fully-populated passport (sections, tasks, questions)
    const { passportId } = await this.passportService.createPassport(
      userId,
      property.addressLine1,
      property.postcode,
      property.id,
    );

    // Update verification with passportId
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

    // Use the validated postcode from postcodes.io if available, else format the query
    const basePostcode = postcodeInfo?.postcode ?? query.toUpperCase();

    // Generate 5 mock properties for this area
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
      const bathrooms = Math.max(1, Math.floor(bedrooms * 0.6));
      const sqft = bedrooms * 300 + Math.floor(seededRandom(seed + 6) * 400);
      const priceVariance = 0.8 + seededRandom(seed + 7) * 0.8;
      const price = Math.round(areaInfo.basePricek * priceVariance) * 1000;
      const yearBuilt = 1960 + Math.floor(seededRandom(seed + 8) * 64);

      const addressLine1 = `${houseNumber}, ${STREET_NAMES[streetIndex]}`;
      const udprn = `MOCK-${basePostcode.replace(/\s/g, '')}-${i}`;

      // Jitter lat/lon slightly so properties aren't all at same point
      const jitteredLat = lat + (seededRandom(seed + 9) - 0.5) * 0.01;
      const jitteredLon = lon + (seededRandom(seed + 10) - 0.5) * 0.01;

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
            latitude: jitteredLat,
            longitude: jitteredLon,
            propertyType: propType,
            bedrooms,
            bathrooms,
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
        // Skip if constraint violation (race condition)
      }
    }

    // If upserts returned existing records, re-fetch to ensure complete list
    if (created.length === 0) {
      return this.prisma.property.findMany({
        where: { postcode: { contains: query, mode: 'insensitive' } },
        take: 10,
      });
    }

    return created;
  }
}
