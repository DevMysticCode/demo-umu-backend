/**
 * Rewards engine seed — RewardAction (the earning rules), StampDefinition
 * (milestone collectibles) and RewardCatalogueItem (display-only reward
 * tiles for the Rewards page; nothing is redeemable yet).
 *
 * Point values are the client's "Major Actions Points Framework" as
 * proposed, used as-is — adjustable later without any code change, since
 * RewardsService.award() reads `points` from this table at award time
 * rather than having values hard-coded per call site.
 *
 * Idempotent: upserts every row by its natural key. Safe to re-run.
 *
 * Usage:
 *   npm run seed:reward-actions
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

const prisma = new PrismaClient();

// ── Stamp definitions ────────────────────────────────────────────
// Deliberately rarer than RewardAction rows — only major-milestone
// actions mint one (see stampKey below). No icon/UI wired yet.
const STAMPS = [
  { key: 'IDENTITY_VERIFIED', journeyType: 'GLOBAL', title: 'Identity Verified', description: 'You completed identity verification (KYC).', tier: 1 },
  { key: 'FIRST_PROPERTY_PASSPORT', journeyType: 'OWNER', title: 'First Property Passport', description: 'You claimed your first property and verified ownership.', tier: 1 },
  { key: 'PASSPORT_COMPLETE', journeyType: 'OWNER', title: 'Passport Complete', description: 'You completed every section of your Property Passport.', tier: 2 },
  { key: 'MOVE_READY', journeyType: 'OWNER', title: 'Move Ready', description: 'Your property became sale/move ready.', tier: 3 },
  { key: 'BUYER_READY', journeyType: 'BUYER', title: 'Buyer Ready', description: 'Your Buyer Passport reached fully-ready status.', tier: 2 },
  { key: 'TENANT_READY', journeyType: 'TENANT', title: 'Tenant Ready', description: 'Your Tenant Passport reached ready status.', tier: 2 },
] as const;

// ── Reward actions — "what CAN earn points" ─────────────────────
// Note on "Landlord claims Property Passport + ownership verified" (750,
// per the client's table): this is the SAME underlying event as
// "Claim a property + verify ownership" — OwnershipVerification flipping
// to VERIFIED — the passport doesn't get typed SELLER vs LANDLORD until a
// separate, later step. Modelled as one OWNERSHIP_VERIFIED action rather
// than two, to avoid double-awarding a landlord who claims a property;
// RewardsService.award() lets the caller tag the ledger entry's
// journeyType as OWNER or LANDLORD at award time once the passport type
// is known, independent of this row's default journeyType.
const ACTIONS = [
  {
    actionKey: 'ACCOUNT_CREATED',
    journeyType: 'GLOBAL',
    label: 'Create UMU account',
    points: 250,
    stampKey: null,
    firstTimeOnly: true,
    verificationRequired: true, // pending until email/mobile verified
    description: 'First major conversion from anonymous visitor to UMU user.',
  },
  {
    actionKey: 'KYC_COMPLETED_OWNER',
    journeyType: 'OWNER',
    label: 'Complete identity/KYC',
    points: 500,
    stampKey: 'IDENTITY_VERIFIED',
    firstTimeOnly: true,
    verificationRequired: false,
    description: 'High-friction, high-value verified action.',
  },
  {
    actionKey: 'OWNERSHIP_VERIFIED',
    journeyType: 'OWNER',
    label: 'Claim a property + verify ownership',
    points: 750,
    stampKey: 'FIRST_PROPERTY_PASSPORT',
    firstTimeOnly: true, // per-property (subjectId = propertyId), not per-user-ever
    verificationRequired: false,
    description: 'Converts a searched home into a claimed, verified Property Passport. Also covers landlord claims of the same event.',
  },
  {
    actionKey: 'CORE_PASSPORT_COMPLETE',
    journeyType: 'OWNER',
    label: 'Complete core Property Passport',
    points: 1000,
    stampKey: 'PASSPORT_COMPLETE',
    firstTimeOnly: true, // per-passport (subjectId = passportId)
    verificationRequired: false,
    description: 'One of UMU’s most valuable behaviours.',
  },
  {
    actionKey: 'SALE_READY',
    journeyType: 'OWNER',
    label: 'Property becomes sale/move ready',
    points: 1500,
    stampKey: 'MOVE_READY',
    firstTimeOnly: true, // per-property/passport
    verificationRequired: false,
    // Not wired to a real trigger yet — there is no backend "move ready" /
    // sale-readiness signal today (it's currently only a frontend-derived
    // percentage). Seeded so the register is complete; RewardsService.award()
    // will not be called for this key until that signal exists server-side.
    description: 'Exceptional milestone. NOT YET WIRED — no backend move-ready signal exists.',
    active: false,
  },
  {
    actionKey: 'BUYER_PASSPORT_CREATED',
    journeyType: 'BUYER',
    label: 'Create Buyer Passport',
    points: 500,
    stampKey: null,
    firstTimeOnly: true,
    verificationRequired: false,
    description: 'Starts a meaningful buyer journey. NOT YET WIRED — Buyer Passport flow does not exist yet (PassportType.BUYER has no creation path).',
    active: false,
  },
  {
    actionKey: 'KYC_COMPLETED_BUYER',
    journeyType: 'BUYER',
    label: 'Complete Buyer KYC',
    points: 500,
    stampKey: 'IDENTITY_VERIFIED',
    firstTimeOnly: true, // per buyer passport (subjectId = buyerPassportId)
    verificationRequired: false,
    description: 'Verified buyer identity. NOT YET WIRED — see BUYER_PASSPORT_CREATED.',
    active: false,
  },
  {
    actionKey: 'AFFORDABILITY_VERIFIED_BUYER',
    journeyType: 'BUYER',
    label: 'Add & verify affordability / proof of funds',
    points: 500,
    stampKey: null,
    firstTimeOnly: true,
    verificationRequired: false,
    description: 'Makes the buyer materially more credible. NOT YET WIRED.',
    active: false,
  },
  {
    actionKey: 'MORTGAGE_AIP_ADDED_BUYER',
    journeyType: 'BUYER',
    label: 'Add Mortgage/Agreement in Principle',
    points: 500,
    stampKey: null,
    firstTimeOnly: true,
    verificationRequired: false,
    description: 'Major buyer-readiness milestone. NOT YET WIRED.',
    active: false,
  },
  {
    actionKey: 'BUYER_PASSPORT_READY',
    journeyType: 'BUYER',
    label: 'Buyer Passport fully ready',
    points: 1000,
    stampKey: 'BUYER_READY',
    firstTimeOnly: true,
    verificationRequired: false,
    description: 'Significant completion event. NOT YET WIRED.',
    active: false,
  },
  {
    actionKey: 'TENANT_PASSPORT_CREATED',
    journeyType: 'TENANT',
    label: 'Create Tenant Passport',
    points: 500,
    stampKey: null,
    firstTimeOnly: true,
    verificationRequired: false,
    description: 'Starts tenant’s verified record. NOT YET WIRED — Tenant Passport flow does not exist yet.',
    active: false,
  },
  {
    actionKey: 'KYC_COMPLETED_TENANT',
    journeyType: 'TENANT',
    label: 'Complete Tenant KYC',
    points: 500,
    stampKey: 'IDENTITY_VERIFIED',
    firstTimeOnly: true,
    verificationRequired: false,
    description: 'Verified identity. NOT YET WIRED.',
    active: false,
  },
  {
    actionKey: 'REFERENCING_EVIDENCE_TENANT',
    journeyType: 'TENANT',
    label: 'Complete affordability/referencing evidence',
    points: 500,
    stampKey: null,
    firstTimeOnly: true,
    verificationRequired: false,
    description: 'Significant tenant-readiness action. NOT YET WIRED.',
    active: false,
  },
  {
    actionKey: 'TENANT_PASSPORT_READY',
    journeyType: 'TENANT',
    label: 'Tenant Passport ready',
    points: 1000,
    stampKey: 'TENANT_READY',
    firstTimeOnly: true,
    verificationRequired: false,
    description: 'Major completion milestone. NOT YET WIRED.',
    active: false,
  },
] as const;

// ── Reward catalogue — display-only, nothing redeemable yet ─────
// The two "already unlocked-looking" example partners from the client
// mockup, plus its two explicit "Unlock at N points" locked examples.
const CATALOGUE = [
  {
    partner: 'AnyVan',
    title: '20% off removals',
    description: 'Available at launch.',
    pointsRequired: 500,
    sortOrder: 1,
  },
  {
    partner: 'Todd & Co Solicitors',
    title: '£25 off conveyancing',
    description: 'Available at launch.',
    pointsRequired: 600,
    sortOrder: 2,
  },
  {
    partner: 'Storage Partner',
    title: '10% off storage',
    description: 'Unlock at 1,500 points.',
    pointsRequired: 1500,
    sortOrder: 3,
  },
  {
    partner: 'Broadband Partner',
    title: 'Exclusive broadband offer',
    description: 'Unlock at 1,750 points.',
    pointsRequired: 1750,
    sortOrder: 4,
  },
] as const;

async function main() {
  console.log('Seeding stamp definitions...');
  for (const s of STAMPS) {
    await prisma.stampDefinition.upsert({
      where: { key: s.key },
      update: {
        journeyType: s.journeyType as any,
        title: s.title,
        description: s.description,
        tier: s.tier,
      },
      create: {
        key: s.key,
        journeyType: s.journeyType as any,
        title: s.title,
        description: s.description,
        tier: s.tier,
      },
    });
  }
  console.log(`  ${STAMPS.length} stamp definitions upserted.`);

  console.log('Seeding reward actions...');
  for (const a of ACTIONS) {
    const { actionKey, ...rest } = a;
    await prisma.rewardAction.upsert({
      where: { actionKey },
      update: { ...rest, journeyType: rest.journeyType as any, active: (rest as any).active ?? true },
      create: { actionKey, ...rest, journeyType: rest.journeyType as any, active: (rest as any).active ?? true },
    });
  }
  console.log(`  ${ACTIONS.length} reward actions upserted.`);

  console.log('Seeding reward catalogue...');
  for (const c of CATALOGUE) {
    const existing = await prisma.rewardCatalogueItem.findFirst({
      where: { partner: c.partner, title: c.title },
    });
    if (existing) {
      await prisma.rewardCatalogueItem.update({
        where: { id: existing.id },
        data: c,
      });
    } else {
      await prisma.rewardCatalogueItem.create({ data: c });
    }
  }
  console.log(`  ${CATALOGUE.length} catalogue items upserted.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
