import { ForbiddenException } from '@nestjs/common';
import { timingSafeStringEqual } from './timing-safe-equal';

// Security/launch review finding #8 (2026-11-16): the admin/maintenance/
// verifier-org endpoints were gated only by ADMIN_SECRET in a header - one
// shared static value with no network restriction and no per-operator
// identity. Full SSO behind MFA is the eventual real fix but is a separate
// product decision (which provider, who counts as an "admin") - this adds
// the other half the finding called out and can ship today: an IP
// allowlist, enforced server-side so it can't be bypassed by anything the
// client controls.
//
// Deliberately opt-in via ADMIN_IP_ALLOWLIST: an unset/empty value means
// "not configured yet" and the check is skipped entirely (today's
// behaviour, unchanged) rather than failing boot or locking everyone out
// the moment this ships - Railway/AWS's env vars have to be set by
// whoever holds that access before this actually restricts anything.
// Once set, it's enforced in every environment, not just production -
// there's no safe "test without restriction" mode for something that
// deletes data.
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

// Proxies (and Node itself on a dual-stack socket) often report an IPv4
// client as ::ffff:a.b.c.d - strip that prefix so a plain IPv4 allowlist
// entry still matches.
function normaliseIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export function isIpAllowed(ip: string | undefined, allowlist: string): boolean {
  if (!ip) return false;
  const clean = normaliseIp(ip.trim());
  const entries = allowlist
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  return entries.some((entry) => {
    if (!entry.includes('/')) return entry === clean;

    const [range, bitsStr] = entry.split('/');
    const bits = Number(bitsStr);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const rangeInt = ipv4ToInt(range);
    const ipInt = ipv4ToInt(clean);
    if (rangeInt === null || ipInt === null) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (rangeInt & mask) === (ipInt & mask);
  });
}

type AdminGuardLogger = { warn: (message: string) => void };

/**
 * Combined admin-access check: IP allowlist (if ADMIN_IP_ALLOWLIST is
 * configured) then the shared secret, constant-time. Throws
 * ForbiddenException and logs the outcome either way - callers should not
 * also log success/failure themselves for the same call.
 */
export function assertAdminAccess(params: {
  secret: string | undefined;
  ip: string;
  route: string;
  logger: AdminGuardLogger;
}): void {
  const { secret, ip, route, logger } = params;
  const allowlist = process.env.ADMIN_IP_ALLOWLIST ?? '';

  if (allowlist.trim() && !isIpAllowed(ip, allowlist)) {
    logger.warn(`admin call: route=${route} ip=${ip} result=DENIED (ip not allowlisted)`);
    throw new ForbiddenException('Not allowed from this network');
  }

  const expected = process.env.ADMIN_SECRET;
  const ok = !!expected && timingSafeStringEqual(secret, expected);
  logger.warn(`admin call: route=${route} ip=${ip} result=${ok ? 'ALLOWED' : 'DENIED'}`);
  if (!ok) {
    throw new ForbiddenException('Invalid or missing admin secret');
  }
}
