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

/**
 * Build a Google Street View Static image URL for a lat/lon. Returns
 * null if we don't have coordinates or a Google key at all — callers
 * treat null as "no image available" (the frontend renders a fallback
 * placeholder in that case).
 */
export function buildStreetViewUrl(
  lat: number | null | undefined,
  lon: number | null | undefined,
  opts: BuildStreetViewOptions = {},
): string | null {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return null;
  if (lat == null || lon == null) return null;

  const size = opts.size ?? '800x500';
  const fov = opts.fov ?? 90;
  const pitch = opts.pitch ?? 5;
  const radius = opts.radius ?? 200;

  return (
    `https://maps.googleapis.com/maps/api/streetview` +
    `?size=${size}&location=${lat},${lon}&key=${key}` +
    `&fov=${fov}&pitch=${pitch}&radius=${radius}` +
    `&source=outdoor&return_error_codes=true`
  );
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
  const rebuilt = buildStreetViewUrl(property.latitude, property.longitude);
  if (rebuilt) return rebuilt;
  return property.imageUrl ?? null;
}
