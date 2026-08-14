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
import { SECTION_BONUS_POINTS, sectionBonusActionKey } from '../rewards/section-bonuses';
import { STAMP_CATALOGUE, stampActionKey } from '../rewards/stamp-catalogue';

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
// actions mint one (see stampKey below).
//
// subtitle/description/checklistItems are the PassportAchievement
// celebration's right-hand-page copy (see components/rewards/
// PassportAchievement.vue on the frontend) — kept here, not hardcoded
// per-achievement in the client, so new stamps can ship without a
// frontend release. checklistItems deliberately does NOT include a
// "Verified on <date>" line — the component always appends that itself
// from the award's completedAt, per achievement, so it isn't baked into
// seed data.
const STAMPS = [
  {
    key: 'IDENTITY_VERIFIED',
    journeyType: 'GLOBAL',
    title: 'Identity Verified',
    subtitle: "You've confirmed who you are.",
    description: 'Your identity has been securely verified, helping make your Property Passport trusted and ready for the next step.',
    checklistItems: ['Identity check complete'],
    iconAsset: '/op-icons/verify-identity/idCardChecked.png',
    tier: 1,
  },
  {
    // Key unchanged from its original "Property Claimed" naming to avoid
    // churn on already-earned rows — retitled to match UMU Stamp Reward
    // System V1 stamp (2) "Ownership Verified", same underlying trigger
    // (OWNERSHIP_VERIFIED action, below).
    key: 'FIRST_PROPERTY_PASSPORT',
    journeyType: 'OWNER',
    title: 'Ownership Verified',
    subtitle: 'Your ownership of this property is verified.',
    description: "You've claimed this property and verified your ownership, unlocking your Property Passport.",
    checklistItems: ['Property claimed', 'Ownership verified'],
    iconAsset: '/op-icons/watchThisProperty/ownerClaim.png',
    tier: 1,
  },
  {
    key: 'PASSPORT_COMPLETE',
    journeyType: 'OWNER',
    title: 'Passport Complete',
    subtitle: 'Every section is filled in.',
    description: "You've completed every section of your Property Passport, giving buyers and agents the full picture.",
    checklistItems: ['All sections complete'],
    iconAsset: '/op-icons/watchThisProperty/passportPublished.png',
    tier: 2,
  },
  {
    key: 'MOVE_READY',
    journeyType: 'OWNER',
    title: 'Move Ready',
    subtitle: 'Your home is ready to move.',
    description: 'Your property has reached sale/move-ready status — the strongest signal you can give buyers.',
    checklistItems: ['Move-ready status reached'],
    iconAsset: '/op-icons/homescore/targetPathway.png',
    tier: 3,
  },
  {
    key: 'BUYER_READY',
    journeyType: 'BUYER',
    title: 'Buyer Ready',
    subtitle: "You're a fully verified buyer.",
    description: 'Your Buyer Passport has reached fully-ready status, helping sellers take your offer seriously.',
    checklistItems: ['Buyer Passport complete'],
    iconAsset: '/op-icons/investment/handshake.png',
    tier: 2,
  },
  {
    key: 'TENANT_READY',
    journeyType: 'TENANT',
    title: 'Tenant Ready',
    subtitle: "You're ready to rent.",
    description: 'Your Tenant Passport has reached ready status, helping landlords trust your application.',
    checklistItems: ['Tenant Passport complete'],
    iconAsset: '/op-icons/investment/house.png',
    tier: 2,
  },
] as const;

// UMU Stamp Reward System V1 — one StampDefinition per STAMP_CATALOGUE
// entry (src/rewards/stamp-catalogue.ts is the single source of truth for
// title/subtitle/description/category; RewardAction rows generated from
// the same list further below). No iconAsset yet for any of these —
// StampFrame.vue's generic fallback badge covers them until real art
// exists, same pattern used for the original 6 stamps' initial rollout.
const STAMP_V1_ENTRIES = STAMP_CATALOGUE.map((s) => ({
  key: s.key,
  journeyType: 'OWNER' as const,
  title: s.title,
  subtitle: s.subtitle,
  description: s.description,
  checklistItems: null as string[] | null,
  iconAsset: null as string | null,
  tier: 1,
  category: s.category,
}));

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
    points: 500, // UMU Stamp Reward System V1 — flat 500 per stamp
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
  // Section-completion bonus is NOT a single flat action — see
  // SECTION_BONUS_ACTIONS below (generated from section-bonuses.ts,
  // one action per passport section key, points varying by the
  // section's conveyancing significance).
  // Streak milestones — repeatable across distinct streak runs, since
  // subjectId is the UTC date the milestone was hit (not a fixed value),
  // so a streak that breaks and rebuilds can earn the same milestone
  // again. See RewardsService.recordDailyActivity().
  {
    actionKey: 'STREAK_3_DAY',
    journeyType: 'GLOBAL',
    label: '3-day activity streak',
    points: 10,
    stampKey: null,
    firstTimeOnly: false,
    verificationRequired: false,
    description: 'Answered at least one question on 3 consecutive days.',
  },
  {
    actionKey: 'STREAK_7_DAY',
    journeyType: 'GLOBAL',
    label: '7-day activity streak',
    points: 25,
    stampKey: null,
    firstTimeOnly: false,
    verificationRequired: false,
    description: 'Answered at least one question on 7 consecutive days.',
  },
  {
    actionKey: 'STREAK_14_DAY',
    journeyType: 'GLOBAL',
    label: '14-day activity streak',
    points: 50,
    stampKey: null,
    firstTimeOnly: false,
    verificationRequired: false,
    description: 'Answered at least one question on 14 consecutive days.',
  },
  {
    actionKey: 'STREAK_30_DAY',
    journeyType: 'GLOBAL',
    label: '30-day activity streak',
    points: 100,
    stampKey: null,
    firstTimeOnly: false,
    verificationRequired: false,
    description: 'Answered at least one question on 30 consecutive days.',
  },
] as const;

// One action per passport section — see section-bonuses.ts for the actual
// point values and the rationale behind each one.
const SECTION_BONUS_ACTIONS = Object.entries(SECTION_BONUS_POINTS).map(([sectionKey, points]) => ({
  actionKey: sectionBonusActionKey(sectionKey),
  journeyType: 'GLOBAL' as const,
  label: `Finish the ${sectionKey} section`,
  points,
  stampKey: null,
  firstTimeOnly: true, // per-section (subjectId = passportSectionId)
  verificationRequired: false,
  description: `Bonus on top of per-question points when every task in the ${sectionKey} section is completed.`,
}));

// UMU Stamp Reward System V1 — one action per catalogue stamp, flat 500
// points each per the client spec ("Each completed stamp = 500 points"),
// each minting its matching StampDefinition (STAMP_V1_ENTRIES above).
// subjectId = passportId when awarded (see StampEvaluatorService), so a
// user earns each of these once per property/passport, not once ever.
const STAMP_V1_ACTIONS = STAMP_CATALOGUE.map((s) => ({
  actionKey: stampActionKey(s.key),
  journeyType: 'OWNER' as const,
  label: `Stamp: ${s.title}`,
  points: 500,
  stampKey: s.key,
  firstTimeOnly: true, // per-passport (subjectId = passportId)
  verificationRequired: false,
  description: s.description,
}));

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
  const allStamps = [...STAMPS, ...STAMP_V1_ENTRIES];
  for (const s of allStamps) {
    const shared = {
      journeyType: s.journeyType as any,
      title: s.title,
      subtitle: s.subtitle,
      description: s.description,
      checklistItems: s.checklistItems as any,
      iconAsset: s.iconAsset,
      tier: s.tier,
      category: (s as any).category ?? null,
    };
    await prisma.stampDefinition.upsert({
      where: { key: s.key },
      update: shared,
      create: { key: s.key, ...shared },
    });
  }
  console.log(`  ${allStamps.length} stamp definitions upserted.`);

  console.log('Seeding reward actions...');
  const allActions = [...ACTIONS, ...SECTION_BONUS_ACTIONS, ...STAMP_V1_ACTIONS];
  for (const a of allActions) {
    const { actionKey, ...rest } = a;
    await prisma.rewardAction.upsert({
      where: { actionKey },
      update: { ...rest, journeyType: rest.journeyType as any, active: (rest as any).active ?? true },
      create: { actionKey, ...rest, journeyType: rest.journeyType as any, active: (rest as any).active ?? true },
    });
  }
  console.log(`  ${allActions.length} reward actions upserted.`);

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
