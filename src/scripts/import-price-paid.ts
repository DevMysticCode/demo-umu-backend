/**
 * HM Land Registry Price Paid Data importer
 *
 * Downloads yearly CSV files from the Land Registry open data S3 bucket and
 * bulk-inserts them into the local `PricePaidTransaction` table.
 *
 * Usage:
 *   npm run import:price-paid               # imports last 5 years
 *   npm run import:price-paid -- --from=2015 --to=2024
 *   npm run import:price-paid -- --monthly  # monthly update file only
 *
 * Ensure DATABASE_URL is set in your .env before running.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { Readable } from 'stream';

// Load .env
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
const BATCH_SIZE = 500;

// ── CSV ────────────────────────────────────────────────────────────────────────

/**
 * Parses a single CSV line using a minimal state machine.
 * Land Registry format: every field is double-quoted, comma separated.
 */
function parseCsvLine(line: string): string[] | null {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.length >= 14 ? fields : null;
}

/**
 * Maps a parsed CSV row to a PricePaidTransaction record.
 * CSV column order (no header in Land Registry files):
 * 0  Transaction ID  {GUID}
 * 1  Price
 * 2  Date of transfer  YYYY-MM-DD HH:MM
 * 3  Postcode
 * 4  Property type  D/S/T/F/O
 * 5  Old/New  Y=new build
 * 6  Duration/Tenure  F/L/U
 * 7  PAON  (house number / name)
 * 8  SAON  (flat / unit)
 * 9  Street
 * 10 Locality
 * 11 Town/City
 * 12 District
 * 13 County
 * 14 PPD Category  A/B
 * 15 Record status  A/C/D  (monthly file only)
 */
function mapRow(fields: string[]): Prisma.PricePaidTransactionCreateManyInput | null {
  const transactionId = fields[0].replace(/[{}]/g, '').trim();
  const price = parseInt(fields[1], 10);
  const dateStr = fields[2].trim();
  const postcode = fields[3].toUpperCase().trim();

  if (!transactionId || !price || isNaN(price) || !postcode || !dateStr) return null;

  const transactionDate = new Date(dateStr);
  if (isNaN(transactionDate.getTime())) return null;

  return {
    transactionId,
    price,
    transactionDate,
    postcode,
    propertyType: fields[4]?.trim() || null,
    isNewBuild: fields[5]?.trim() === 'Y',
    tenure: fields[6]?.trim() || null,
    paon: fields[7]?.trim() || null,
    saon: fields[8]?.trim() || null,
    street: fields[9]?.trim() || null,
    locality: fields[10]?.trim() || null,
    town: fields[11]?.trim() || null,
    district: fields[12]?.trim() || null,
    county: fields[13]?.trim() || null,
    category: fields[14]?.trim() || null,
  };
}

// ── Download & import ─────────────────────────────────────────────────────────

async function importUrl(label: string, url: string): Promise<number> {
  process.stdout.write(`  Downloading ${label}...\n`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }

  const nodeStream = Readable.fromWeb(res.body as any);

  let buffer = '';
  let batch: Prisma.PricePaidTransactionCreateManyInput[] = [];
  let total = 0;
  let skipped = 0;

  const flushBatch = async () => {
    if (batch.length === 0) return;
    try {
      const result = await prisma.pricePaidTransaction.createMany({
        data: batch,
        skipDuplicates: true,
      });
      total += result.count;
      skipped += batch.length - result.count;
    } catch (err) {
      console.error('\n  Batch insert error:', err);
    }
    batch = [];
    process.stdout.write(`\r  Inserted ${total.toLocaleString()} rows (${skipped.toLocaleString()} skipped)...`);
  };

  for await (const chunk of nodeStream) {
    buffer += (chunk as Buffer).toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const fields = parseCsvLine(trimmed);
      if (!fields) continue;
      const record = mapRow(fields);
      if (record) batch.push(record);

      if (batch.length >= BATCH_SIZE) {
        await flushBatch();
      }
    }
  }

  // Flush remainder
  if (buffer.trim()) {
    const fields = parseCsvLine(buffer.trim());
    if (fields) {
      const record = mapRow(fields);
      if (record) batch.push(record);
    }
  }
  await flushBatch();

  process.stdout.write(`\r  ${label}: ${total.toLocaleString()} inserted, ${skipped.toLocaleString()} already existed.\n`);
  return total;
}

// ── Entry point ───────────────────────────────────────────────────────────────

const BASE_URL = 'https://price-paid-data.publicdata.landregistry.gov.uk';

async function main() {
  const args = process.argv.slice(2);
  const monthlyOnly = args.includes('--monthly');
  const fromArg = args.find((a) => a.startsWith('--from='));
  const toArg = args.find((a) => a.startsWith('--to='));

  const currentYear = new Date().getFullYear();
  const fromYear = fromArg ? parseInt(fromArg.split('=')[1], 10) : currentYear - 4;
  const toYear = toArg ? parseInt(toArg.split('=')[1], 10) : currentYear;

  console.log('\nHM Land Registry Price Paid Data importer');
  console.log('==========================================');

  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  await prisma.$connect();

  let grandTotal = 0;

  if (monthlyOnly) {
    // Monthly update file — covers the most recent month
    const url = `${BASE_URL}/pp-monthly-update-new-version.csv`;
    grandTotal += await importUrl('Monthly update', url);
  } else {
    console.log(`Importing years ${fromYear}–${toYear}\n`);
    for (let year = fromYear; year <= toYear; year++) {
      const url = `${BASE_URL}/pp-${year}.csv`;
      try {
        grandTotal += await importUrl(`${year}`, url);
      } catch (err) {
        console.warn(`  Skipped ${year}: ${(err as Error).message}`, (err as any).cause ?? '');
      }
    }

    // Always also pull the monthly update to get the most recent transactions
    try {
      const monthlyUrl = `${BASE_URL}/pp-monthly-update-new-version.csv`;
      grandTotal += await importUrl('Monthly update (latest)', monthlyUrl);
    } catch (err) {
      console.warn(`  Monthly update skipped: ${(err as Error).message}`);
    }
  }

  console.log(`\nDone. Total rows inserted: ${grandTotal.toLocaleString()}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Import failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
