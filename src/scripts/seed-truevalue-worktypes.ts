/**
 * Seeds the TrueValue work-type catalogue — a direct port of the
 * umu-truevalue-prototype.html CATALOGUE array (104 items). Idempotent:
 * upserts by `code`, safe to re-run after editing values below.
 *
 * Usage: npm run seed:truevalue
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
      const [, key, value] = match;
      if (!process.env[key]) process.env[key] = value.trim().replace(/^"|"$/g, '');
    }
  }
}

interface Row {
  id: string;
  label: string;
  cat: 'capital' | 'condition' | 'energy' | 'consent' | 'risk';
  tier: 0 | 1 | 2 | 3;
  low?: number;
  high?: number;
  doc?: string;
  minor?: 1;
  epc?: 1;
  common?: 1;
  warn?: string;
}

// prettier-ignore
const CATALOGUE: Row[] = [
  // --- capital ---
  { id: 'ext-rear', label: 'Rear extension', cat: 'capital', tier: 1, low: .05, high: .11, doc: 'Building control', common: 1 },
  { id: 'ext-side', label: 'Side extension', cat: 'capital', tier: 1, low: .04, high: .09, doc: 'Building control' },
  { id: 'ext-two', label: 'Two-storey extension', cat: 'capital', tier: 1, low: .08, high: .14, doc: 'Building control' },
  { id: 'loft-dormer', label: 'Loft conversion - dormer', cat: 'capital', tier: 1, low: .10, high: .15, doc: 'Building control', common: 1 },
  { id: 'loft-velux', label: 'Loft conversion - rooflight', cat: 'capital', tier: 1, low: .08, high: .12, doc: 'Building control' },
  { id: 'loft-mansard', label: 'Loft conversion - mansard', cat: 'capital', tier: 1, low: .10, high: .15, doc: 'Building control' },
  { id: 'garage-conv', label: 'Garage conversion', cat: 'capital', tier: 1, low: .10, high: .15, doc: 'Building control' },
  { id: 'basement', label: 'Basement conversion', cat: 'capital', tier: 1, low: .08, high: .14, doc: 'Building control + tanking guarantee' },
  { id: 'annexe', label: 'Annexe / granny flat', cat: 'capital', tier: 1, low: .08, high: .14, doc: 'Planning + building control' },
  { id: 'garden-room', label: 'Garden room', cat: 'capital', tier: 1, low: .02, high: .05, doc: 'Invoice' },
  { id: 'conservatory', label: 'Conservatory', cat: 'capital', tier: 1, low: .03, high: .07, doc: 'Invoice' },
  { id: 'orangery', label: 'Orangery', cat: 'capital', tier: 1, low: .04, high: .08, doc: 'Building control' },
  { id: 'porch', label: 'Porch', cat: 'capital', tier: 1, low: .01, high: .03, doc: 'Invoice' },
  { id: 'kitchen', label: 'New kitchen', cat: 'capital', tier: 1, low: .05, high: .10, doc: 'Invoice', common: 1 },
  { id: 'knock-through', label: 'Open-plan knock-through', cat: 'capital', tier: 1, low: .03, high: .06, doc: 'Building control + calcs' },
  { id: 'bathroom', label: 'New bathroom', cat: 'capital', tier: 1, low: .03, high: .05, doc: 'Invoice', common: 1 },
  { id: 'ensuite', label: 'En-suite added', cat: 'capital', tier: 1, low: .03, high: .06, doc: 'Invoice' },
  { id: 'wc', label: 'Downstairs WC added', cat: 'capital', tier: 1, low: .02, high: .04, doc: 'Invoice' },
  { id: 'utility', label: 'Utility room', cat: 'capital', tier: 1, low: .01, high: .03, doc: 'Invoice' },
  { id: 'wall-removed', label: 'Load-bearing wall removed', cat: 'capital', tier: 1, low: .02, high: .04, doc: 'Building control + calcs' },
  { id: 'garage-built', label: 'Garage built', cat: 'capital', tier: 1, low: .03, high: .08, doc: 'Planning / building control' },
  { id: 'carport', label: 'Carport', cat: 'capital', tier: 1, low: .01, high: .03, doc: 'Invoice' },
  { id: 'driveway', label: 'Driveway / parking', cat: 'capital', tier: 1, low: .05, high: .10, doc: 'Invoice', common: 1 },
  { id: 'landscaping', label: 'Landscaping', cat: 'capital', tier: 1, low: .01, high: .03, doc: 'Invoice' },
  { id: 'pool', label: 'Swimming pool', cat: 'capital', tier: 1, low: .00, high: .04, doc: 'Building control' },
  // --- condition: heating & plumbing ---
  { id: 'heating-full', label: 'Full central heating (where none)', cat: 'condition', tier: 1, doc: 'Gas Safe / Benchmark', epc: 1, common: 1 },
  { id: 'boiler', label: 'New boiler', cat: 'condition', tier: 1, doc: 'Benchmark + Gas Safe', epc: 1, common: 1 },
  { id: 'radiators', label: 'Radiators replaced', cat: 'condition', tier: 1, minor: 1, doc: 'Invoice' },
  { id: 'ufh', label: 'Underfloor heating', cat: 'condition', tier: 1, doc: 'Invoice', epc: 1 },
  { id: 'cylinder', label: 'Unvented hot water cylinder', cat: 'condition', tier: 1, minor: 1, doc: 'G3 certificate', epc: 1 },
  { id: 'replumb', label: 'Full replumb', cat: 'condition', tier: 1, doc: 'Invoice' },
  { id: 'water-main', label: 'Lead water main replaced', cat: 'condition', tier: 2, doc: 'Water board / invoice' },
  { id: 'boiler-move', label: 'Boiler relocated', cat: 'condition', tier: 3, doc: 'Gas Safe' },
  // --- condition: electrical ---
  { id: 'rewire', label: 'Full rewire', cat: 'condition', tier: 1, doc: 'Electrical installation cert', common: 1 },
  { id: 'rewire-part', label: 'Partial rewire', cat: 'condition', tier: 1, minor: 1, doc: 'Minor works cert' },
  { id: 'consumer-unit', label: 'New consumer unit', cat: 'condition', tier: 1, minor: 1, doc: 'EIC / minor works' },
  { id: 'lighting-circuits', label: 'Lighting circuits rewired', cat: 'condition', tier: 1, minor: 1, doc: 'Minor works cert', epc: 1 },
  { id: 'lighting-led', label: 'LED lighting throughout', cat: 'condition', tier: 3, doc: 'Invoice', epc: 1 },
  { id: 'ev', label: 'EV charger', cat: 'condition', tier: 1, minor: 1, doc: 'Installer cert / OZEV' },
  { id: 'ext-lighting', label: 'External lighting', cat: 'condition', tier: 3, doc: 'Invoice' },
  { id: 'smart-home', label: 'Smart home / CAT6', cat: 'condition', tier: 3, doc: 'Invoice' },
  // --- condition: fabric & structure ---
  { id: 'roof', label: 'New roof', cat: 'condition', tier: 1, doc: 'Guarantee + invoice', epc: 1, common: 1 },
  { id: 'flat-roof', label: 'Flat roof replaced', cat: 'condition', tier: 1, doc: 'Guarantee', epc: 1 },
  { id: 'roof-repair', label: 'Roof repairs / ridge re-pointing', cat: 'condition', tier: 2, doc: 'Invoice' },
  { id: 'chimney-removed', label: 'Chimney removed', cat: 'condition', tier: 1, minor: 1, doc: 'Building control' },
  { id: 'chimney-lined', label: 'Chimney re-lined', cat: 'condition', tier: 2, doc: 'HETAS / invoice' },
  { id: 'repointing', label: 'Repointing', cat: 'condition', tier: 2, doc: 'Invoice' },
  { id: 'render', label: 'Rendering / external finish', cat: 'condition', tier: 1, doc: 'Invoice', epc: 1 },
  { id: 'dpc', label: 'Damp proof course', cat: 'condition', tier: 2, doc: 'PCA guarantee' },
  { id: 'timber', label: 'Timber / woodworm treatment', cat: 'condition', tier: 2, doc: 'PCA guarantee' },
  { id: 'wall-ties', label: 'Cavity wall tie replacement', cat: 'condition', tier: 2, doc: 'Guarantee' },
  { id: 'underpin', label: 'Underpinning / subsidence works', cat: 'condition', tier: 2, doc: 'Engineer + building control' },
  { id: 'structural', label: 'Structural repairs', cat: 'condition', tier: 2, doc: "Engineer's report" },
  { id: 'gutters', label: 'Guttering / fascias / soffits', cat: 'condition', tier: 2, doc: 'Invoice' },
  { id: 'glazing', label: 'Double glazing', cat: 'condition', tier: 1, doc: 'FENSA / CERTASS', epc: 1, common: 1 },
  { id: 'triple', label: 'Triple glazing', cat: 'condition', tier: 1, doc: 'FENSA / CERTASS', epc: 1 },
  { id: 'secondary', label: 'Secondary glazing', cat: 'condition', tier: 1, minor: 1, doc: 'Invoice', epc: 1 },
  { id: 'ext-doors', label: 'External doors replaced', cat: 'condition', tier: 1, minor: 1, doc: 'FENSA / CERTASS', epc: 1 },
  { id: 'bifold', label: 'Bi-fold / patio doors', cat: 'condition', tier: 1, doc: 'FENSA / building control', epc: 1 },
  { id: 'int-doors', label: 'Internal doors', cat: 'condition', tier: 3, doc: 'Invoice' },
  { id: 'replaster', label: 'Replastering', cat: 'condition', tier: 1, minor: 1, doc: 'Invoice' },
  { id: 'screed', label: 'Floor screed / subfloor', cat: 'condition', tier: 2, doc: 'Invoice' },
  // --- condition: presentation ---
  { id: 'flooring', label: 'New flooring', cat: 'condition', tier: 1, minor: 1, doc: 'Invoice', common: 1 },
  { id: 'carpets', label: 'New carpets', cat: 'condition', tier: 1, minor: 1, doc: 'Invoice' },
  { id: 'decor', label: 'Redecoration', cat: 'condition', tier: 1, minor: 1, doc: 'Photos / invoice' },
  { id: 'wardrobes', label: 'Fitted wardrobes', cat: 'condition', tier: 3, doc: 'Invoice' },
  { id: 'skirting', label: 'Skirting & architrave', cat: 'condition', tier: 3, doc: 'Invoice' },
  { id: 'softener', label: 'Water softener', cat: 'condition', tier: 3, doc: 'Invoice' },
  // --- energy ---
  { id: 'loft-insul', label: 'Loft insulation', cat: 'energy', tier: 1, doc: 'Invoice / grant paperwork', epc: 1, common: 1 },
  { id: 'cavity', label: 'Cavity wall insulation', cat: 'energy', tier: 1, doc: 'CIGA guarantee', epc: 1 },
  { id: 'iwi', label: 'Solid wall insulation - internal', cat: 'energy', tier: 1, doc: 'Invoice / guarantee', epc: 1 },
  { id: 'ewi', label: 'Solid wall insulation - external', cat: 'energy', tier: 1, doc: 'Invoice / guarantee', epc: 1 },
  { id: 'floor-insul', label: 'Floor insulation', cat: 'energy', tier: 1, doc: 'Invoice', epc: 1 },
  { id: 'rir-insul', label: 'Room-in-roof insulation', cat: 'energy', tier: 1, doc: 'Invoice', epc: 1 },
  { id: 'solar', label: 'Solar PV panels', cat: 'energy', tier: 1, doc: 'MCS certificate', epc: 1, common: 1 },
  { id: 'solar-thermal', label: 'Solar thermal', cat: 'energy', tier: 1, doc: 'MCS certificate', epc: 1 },
  { id: 'battery', label: 'Battery storage', cat: 'energy', tier: 1, minor: 1, doc: 'MCS / installer cert', epc: 1 },
  { id: 'ashp', label: 'Air source heat pump', cat: 'energy', tier: 1, doc: 'MCS certificate', epc: 1 },
  { id: 'gshp', label: 'Ground source heat pump', cat: 'energy', tier: 1, doc: 'MCS certificate', epc: 1 },
  { id: 'biomass', label: 'Biomass boiler', cat: 'energy', tier: 1, doc: 'HETAS / MCS', epc: 1 },
  { id: 'storage-heaters', label: 'High retention storage heaters', cat: 'energy', tier: 1, minor: 1, doc: 'Invoice', epc: 1 },
  { id: 'mvhr', label: 'MVHR ventilation', cat: 'energy', tier: 1, minor: 1, doc: 'Invoice', epc: 1 },
  { id: 'jacket', label: 'Cylinder insulation / jacket', cat: 'energy', tier: 3, doc: 'Invoice', epc: 1 },
  { id: 'draught', label: 'Draught proofing', cat: 'energy', tier: 3, doc: 'Invoice', epc: 1 },
  { id: 'programmer', label: 'Heating programmer', cat: 'energy', tier: 3, doc: 'Invoice', epc: 1 },
  { id: 'thermostat', label: 'Room thermostat', cat: 'energy', tier: 3, doc: 'Invoice', epc: 1 },
  { id: 'trv', label: 'TRVs on radiators', cat: 'energy', tier: 3, doc: 'Invoice', epc: 1 },
  { id: 'smart-stat', label: 'Smart thermostat', cat: 'energy', tier: 3, doc: 'Invoice', epc: 1 },
  { id: 'zoning', label: 'Zoned heating controls', cat: 'energy', tier: 3, doc: 'Invoice', epc: 1 },
  { id: 'wwhr', label: 'Waste water heat recovery', cat: 'energy', tier: 3, doc: 'Invoice', epc: 1 },
  // --- consents ---
  { id: 'planning', label: 'Planning permission (unbuilt)', cat: 'consent', tier: 1, low: .02, high: .05, doc: 'Decision notice' },
  { id: 'outline', label: 'Outline planning permission', cat: 'consent', tier: 1, low: .01, high: .03, doc: 'Decision notice' },
  { id: 'ldc', label: 'Lawful Development Certificate', cat: 'consent', tier: 2, doc: 'LDC' },
  { id: 'bregs', label: 'Building regs completion cert', cat: 'consent', tier: 2, doc: 'Completion certificate' },
  { id: 'listed', label: 'Listed building consent', cat: 'consent', tier: 2, doc: 'Consent notice' },
  { id: 'party-wall', label: 'Party wall agreement', cat: 'consent', tier: 2, doc: 'Signed award' },
  { id: 'covenant', label: 'Covenant released / indemnity', cat: 'consent', tier: 2, doc: 'Deed / policy' },
  // --- risk & disclosure ---
  { id: 'spray-foam', label: 'Spray foam loft insulation', cat: 'risk', tier: 0, doc: 'Installer paperwork', warn: 'Frequently blocks mortgage lending. Recorded and flagged - never scored as an improvement.' },
  { id: 'knotweed', label: 'Japanese knotweed - treated', cat: 'risk', tier: 2, doc: 'PCA plan + guarantee', warn: 'The transferable guarantee is what a lender wants to see.' },
  { id: 'subsidence', label: 'Subsidence history', cat: 'risk', tier: 0, doc: 'Engineer + insurer letters', warn: 'Material to lending and insurance. Flagged for disclosure.' },
  { id: 'flood', label: 'Flood history', cat: 'risk', tier: 0, doc: 'Flood report', warn: 'Flagged for disclosure.' },
  { id: 'no-bregs', label: 'Work without building regs', cat: 'risk', tier: 0, doc: '-', warn: 'Likely discount or indemnity policy. Flagged for the Passport.' },
  { id: 'cladding', label: 'Cladding concern', cat: 'risk', tier: 0, doc: 'EWS1 / fire report', warn: 'Material to lending.' },
  { id: 'asbestos', label: 'Asbestos present', cat: 'risk', tier: 0, doc: 'Survey', warn: 'Flagged for disclosure.' },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    let i = 0;
    for (const row of CATALOGUE) {
      await prisma.workType.upsert({
        where: { code: row.id },
        create: {
          code: row.id,
          label: row.label,
          category: row.cat,
          tier: row.tier,
          upliftLow: row.low ?? null,
          upliftHigh: row.high ?? null,
          isMinor: !!row.minor,
          epcAssessed: !!row.epc,
          docRequired: row.doc ?? null,
          warningText: row.warn ?? null,
          isCommon: !!row.common,
          sortOrder: i,
        },
        update: {
          label: row.label,
          category: row.cat,
          tier: row.tier,
          upliftLow: row.low ?? null,
          upliftHigh: row.high ?? null,
          isMinor: !!row.minor,
          epcAssessed: !!row.epc,
          docRequired: row.doc ?? null,
          warningText: row.warn ?? null,
          isCommon: !!row.common,
          sortOrder: i,
        },
      });
      i++;
    }
    console.log(`✓ Seeded ${CATALOGUE.length} work types.`);

    const count = await prisma.workType.count();
    console.log(`Total WorkType rows in DB: ${count}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
