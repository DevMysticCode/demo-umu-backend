import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as Tesseract from 'tesseract.js';
import { readFile } from 'fs/promises';

/**
 * Result of parsing an uploaded UK energy bill. All numeric fields are £/yr
 * (we normalise quarterly / monthly figures up to annual using `period`).
 * Any field can be null if the OCR couldn't find it.
 */
export interface ParsedBill {
  annualSpend: number | null;
  gasSpend: number | null;
  electricitySpend: number | null;
  supplier: string | null;
  period: 'annual' | 'quarterly' | 'monthly' | 'unknown';
  rawText: string;
}

const KNOWN_SUPPLIERS = [
  'British Gas',
  'Octopus Energy',
  'Octopus',
  'EDF',
  'EDF Energy',
  'E.ON',
  'E.ON Next',
  'EON',
  'Scottish Power',
  'SSE',
  'OVO',
  'OVO Energy',
  'Bulb',
  'Shell Energy',
  'So Energy',
  'Utilita',
  'Utility Warehouse',
  'Good Energy',
  'Pure Planet',
  'Avro Energy',
];

@Injectable()
export class BillParserService {
  private readonly logger = new Logger(BillParserService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * OCR an uploaded bill and persist the structured result on the property.
   * Returns the parsed result so the caller can echo it back to the UI.
   */
  async parseAndSave(
    propertyId: string,
    filePath: string,
    mimeType: string,
  ): Promise<ParsedBill> {
    const parsed = await this.parseBill(filePath, mimeType);
    try {
      await this.prisma.property.update({
        where: { id: propertyId },
        data: {
          actualEnergySpend: parsed.annualSpend ?? null,
          actualGasSpend: parsed.gasSpend ?? null,
          actualElectricitySpend: parsed.electricitySpend ?? null,
          actualBillSupplier: parsed.supplier ?? null,
          actualBillPeriod: parsed.period,
          actualBillRawText: parsed.rawText.slice(0, 20000),
          actualBillUploadedAt: new Date(),
        } as any,
      });
    } catch (e) {
      this.logger.warn(`Failed to persist parsed bill: ${e}`);
    }
    return parsed;
  }

  /** OCR a bill file and parse the extracted text. Pure function — no DB. */
  async parseBill(
    filePath: string,
    _mimeType: string,
  ): Promise<ParsedBill> {
    let rawText = '';
    try {
      const buffer = await readFile(filePath);
      const { data } = await Tesseract.recognize(buffer, 'eng');
      rawText = data.text || '';
    } catch (e) {
      this.logger.warn(`Tesseract OCR failed: ${e}`);
      return {
        annualSpend: null,
        gasSpend: null,
        electricitySpend: null,
        supplier: null,
        period: 'unknown',
        rawText: '',
      };
    }
    return this.extractFromText(rawText);
  }

  /**
   * Regex-based extraction over the raw OCR text. Each field has a list of
   * candidate patterns drawn from common UK utility bill layouts (British
   * Gas, Octopus, EDF, E.ON, OVO etc.). When multiple patterns match, the
   * earliest in the doc wins.
   */
  extractFromText(rawText: string): ParsedBill {
    const text = rawText.replace(/\s+/g, ' ').trim();
    return {
      annualSpend: this.findAnnualSpend(text),
      gasSpend: this.findFuelSpend(text, 'gas'),
      electricitySpend: this.findFuelSpend(text, 'electricity'),
      supplier: this.findSupplier(text),
      period: this.detectPeriod(text),
      rawText,
    };
  }

  private findAnnualSpend(text: string): number | null {
    const patterns: RegExp[] = [
      /annual\s+(?:total|cost|energy\s+cost)[^£]*£\s*([0-9,]+(?:\.\d+)?)/i,
      /(?:projected|estimated)\s+annual\s+(?:cost|spend|charge)[^£]*£\s*([0-9,]+(?:\.\d+)?)/i,
      /total\s+(?:for\s+)?(?:the\s+)?year[^£]*£\s*([0-9,]+(?:\.\d+)?)/i,
      /personal\s+projection[^£]*£\s*([0-9,]+(?:\.\d+)?)/i,
      /your\s+annual\s+(?:cost|spend)[^£]*£\s*([0-9,]+(?:\.\d+)?)/i,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) {
        const n = parseFloat(m[1].replace(/,/g, ''));
        if (Number.isFinite(n) && n > 0 && n < 100000) return Math.round(n);
      }
    }
    // Fallback: sum quarterly/monthly totals if present
    const quarterly = this.findPeriodTotal(text, /quarterly\s+(?:total|cost|charge)[^£]*£\s*([0-9,]+(?:\.\d+)?)/i);
    if (quarterly != null) return Math.round(quarterly * 4);
    const monthly = this.findPeriodTotal(text, /monthly\s+(?:total|cost|charge)[^£]*£\s*([0-9,]+(?:\.\d+)?)/i);
    if (monthly != null) return Math.round(monthly * 12);
    return null;
  }

  private findFuelSpend(
    text: string,
    fuel: 'gas' | 'electricity',
  ): number | null {
    const name = fuel === 'gas' ? 'gas' : 'electricity';
    const patterns: RegExp[] = [
      new RegExp(`${name}\\s+(?:total|cost|charges?|spend)[^£]*£\\s*([0-9,]+(?:\\.\\d+)?)`, 'i'),
      new RegExp(`total\\s+${name}\\s+(?:cost|charges?)[^£]*£\\s*([0-9,]+(?:\\.\\d+)?)`, 'i'),
      new RegExp(`${name}\\s+annual[^£]*£\\s*([0-9,]+(?:\\.\\d+)?)`, 'i'),
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) {
        const n = parseFloat(m[1].replace(/,/g, ''));
        if (Number.isFinite(n) && n > 0 && n < 100000) return Math.round(n);
      }
    }
    return null;
  }

  private findSupplier(text: string): string | null {
    // First 600 chars of a UK bill almost always include the supplier name
    // in the header / letterhead. Match case-insensitively.
    const head = text.slice(0, 1200).toLowerCase();
    for (const s of KNOWN_SUPPLIERS) {
      if (head.includes(s.toLowerCase())) return s;
    }
    return null;
  }

  private detectPeriod(
    text: string,
  ): 'annual' | 'quarterly' | 'monthly' | 'unknown' {
    if (/annual|per\s+year|\/yr|\/year/i.test(text)) return 'annual';
    if (/quarterly|per\s+quarter|3\s+month/i.test(text)) return 'quarterly';
    if (/monthly|per\s+month|\/mo\b/i.test(text)) return 'monthly';
    return 'unknown';
  }

  private findPeriodTotal(text: string, pattern: RegExp): number | null {
    const m = text.match(pattern);
    if (!m) return null;
    const n = parseFloat(m[1].replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
}
