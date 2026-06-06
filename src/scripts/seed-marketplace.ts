/**
 * Marketplace seed — categories + demo jobs.
 *
 * Idempotent: upserts categories by slug, then creates demo jobs only
 * if the jobs table is empty. Safe to re-run.
 *
 * Usage:
 *   npm run seed:marketplace
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

// Categories shown on the home grid (4×2) and the browse grid (4×3+).
// Order matters — Home shows the first 8, Browse shows everything.
const CATEGORIES = [
  { slug: 'plumbing',   name: 'Plumbing',   emoji: '🚰', background: 'linear-gradient(135deg, #00B8B0, #008A84)' },
  { slug: 'electrical', name: 'Electrical', emoji: '⚡', background: 'linear-gradient(135deg, #4A4566, #231D45)' },
  { slug: 'carpentry',  name: 'Carpentry',  emoji: '🪚', background: 'linear-gradient(135deg, #C9974A, #9A6E2C)' },
  { slug: 'painting',   name: 'Painting',   emoji: '🎨', background: 'linear-gradient(135deg, #008A84, #00635E)' },
  { slug: 'bathrooms',  name: 'Bathrooms',  emoji: '🛁', background: 'linear-gradient(135deg, #352D5C, #231D45)' },
  { slug: 'kitchens',   name: 'Kitchens',   emoji: '🍳', background: 'linear-gradient(135deg, #C9974A, #9A6E2C)' },
  { slug: 'garden',     name: 'Garden',     emoji: '🌿', background: 'linear-gradient(135deg, #008A84, #00635E)' },
  { slug: 'surveys',    name: 'Surveys',    emoji: '📐', background: 'linear-gradient(135deg, #4A4566, #231D45)' },
  // ── Extra categories surfaced on the Browse grid only ──
  { slug: 'building',   name: 'Building',   emoji: '🏗', background: 'linear-gradient(135deg, #C9974A, #9A6E2C)' },
  { slug: 'heating',    name: 'Heating',    emoji: '🔥', background: 'linear-gradient(135deg, #352D5C, #231D45)' },
  { slug: 'windows',    name: 'Windows',    emoji: '🪟', background: 'linear-gradient(135deg, #008A84, #00635E)' },
  { slug: 'cleaning',   name: 'Cleaning',   emoji: '🧽', background: 'linear-gradient(135deg, #00B8B0, #008A84)' },
];

// Photo backgrounds match the prototype's per-job gradients so the
// cards keep the same colour palette while we're running without
// real image uploads.
const DEMO_JOBS = [
  {
    categorySlug: 'bathrooms',
    title: 'Full bathroom replumb & refit',
    description: 'Complete replumb of family bathroom including new copper piping, bath, basin and toilet. Existing tiling is intact — needs careful removal and refit. Property is a 3-bed semi, second-floor bathroom, water mains accessible from airing cupboard. Looking for someone reliable to finish in one visit.',
    locationLabel: 'Bristol BS1',
    postcode: 'BS1',
    distanceMi: 1.2,
    urgency: 'urgent',
    availability: 'Available 25 Apr',
    availableDates: ['25 Apr', '28 Apr', '2 May', '9 May'],
    budgetMin: 2500,
    budgetMax: 4000,
    offerCount: 5,
    photoBg: "linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.05)), url('https://loremflickr.com/700/300/bathroom,interior?lock=1021') center/cover no-repeat, linear-gradient(135deg, #B5E8D5, #3DA66A)",
    photoBgs: [
      'linear-gradient(135deg, #352D5C, #008A84)',
      'linear-gradient(135deg, #352D5C, #008A84)',
      'linear-gradient(135deg, #352D5C, #008A84)',
      'linear-gradient(135deg, #352D5C, #008A84)',
    ],
    postedAt: hoursAgo(2),
  },
  {
    categorySlug: 'kitchens',
    title: 'Kitchen install · 12 units + worktop',
    description: '12-unit kitchen install with quartz worktop, sink, hob and integrated appliances. All units flat-packed and on-site. Wiring already in place. Looking for a fitter who can complete in 4-5 working days.',
    locationLabel: 'Bristol BS6',
    postcode: 'BS6',
    distanceMi: 3.4,
    urgency: 'flexible',
    availability: 'Flexible dates',
    availableDates: ['2 May', '9 May', '16 May'],
    budgetMin: 8000,
    budgetMax: 12000,
    offerCount: 3,
    photoBg: "linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.05)), url('https://loremflickr.com/700/300/kitchen,cabinets?lock=1022') center/cover no-repeat, linear-gradient(135deg, #FFD5B5, #E07C4F)",
    photoBgs: [
      'linear-gradient(135deg, #FFD5B5, #E07C4F)',
      'linear-gradient(135deg, #FFD5B5, #E07C4F)',
      'linear-gradient(135deg, #FFD5B5, #E07C4F)',
    ],
    postedAt: hoursAgo(24),
  },
  {
    categorySlug: 'electrical',
    title: 'EICR · 3-bed semi · electrical safety',
    description: 'EICR (Electrical Installation Condition Report) required for landlord compliance. 3-bedroom semi-detached, 2 consumer units, all sockets / lights accessible. Need certificate within a week.',
    locationLabel: 'Coventry CV5',
    postcode: 'CV5',
    distanceMi: 0.6,
    urgency: 'standard',
    availability: 'Within 7 days',
    availableDates: ['25 Apr', '28 Apr'],
    budgetMin: 850,
    budgetMax: null as number | null,
    offerCount: 7,
    photoBg: "linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.05)), url('https://loremflickr.com/700/300/electrician,wiring?lock=1023') center/cover no-repeat, linear-gradient(135deg, #FFE69E, #F5A623)",
    photoBgs: [
      'linear-gradient(135deg, #FFE69E, #F5A623)',
      'linear-gradient(135deg, #FFE69E, #F5A623)',
    ],
    postedAt: hoursAgo(4),
  },
  {
    categorySlug: 'garden',
    title: 'Lawn turf, beds & fencing',
    description: 'Front and back garden makeover. Approx 80m² of fresh turf, two raised beds, and 12m of fencing along the side boundary. All materials to be supplied by contractor.',
    locationLabel: 'Bristol BS3',
    postcode: 'BS3',
    distanceMi: 2.1,
    urgency: 'standard',
    availability: 'Spring slot',
    availableDates: ['2 May', '9 May'],
    budgetMin: 1200,
    budgetMax: null as number | null,
    offerCount: 2,
    photoBg: "linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.05)), url('https://loremflickr.com/700/300/gardener,landscaping?lock=1024') center/cover no-repeat, linear-gradient(135deg, #C5E8A8, #4ADE80)",
    photoBgs: [
      'linear-gradient(135deg, #C5E8A8, #4ADE80)',
      'linear-gradient(135deg, #C5E8A8, #4ADE80)',
    ],
    postedAt: hoursAgo(6),
  },
  {
    categorySlug: 'heating',
    title: 'Combi boiler annual service',
    description: 'Annual service for Worcester Bosch 30CDi combi boiler. Cover certificate needed afterwards. Last serviced 14 months ago.',
    locationLabel: 'Coventry CV5',
    postcode: 'CV5',
    distanceMi: 1.8,
    urgency: 'standard',
    availability: 'Within 14 days',
    availableDates: ['28 Apr', '2 May', '9 May'],
    budgetMin: 420,
    budgetMax: null as number | null,
    offerCount: 4,
    photoBg: "linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.05)), url('https://loremflickr.com/700/300/boiler,radiator?lock=1029') center/cover no-repeat, linear-gradient(135deg, #A8DAFF, #5B8DEF)",
    photoBgs: ['linear-gradient(135deg, #A8DAFF, #5B8DEF)'],
    postedAt: hoursAgo(24),
  },
  {
    categorySlug: 'painting',
    title: 'Hallway, stairs & landing repaint',
    description: 'Full repaint of hallway, stairs and landing. Walls in F&B Cornforth White, woodwork in white satin. Prep + 2 coats. All paint supplied by us.',
    locationLabel: 'Bristol BS1',
    postcode: 'BS1',
    distanceMi: 2.7,
    urgency: 'flexible',
    availability: 'Flexible',
    availableDates: ['9 May', '16 May'],
    budgetMin: 680,
    budgetMax: null as number | null,
    offerCount: 1,
    photoBg: "linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.05)), url('https://loremflickr.com/700/300/decorating,wall?lock=1030') center/cover no-repeat, linear-gradient(135deg, #E5C8FF, #9468E0)",
    photoBgs: ['linear-gradient(135deg, #E5C8FF, #9468E0)'],
    postedAt: hoursAgo(48),
  },
];

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

async function main() {
  console.log('[seed-marketplace] upserting categories…');
  for (let i = 0; i < CATEGORIES.length; i++) {
    const cat = CATEGORIES[i];
    await prisma.marketplaceCategory.upsert({
      where: { slug: cat.slug },
      create: { ...cat, sortOrder: i },
      update: { name: cat.name, emoji: cat.emoji, background: cat.background, sortOrder: i },
    });
  }
  console.log(`[seed-marketplace] ${CATEGORIES.length} categories ready`);

  // Backfill: existing seeded jobs predate the loremflickr photoBg
  // change. We re-apply each title's photoBg from DEMO_JOBS so a
  // single re-run gives the home/browse feeds real images, even when
  // the rows themselves already exist.
  let backfilled = 0;
  for (const spec of DEMO_JOBS) {
    const result = await prisma.marketplaceJob.updateMany({
      where: { title: spec.title },
      data: { photoBg: spec.photoBg },
    });
    backfilled += result.count;
  }
  if (backfilled > 0) {
    console.log(`[seed-marketplace] backfilled photoBg on ${backfilled} existing job(s)`);
  }

  const existing = await prisma.marketplaceJob.count();
  if (existing > 0) {
    console.log(`[seed-marketplace] ${existing} jobs already present — skipping demo job insert`);
    return;
  }

  const slugToId = new Map<string, string>();
  for (const c of await prisma.marketplaceCategory.findMany()) {
    slugToId.set(c.slug, c.id);
  }

  for (const job of DEMO_JOBS) {
    const categoryId = slugToId.get(job.categorySlug);
    if (!categoryId) {
      console.warn(`[seed-marketplace] skipping job "${job.title}" — unknown category ${job.categorySlug}`);
      continue;
    }
    const { categorySlug, ...rest } = job;
    await prisma.marketplaceJob.create({
      data: {
        ...rest,
        categoryId,
        availableDates: rest.availableDates as any,
        photoBgs: rest.photoBgs as any,
      },
    });
  }
  console.log(`[seed-marketplace] inserted ${DEMO_JOBS.length} demo jobs`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
