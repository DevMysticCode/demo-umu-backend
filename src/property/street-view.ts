/**
 * Street View URL construction — single source of truth so a key
 * rotation is a one-file change.
 *
 * The URL is deliberately built at RESPONSE TIME (via
 * resolveStreetViewUrl below) rather than baked into the Property row.
 * When we baked it, every rotation left every existing row pointing at
 * a dead key until the row was re-upserted — the exact problem behind
 * the 30-Jun images-not-loading incident.
 *
 * The upsert still stores the URL so read-only replicas / older code
 * paths keep working, but the search + property responses always
 * override it via resolveStreetViewUrl so DB staleness is invisible.
 */

interface Coords {
  lat: number | null;
  lon?: number | null;
  longitude?: number | null;
}

export interface BuildStreetViewOptions {
  size?: string;
  fov?: number;
  pitch?: number;
  radius?: number;
}

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3002';

// Anchored allow-list for the one option that reaches buildStreetViewUrl
// as a raw string rather than a Number()-coerced value. Without this, a
// client-supplied `size` flowed straight into a hand-built query-string
// template literal - e.g. size=1x1%26location=0,0%26key=... injects a
// second `location`/`key` pair into the request this server makes to
// Google with its own GOOGLE_API_KEY (security review, 14 Oct 2026).
const SIZE_PATTERN = /^\d{1,4}x\d{1,4}$/;

/**
 * Build the REAL Google Street View Static image URL, key included.
 * Server-side use only — the property/street-view-image proxy route is
 * the sole caller that actually fetches this URL; nothing returns it to
 * a client directly. Returns null if we don't have coordinates or a
 * Google key at all.
 */
export function buildStreetViewUrl(
  lat: number | null | undefined,
  lon: number | null | undefined,
  opts: BuildStreetViewOptions = {},
): string | null {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return null;
  if (lat == null || lon == null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const size = opts.size && SIZE_PATTERN.test(opts.size) ? opts.size : '800x500';
  const fov = Number.isFinite(opts.fov) ? opts.fov : 90;
  const pitch = Number.isFinite(opts.pitch) ? opts.pitch : 5;
  const radius = Number.isFinite(opts.radius) ? opts.radius : 200;

  // URLSearchParams encodes every value - no raw string can break out
  // into a second query param the way the old template literal allowed.
  const params = new URLSearchParams({
    size,
    location: `${lat},${lon}`,
    key,
    fov: String(fov),
    pitch: String(pitch),
    radius: String(radius),
    source: 'outdoor',
    return_error_codes: 'true',
  });
  return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;
}

/**
 * The URL any CLIENT-facing response should actually use — points at our
 * own /property/street-view-image proxy instead of Google's endpoint, so
 * GOOGLE_API_KEY (a server-only credential) never reaches the browser.
 * The proxy route rebuilds the real Google URL (via buildStreetViewUrl
 * above) and streams the image bytes back itself (security review, 13 Oct
 * 2026 - this used to ship the key directly in every property's imageUrl).
 * Same null-if-no-coords/no-key semantics as buildStreetViewUrl, so
 * callers that already treat null as "no image available" need no change.
 */
export function proxiedStreetViewUrl(
  lat: number | null | undefined,
  lon: number | null | undefined,
  opts: BuildStreetViewOptions = {},
): string | null {
  if (!process.env.GOOGLE_API_KEY) return null;
  if (lat == null || lon == null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  if (opts.size) params.set('size', opts.size);
  if (opts.fov != null) params.set('fov', String(opts.fov));
  if (opts.pitch != null) params.set('pitch', String(opts.pitch));
  if (opts.radius != null) params.set('radius', String(opts.radius));
  return `${BASE_URL}/property/street-view-image?${params.toString()}`;
}

/**
 * Given a property row (or partial), return the imageUrl the response
 * should use. If we have lat/lon, ALWAYS rebuild from the current env
 * key — this makes the DB's stored imageUrl a cache, not a source of
 * truth, so a key rotation heals every stored row for free.
 *
 * Falls back to whatever's stored when we don't have coordinates.
 */
export function resolveStreetViewUrl(property: {
  latitude?: number | null;
  longitude?: number | null;
  imageUrl?: string | null;
}): string | null {
  const rebuilt = proxiedStreetViewUrl(property.latitude, property.longitude);
  if (rebuilt) return rebuilt;
  return property.imageUrl ?? null;
}
