/**
 * Test harness for the Council Tax Finder API
 * (https://api.counciltaxfinder.com/counciltaxfinder/counciltax/).
 *
 * Reads COUNCIL_TAX_FINDER_USERID + COUNCIL_TAX_FINDER_APIKEY from .env and
 * exercises all four input modes from the developer docs:
 *   1. Postcode only
 *   2. Postcode + door number
 *   3. Postcode + page=1 (list all addresses on the postcode)
 *   4. Postcode + alladdress (partial address search)
 *   5. Same as (4) but with version=3 (structured address payload)
 *
 * Run from umu-backend:
 *   npx ts-node scripts/test-council-tax-finder.ts
 *   npx ts-node scripts/test-council-tax-finder.ts NE5 2QP 30
 */

import * as fs from 'fs';
import * as path from 'path';

function loadDotenv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadDotenv();

const USERID = process.env.COUNCIL_TAX_FINDER_USERID || '';
const APIKEY = process.env.COUNCIL_TAX_FINDER_APIKEY || '';
const BASE = 'https://api.counciltaxfinder.com/counciltaxfinder/counciltax';

if (!USERID || !APIKEY) {
  console.error(
    '✖ Missing COUNCIL_TAX_FINDER_USERID or COUNCIL_TAX_FINDER_APIKEY in .env',
  );
  process.exit(1);
}

// Postcode and optional door number can be overridden on the command line so
// you can spot-check addresses you actually care about.
const argPostcode = (process.argv[2] || 'NE5 2QP').replace(/\s+/g, '');
const argDoor = process.argv[3] || '30';

type TestCase = {
  name: string;
  url: string;
};

const cases: TestCase[] = [
  {
    name: 'Postcode only (single address sample)',
    url: `${BASE}/${argPostcode}?door=&page=&userid=${USERID}&apikey=${APIKEY}`,
  },
  {
    name: `Postcode + door=${argDoor}`,
    url: `${BASE}/${argPostcode}?door=${argDoor}&page=&userid=${USERID}&apikey=${APIKEY}`,
  },
  {
    name: 'Postcode + page=1 (full street list)',
    url: `${BASE}/${argPostcode}?door=&page=1&userid=${USERID}&apikey=${APIKEY}`,
  },
  {
    name: `alladdress=${argDoor}`,
    url: `${BASE}/${argPostcode}?door=&alladdress=${encodeURIComponent(argDoor)}&page=&userid=${USERID}&apikey=${APIKEY}`,
  },
  {
    name: `alladdress + version=3`,
    url: `${BASE}/${argPostcode}?door=&alladdress=${encodeURIComponent(argDoor)}&page=&userid=${USERID}&apikey=${APIKEY}&version=3`,
  },
];

// Browser-ish headers — counciltaxfinder.com sits behind Cloudflare and
// returns 403 Forbidden to default Node fetch UAs. Mimicking Chrome's request
// surface (UA, Accept, Accept-Language, Referer) passes the basic challenge
// without needing a full JS-challenge solver.
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  Referer: 'https://www.counciltaxfinder.com/',
  Origin: 'https://www.counciltaxfinder.com',
} as const;

async function runOne(c: TestCase) {
  const t0 = Date.now();
  try {
    const res = await fetch(c.url, { headers: BROWSER_HEADERS });
    const ms = Date.now() - t0;
    const text = await res.text();
    const ct = res.headers.get('content-type') || '';
    let parsed: any = null;
    let count: number | null = null;
    try {
      parsed = JSON.parse(text);
      if (Array.isArray(parsed)) count = parsed.length;
    } catch { /* not JSON */ }

    console.log('────────────────────────────────────────');
    console.log(`▶ ${c.name}`);
    console.log(`  URL: ${c.url.replace(APIKEY, '***')}`);
    console.log(`  Status: ${res.status} ${res.statusText}  · ${ms}ms · ${ct}`);
    if (count !== null) console.log(`  Result count: ${count}`);
    if (parsed) {
      const sample = Array.isArray(parsed) ? parsed[0] : parsed;
      console.log('  First row:', JSON.stringify(sample, null, 2));
    } else {
      // Surface Cloudflare reason if present (Ray-ID, challenge type)
      const cfRay = res.headers.get('cf-ray');
      const cfMitigated = res.headers.get('cf-mitigated');
      if (cfRay || cfMitigated) {
        console.log(`  Cloudflare: cf-ray=${cfRay} cf-mitigated=${cfMitigated}`);
      }
      const titleMatch = text.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch) console.log(`  Page title: ${titleMatch[1]}`);
      console.log('  Raw body (first 800 chars):', text.slice(0, 800));
    }
  } catch (e: any) {
    console.log('────────────────────────────────────────');
    console.log(`▶ ${c.name}`);
    console.log(`  ✖ ERROR: ${e?.message ?? e}`);
  }
}

(async () => {
  console.log(
    `Council Tax Finder API test\n  userid: ${USERID}\n  apikey: ${APIKEY.replace(/.(?=.{4})/g, '*')}\n  postcode: ${argPostcode}  door: ${argDoor}`,
  );
  for (const c of cases) await runOne(c);
  console.log('────────────────────────────────────────');
  console.log('Done.');
})();
