import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Environment Agency "Risk of Flooding from Rivers and Sea" (RoFRS) categories.
 * The EA classifies any point in England into one of these four bands. Source:
 * https://check-long-term-flood-risk.service.gov.uk
 */
export type FloodRiskBand =
  | 'High'         // > 3.3% chance any year
  | 'Medium'       // 1–3.3%
  | 'Low'          // 0.1–1%
  | 'Very Low'     // < 0.1%
  | 'Unknown';     // outside the dataset / lookup failed

const ENRICH_TTL_DAYS = 90;

/**
 * EA ArcGIS REST endpoint for the public "Risk of Flooding from Rivers and Sea"
 * map service. Returns a feature whose attributes contain the risk band when
 * `identify`-queried at a lat/lng point.
 */
const EA_ROFRS_URL =
  'https://environment.data.gov.uk/arcgis/rest/services/EA/RiskOfFloodingFromRiversAndSea/MapServer/identify';

@Injectable()
export class FloodRiskService {
  private readonly logger = new Logger(FloodRiskService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Return a flood risk band for the given property. Caches the result on the
   * `Property` row for 90 days so we don't hammer the EA on every page load.
   * Returns `Unknown` if the lookup fails (network, no coordinates on file,
   * etc.) so the UI can render a graceful fallback.
   */
  async getFloodRisk(propertyId: string): Promise<FloodRiskBand> {
    const p: any = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        id: true,
        latitude: true,
        longitude: true,
        floodRisk: true,
        floodRiskEnrichedAt: true,
      } as any,
    });
    if (!p) return 'Unknown';

    // Cache hit
    if (p.floodRisk && this.isFresh(p.floodRiskEnrichedAt)) {
      return p.floodRisk as FloodRiskBand;
    }

    // No coordinates — can't query the EA. Persist 'Unknown' so we don't
    // re-attempt on every page load, and refresh after the TTL.
    if (typeof p.latitude !== 'number' || typeof p.longitude !== 'number') {
      await this.persistFloodRisk(propertyId, 'Unknown');
      return 'Unknown';
    }

    const fresh = await this.fetchFromEA(p.latitude, p.longitude);
    await this.persistFloodRisk(propertyId, fresh);
    return fresh;
  }

  private isFresh(enrichedAt: Date | null | undefined): boolean {
    if (!enrichedAt) return false;
    const ageMs = Date.now() - new Date(enrichedAt).getTime();
    return ageMs < ENRICH_TTL_DAYS * 24 * 60 * 60 * 1000;
  }

  private async persistFloodRisk(
    propertyId: string,
    risk: FloodRiskBand,
  ): Promise<void> {
    try {
      await this.prisma.property.update({
        where: { id: propertyId },
        data: {
          floodRisk: risk,
          floodRiskEnrichedAt: new Date(),
        } as any,
      });
    } catch (e) {
      this.logger.warn(`Failed to persist flood risk: ${e}`);
    }
  }

  /**
   * Query the EA ArcGIS identify endpoint at (lat, lng) and return the
   * RoFRS risk band. Falls back to 'Unknown' on any error.
   *
   * The exact attribute name varies between layer versions, so we check the
   * common ones in order ("Risk band", then "PROB_4BAND", etc.) and normalise
   * to the canonical 4-band string.
   */
  private async fetchFromEA(lat: number, lng: number): Promise<FloodRiskBand> {
    try {
      // ArcGIS `identify` needs a mapExtent + imageDisplay so it can map screen
      // pixels to map units. A small box around the point (~100m) is enough.
      const delta = 0.001;
      const extent = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
      const url =
        `${EA_ROFRS_URL}?geometryType=esriGeometryPoint&geometry=${lng},${lat}` +
        `&tolerance=1&mapExtent=${extent}&imageDisplay=400,400,96` +
        `&sr=4326&layers=all&returnGeometry=false&f=json`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return 'Unknown';
      const data = await res.json();
      const result = data?.results?.[0];
      if (!result?.attributes) {
        // No feature returned at this point → outside the flood-risk dataset,
        // which the EA treats as the lowest-risk band.
        return 'Very Low';
      }
      const attrs = result.attributes as Record<string, any>;
      const raw =
        attrs['Risk band'] ??
        attrs['risk_band'] ??
        attrs['PROB_4BAND'] ??
        attrs['Probability'] ??
        attrs['probability'] ??
        null;
      return this.normaliseBand(raw);
    } catch (e) {
      this.logger.warn(`EA flood-risk fetch failed: ${e}`);
      return 'Unknown';
    }
  }

  private normaliseBand(raw: any): FloodRiskBand {
    if (!raw) return 'Unknown';
    const v = String(raw).trim().toLowerCase();
    if (v.startsWith('high')) return 'High';
    if (v.startsWith('med')) return 'Medium';
    if (v.startsWith('very low') || v === 'verylow') return 'Very Low';
    if (v.startsWith('low')) return 'Low';
    return 'Unknown';
  }
}
