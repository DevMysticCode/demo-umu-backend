import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * HM Land Registry — Local Land Charges External Search API client.
 *
 * Docs live in prisma/external_search_api_documentation_October_2025.pdf.
 * The API is licensed for approved-user display: we cache per-property
 * results and always show the HMLR attribution + "not an official
 * search" disclaimer on the surface. Bulk export / resale is out of
 * scope.
 *
 * Error taxonomy we map into `LlcSearch.status`:
 *  - `OK_WITH_CHARGES`  — 200, at least one direct or boundary charge
 *  - `OK_EMPTY`         — 200, no charges (POSITIVE signal — surface it)
 *  - `NOT_MIGRATED`     — 400 E435, council hasn't moved to HMLR yet
 *  - `MULTI_GEOMETRY`   — 400 E425, HMLR has ambiguous parcel geometry
 *  - `ERROR`            — anything else (auth failure, 5xx, network)
 *
 * The status is authoritative for what the UI shows — never derive
 * from `charges.length` alone (empty could mean "not migrated" too).
 */
@Injectable()
export class LlcService {
  private readonly logger = new Logger(LlcService.name);
  private readonly endpoint =
    'https://search-local-land-charges.service.gov.uk/v1/address-search';
  // Cache for 30 days by default — LLC data updates slowly (registration
  // dates on real charges span 2004–2020 in our smoke test) so daily
  // refresh would just burn our quota. Users can force-refresh via
  // POST /property/:id/llc/refresh.
  private readonly ttlMs = 30 * 24 * 60 * 60 * 1000;

  constructor(private prisma: PrismaService) {}

  /**
   * Read-through: returns the cached search if it exists and is within
   * TTL, otherwise fetches from HMLR. Set `force` to skip the TTL check
   * (still upserts one row per property — no duplicate history).
   */
  async searchByProperty(propertyId: string, opts: { force?: boolean } = {}) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true, uprn: true, addressLine1: true, postcode: true },
    });
    if (!property) throw new NotFoundException('Property not found');

    const existing = await this.prisma.llcSearch.findUnique({
      where: { propertyId },
      include: { charges: { orderBy: [{ boundary: 'asc' }, { registrationDate: 'desc' }] } },
    });
    if (existing && !opts.force) {
      const age = Date.now() - existing.searchedAt.getTime();
      if (age < this.ttlMs) return existing;
    }

    return this.refresh(property, existing?.id ?? null);
  }

  private async refresh(
    property: { id: string; uprn: string | null; addressLine1: string; postcode: string },
    existingSearchId: string | null,
  ) {
    const token = process.env.HMLR_LLC_BEARER_TOKEN;
    if (!token) {
      this.logger.error('HMLR_LLC_BEARER_TOKEN not configured');
      throw new ServiceUnavailableException('LLC search not configured');
    }
    // Priority per HMLR docs: title-number → UPRN → address. We store
    // UPRN when we have it (Property.uprn is unique), so use it when
    // present. Falling back to address means the API resolves against
    // Ordnance Survey which can hit multi-geometry errors.
    const body: Record<string, unknown> = {
      rules: {
        // Return everything — start with 0/0 thresholds and let the UI
        // colour-code boundary charges separately. Docs recommend
        // never exceeding 5 either way.
        'boundary-threshold-area': 0,
        'boundary-threshold-percentage': 0,
        // Empty list explicitly opts OUT of HMLR's default exclusions
        // so we get every category and can decide what to hide client-
        // side (e.g. Conservation Area is high signal, not noise).
        'excluded-categories': [],
      },
    };
    if (property.uprn) body['search-uprn'] = Number(property.uprn);
    else body['search-address'] = `${property.addressLine1}, ${property.postcode}`;

    const started = Date.now();
    let res: Response;
    let text: string;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      text = await res.text();
    } catch (err) {
      this.logger.error(`HMLR fetch failed for ${property.id}: ${(err as Error).message}`);
      return this.upsert(existingSearchId, property.id, {
        status: 'ERROR',
        errorCode: 'NETWORK',
        errorMessage: (err as Error).message,
      });
    }

    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-JSON body handled below */ }

    if (res.status === 200 && json) {
      const rawCharges: any[] = Array.isArray(json.charges) ? json.charges : [];
      const rawBoundary: any[] = Array.isArray(json['boundary-charges'])
        ? json['boundary-charges'] : [];
      const status = rawCharges.length + rawBoundary.length > 0
        ? 'OK_WITH_CHARGES' : 'OK_EMPTY';
      const ms = Date.now() - started;
      this.logger.log(
        `[llc] ${status} for ${property.id} — ${rawCharges.length} direct + ${rawBoundary.length} boundary (${ms}ms)`,
      );
      return this.upsert(existingSearchId, property.id, {
        status,
        searchAddress: json['search-address'] ?? null,
        extentGeoJson: json['search-extent'] ?? null,
        extentAreaSqm: typeof json['search-extent-area'] === 'number'
          ? json['search-extent-area'] : null,
        warnings: Array.isArray(json.warnings) ? json.warnings.map(String) : [],
        charges: [
          ...rawCharges.map((c) => this.mapCharge(c, false)),
          ...rawBoundary.map((c) => this.mapCharge(c, true)),
        ],
      });
    }

    // 400s carry HMLR's error_code + error_message — map the common
    // ones so the UI can render an honest empty state.
    if (res.status === 400 && json && typeof json.error_code === 'string') {
      const status = this.mapErrorCode(json.error_code);
      this.logger.warn(
        `[llc] ${status} for ${property.id} — ${json.error_code}: ${json.error_message ?? ''}`,
      );
      return this.upsert(existingSearchId, property.id, {
        status,
        errorCode: json.error_code,
        errorMessage: json.error_message ?? null,
      });
    }

    // Anything else — 401 (bad token), 5xx, non-JSON body — logs and
    // records ERROR so the UI can offer a retry without a re-fetch loop.
    this.logger.error(
      `[llc] unexpected HMLR response for ${property.id}: ${res.status} ${text.slice(0, 200)}`,
    );
    return this.upsert(existingSearchId, property.id, {
      status: 'ERROR',
      errorCode: `HTTP_${res.status}`,
      errorMessage: (json?.error_message as string) ?? text.slice(0, 500),
    });
  }

  private mapErrorCode(code: string): string {
    // E435 = "Search location covers an area for which we do not
    // currently hold information" — the council hasn't migrated.
    // E425 = "More than one possible geometry found" — HMLR's parcel
    // data is ambiguous. UPRN-based search can't recover; a manual
    // gov.uk lookup is the escape hatch.
    if (code === 'E435') return 'NOT_MIGRATED';
    if (code === 'E425') return 'MULTI_GEOMETRY';
    return 'ERROR';
  }

  private mapCharge(c: any, boundary: boolean) {
    // Store fields verbatim — HMLR pre-redacts Housing Grant / LON /
    // Pipeline descriptions with the literal string
    //   "Viewable on official search result"
    // and we must render that as-is (never fabricate substitute text).
    // The one interpretation we do: parse DD/MM/YYYY dates into JS
    // Date so the UI can sort by year and format per locale.
    return {
      boundary,
      category: String(c.category ?? 'Uncategorised'),
      subCategory: c['sub-category'] ? String(c['sub-category']) : null,
      law: c.law ? String(c.law) : null,
      legalDocument: c['legal-document'] ? String(c['legal-document']) : null,
      description: c.description ? String(c.description) : null,
      location: c.location ? String(c.location) : null,
      reference: String(c.reference ?? ''),
      // Undocumented field observed in the wild — the council's own
      // reference (e.g. `10/00226/SMOKE`, `20120335`). Keep it: it's
      // the key that lets us deep-link into LPA planning portals.
      authorityReference: c['authority-reference']
        ? String(c['authority-reference']) : null,
      creationDate: this.parseUkDate(c['creation-date']),
      registrationDate: this.parseUkDate(c['registration-date']),
    };
  }

  private parseUkDate(s: unknown): Date | null {
    // HMLR sends DD/MM/YYYY strings (or the sentinel "Viewable on
    // official search result" for redacted charges). Only accept the
    // DD/MM/YYYY shape — anything else → null so the DB stores NULL
    // rather than 1970-01-01 for the redacted case.
    if (typeof s !== 'string') return null;
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    const [, dd, mm, yyyy] = m;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return isNaN(d.getTime()) ? null : d;
  }

  private async upsert(
    existingId: string | null,
    propertyId: string,
    payload: {
      status: string;
      errorCode?: string | null;
      errorMessage?: string | null;
      searchAddress?: string | null;
      extentGeoJson?: unknown;
      extentAreaSqm?: number | null;
      warnings?: string[];
      charges?: ReturnType<LlcService['mapCharge']>[];
    },
  ) {
    // One row per property (LlcSearch.propertyId is @unique). Replace
    // the whole charge set on every refresh — cheaper than diffing and
    // HMLR already returns the authoritative list. Wrapped in a
    // transaction so a partial write can never leave stale charges
    // attached to a refreshed header row.
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const base = {
        status: payload.status,
        errorCode: payload.errorCode ?? null,
        errorMessage: payload.errorMessage ?? null,
        searchAddress: payload.searchAddress ?? null,
        extentGeoJson: (payload.extentGeoJson ?? null) as any,
        extentAreaSqm: payload.extentAreaSqm ?? null,
        warnings: payload.warnings ?? [],
        searchedAt: now,
      };
      const search = existingId
        ? await tx.llcSearch.update({ where: { id: existingId }, data: base })
        : await tx.llcSearch.create({ data: { ...base, propertyId } });
      await tx.llcCharge.deleteMany({ where: { searchId: search.id } });
      if (payload.charges?.length) {
        await tx.llcCharge.createMany({
          data: payload.charges.map((c) => ({ ...c, searchId: search.id })),
        });
      }
      return tx.llcSearch.findUnique({
        where: { id: search.id },
        include: {
          charges: { orderBy: [{ boundary: 'asc' }, { registrationDate: 'desc' }] },
        },
      });
    });
  }
}
