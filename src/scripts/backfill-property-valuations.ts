/**
 * One-off backfill: replace the crude ingestion-time synthetic estimate
 * (postcode-area price/sqm x an assumed 80sqm floor area, see
 * PropertyService's OS/EPC ingestion loops) with a real HPI-adjusted
 * figure from Land Registry sold-price history, for every property that
 * was created BEFORE the eager scheduleValuationCorrection() fix existed.
 *
 * Newly-ingested properties self-correct within seconds of being searched
 * (see PropertyService.scheduleValuationCorrection). This script is the
 * one-time cleanup pass for rows that predate that fix and were never
 * individually viewed (which was previously the only thing that triggered
 * a correction, via computeEnrichment).
 *
 * Fetches Land Registry's Price Paid CSV once per DISTINCT postcode in the
 * table (not once per property), so a 10-property street costs one
 * external call. There's a small delay between postcodes to stay polite
 * to landregistry.data.gov.uk.
 *
 * Usage:
 *   npm run backfill:valuations -- --dry-run        # preview only, no writes
 *   npm run backfill:valuations                      # apply for real
 *   npm run backfill:valuations -- --limit=50         # first 50 postcodes only (testing)
 */

import { PrismaClient } from '@prisma/client';

const path = require('path');
const fs = require('fs');
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (match) {
      const key = match[1];
      const val = match[2].replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes('--dry-run');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const POSTCODE_LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

// ── HPI multiplier — identical table to PropertyService.hpiMultiplier ──────
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

function normalisePostcode(raw: string): string {
  const s = raw.replace(/\s+/g, '').toUpperCase();
  return s.length >= 5 ? `${s.slice(0, -3)} ${s.slice(-3)}` : s;
}

interface RawSaleRow {
  price: number;
  date: string;
  saon: string;
  paon: string;
}

function parseCsvRow(line: string): string[] {
  const result: string[] = [];
  let cur = '', inQuote = false;
  for (const ch of line) {
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ',' && !inQuote) { result.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  result.push(cur.trim());
  return result;
}

async function fetchPostcodeSalesRows(postcode: string): Promise<RawSaleRow[]> {
  const formatted = normalisePostcode(postcode);
  const url = `https://landregistry.data.gov.uk/app/ppd/ppd_data.csv?postcode=${encodeURIComponent(formatted)}&limit=100`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  const csv = await res.text();
  const lines = csv.trim().split('\n').filter(Boolean);
  return lines
    .map((line) => {
      const cols = parseCsvRow(line);
      const [, price, date, , , , , saon, paon] = cols;
      return {
        price: parseInt(price?.replace(/"/g, '') ?? '0') || 0,
        date: date?.replace(/"/g, '') ?? '',
        saon: (saon ?? '').replace(/"/g, ''),
        paon: (paon ?? '').replace(/"/g, ''),
      };
    })
    .filter((r) => r.price > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
}

function matchThisProperty(allSales: RawSaleRow[], addressLine1: string): RawSaleRow[] {
  const cleanAddr = addressLine1
    .replace(/^(flat|apartment|unit|floor)\s+[\dA-Z]+[,\s]+/i, '')
    .trim();
  const paonRaw =
    cleanAddr.match(/^(\d+[A-Z]?)/i)?.[1]?.trim().toUpperCase() ??
    cleanAddr.match(/^([A-Z][^,\d]+?)(?:,|\s+\d)/i)?.[1]?.trim().toUpperCase() ??
    '';
  if (!paonRaw) return [];
  return allSales.filter(
    (r) => r.paon.toUpperCase() === paonRaw || r.saon.toUpperCase() === paonRaw,
  );
}

function computeEstimate(allSales: RawSaleRow[], addressLine1: string): number | null {
  const thisProperty = matchThisProperty(allSales, addressLine1);
  if (thisProperty.length > 0) {
    const mostRecent = thisProperty[0];
    const soldYear = parseInt((mostRecent.date ?? '').substring(0, 4)) || 0;
    if (soldYear >= 1990 && mostRecent.price > 0) {
      return Math.round((mostRecent.price * hpiMultiplier(soldYear)) / 1000) * 1000;
    }
  }
  // Fallback: median of nearby recent sales
  const paonSet = new Set(thisProperty.map((r) => r.paon.toUpperCase()));
  const recent = allSales
    .filter((r) => !paonSet.has(r.paon.toUpperCase()))
    .filter((s) => s.date >= `${new Date().getFullYear() - 5}-01-01` && s.price > 0)
    .slice(0, 10);
  if (recent.length >= 3) {
    const sorted = [...recent].sort((a, b) => a.price - b.price);
    const median = sorted[Math.floor(sorted.length / 2)].price;
    const soldYear = parseInt((recent[0].date ?? '').substring(0, 4)) || 2022;
    return Math.round((median * hpiMultiplier(soldYear)) / 1000) * 1000;
  }
  return null;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`=== Property valuation backfill ${DRY_RUN ? '(DRY RUN - no writes)' : '(LIVE - will write)'} ===`);

  const properties = await prisma.property.findMany({
    select: { id: true, postcode: true, addressLine1: true, estimatedPrice: true },
  });

  const byPostcode = new Map<string, typeof properties>();
  for (const p of properties) {
    if (!p.postcode) continue;
    const list = byPostcode.get(p.postcode) ?? [];
    list.push(p);
    byPostcode.set(p.postcode, list);
  }

  const postcodes = [...byPostcode.keys()].slice(0, POSTCODE_LIMIT);
  console.log(`${properties.length} properties across ${byPostcode.size} distinct postcodes. Processing ${postcodes.length} postcode(s).`);

  let checked = 0;
  let updated = 0;
  let noLrData = 0;
  let unchanged = 0;

  for (const [i, postcode] of postcodes.entries()) {
    const props = byPostcode.get(postcode)!;
    try {
      const allSales = await fetchPostcodeSalesRows(postcode);
      if (allSales.length === 0) {
        noLrData += props.length;
        continue;
      }
      for (const p of props) {
        checked++;
        const newPrice = computeEstimate(allSales, p.addressLine1);
        if (newPrice && newPrice !== p.estimatedPrice) {
          console.log(
            `  ${p.addressLine1} (${postcode}): £${p.estimatedPrice ?? 'null'} -> £${newPrice}`,
          );
          updated++;
          if (!DRY_RUN) {
            await prisma.property.update({
              where: { id: p.id },
              data: { estimatedPrice: newPrice },
            });
          }
        } else {
          unchanged++;
        }
      }
    } catch (err) {
      console.error(`  postcode ${postcode} failed:`, (err as Error).message);
    }
    if (i % 20 === 0) {
      console.log(`--- ${i + 1}/${postcodes.length} postcodes done (checked=${checked} updated=${updated}) ---`);
    }
    await sleep(150); // stay polite to landregistry.data.gov.uk
  }

  console.log('\n=== Done ===');
  console.log(`Checked:    ${checked}`);
  console.log(`Updated:    ${updated}${DRY_RUN ? ' (would be - dry run)' : ''}`);
  console.log(`Unchanged:  ${unchanged}`);
  console.log(`No LR data: ${noLrData} (left on synthetic estimate - no sold prices for that postcode)`);
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
