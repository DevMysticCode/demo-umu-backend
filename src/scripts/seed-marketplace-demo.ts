/**
 * Marketplace demo-data seed — populates a target user's marketplace
 * profile with realistic jobs, offers, threads, and payments so the UI
 * has something to render.
 *
 * Usage:
 *   npm run seed:marketplace:demo -- --email=itsbunty12398@gmail.com
 *
 * Re-runnable: jobs are upserted on a `(customerId, title)` pair, so
 * running it twice doesn't double up.
 */

import { PrismaClient } from '@prisma/client';

// ─── env loader (matches the price-paid script) ────────────────────
const path = require('path');
const fs = require('fs');
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m) {
      const [, k, v] = m;
      if (!process.env[k]) process.env[k] = v.trim().replace(/^"|"$/g, '');
    }
  }
}

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const emailArg = args.find((a) => a.startsWith('--email='))?.split('=')[1];
const TARGET_EMAIL = emailArg ?? 'itsbunty12398@gmail.com';

// ─── helper builders ───────────────────────────────────────────────
function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}
function daysAgo(d: number): Date {
  return hoursAgo(d * 24);
}

// We need a fake supplier identity to post offers + sit on the other
// side of the threads. Created once; reused on subsequent runs.
const FAKE_SUPPLIER = {
  email: 'martin.supplier@umu.test',
  firstName: 'Martin',
  lastName: 'Oduya',
};

const DEMO_JOBS = [
  {
    key: 'demo-bathroom',
    categorySlug: 'bathrooms',
    title: 'Replace bathroom tiles and refit shower',
    description: 'Existing tiles need to be ripped out and replaced. Walk-in shower has a leaking tray that needs swapping out. All materials supplied by us — looking for labour-only.',
    locationLabel: 'Bristol BS1',
    postcode: 'BS1',
    distanceMi: 1.2,
    urgency: 'urgent',
    availability: 'Available 25 Apr',
    availableDates: ['25 Apr', '28 Apr', '2 May'],
    budgetMin: 1800,
    budgetMax: 2400,
    photoBg: "linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.05)), url('https://loremflickr.com/700/300/bathroom,interior?lock=1041') center/cover no-repeat, linear-gradient(135deg, #B5E8D5, #3DA66A)",
    postedAt: hoursAgo(3),
    targetStatus: 'open' as const,
    targetOffers: 4,
    seedThreadOnOffer: true,
  },
  {
    key: 'demo-kitchen',
    categorySlug: 'kitchens',
    title: 'Fit new kitchen — 14 units + worktop',
    description: 'IKEA Metod kitchen, flat-packed and on-site. Existing kitchen ripped out. Looking for someone to do a clean fit including worktop, sink, and hob cut-outs.',
    locationLabel: 'Bristol BS6',
    postcode: 'BS6',
    distanceMi: 3.1,
    urgency: 'standard',
    availability: 'Available within 2 weeks',
    availableDates: ['2 May', '9 May', '16 May'],
    budgetMin: 5500,
    budgetMax: 7500,
    photoBg: "linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.05)), url('https://loremflickr.com/700/300/kitchen,cabinets?lock=1042') center/cover no-repeat, linear-gradient(135deg, #FFD5B5, #E07C4F)",
    postedAt: daysAgo(2),
    targetStatus: 'in_progress' as const,
    targetOffers: 6,
    acceptOffer: true,
  },
  {
    key: 'demo-electrical',
    categorySlug: 'electrical',
    title: 'EICR — 3-bed end-terrace',
    description: 'EICR certificate needed for landlord compliance. 2 consumer units, all sockets and lights accessible.',
    locationLabel: 'Coventry CV5',
    postcode: 'CV5',
    distanceMi: 0.8,
    urgency: 'urgent',
    availability: 'Within 7 days',
    availableDates: ['28 Apr', '2 May'],
    budgetMin: 280,
    budgetMax: 380,
    photoBg: "linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.05)), url('https://loremflickr.com/700/300/electrician,wiring?lock=1043') center/cover no-repeat, linear-gradient(135deg, #FFE69E, #F5A623)",
    postedAt: hoursAgo(8),
    targetStatus: 'open' as const,
    targetOffers: 7,
    seedThreadOnOffer: true,
  },
  {
    key: 'demo-garden',
    categorySlug: 'garden',
    title: 'Garden makeover — 80m² turf + raised beds',
    description: 'Fresh turf across the back garden, two raised beds along the fence line, and 8m of new fencing on the side boundary. Supplier to supply all materials.',
    locationLabel: 'Bristol BS3',
    postcode: 'BS3',
    distanceMi: 2.4,
    urgency: 'flexible',
    availability: 'Spring slot',
    availableDates: ['9 May', '16 May', '23 May'],
    budgetMin: 1100,
    budgetMax: 1500,
    photoBg: "linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.05)), url('https://loremflickr.com/700/300/gardener,landscaping?lock=1044') center/cover no-repeat, linear-gradient(135deg, #C5E8A8, #4ADE80)",
    postedAt: daysAgo(1),
    targetStatus: 'open' as const,
    targetOffers: 2,
  },
  {
    key: 'demo-painting',
    categorySlug: 'painting',
    title: 'Hallway, stairs & landing repaint',
    description: 'Walls in Cornforth White (F&B), woodwork in white satin. Prep + 2 coats. Paint already bought.',
    locationLabel: 'Bristol BS1',
    postcode: 'BS1',
    distanceMi: 1.0,
    urgency: 'flexible',
    availability: 'Flexible',
    availableDates: ['16 May', '23 May'],
    budgetMin: 600,
    budgetMax: 800,
    photoBg: "linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.05)), url('https://loremflickr.com/700/300/decorating,wall?lock=1045') center/cover no-repeat, linear-gradient(135deg, #E5C8FF, #9468E0)",
    postedAt: daysAgo(5),
    targetStatus: 'completed' as const,
    targetOffers: 3,
    acceptOffer: true,
    releasePayment: true,
    leaveReview: true,
  },
  {
    key: 'demo-plumbing',
    categorySlug: 'plumbing',
    title: 'Replace combi boiler — Worcester 30CDi',
    description: 'Existing Worcester 30CDi is 12 years old and unreliable. Looking to fit a new combi in roughly the same position (utility cupboard, mains gas).',
    locationLabel: 'Coventry CV6',
    postcode: 'CV6',
    distanceMi: 1.6,
    urgency: 'urgent',
    availability: 'ASAP',
    availableDates: ['25 Apr', '28 Apr'],
    budgetMin: 2200,
    budgetMax: 3000,
    photoBg: "linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.05)), url('https://loremflickr.com/700/300/boiler,radiator?lock=1046') center/cover no-repeat, linear-gradient(135deg, #A8DAFF, #5B8DEF)",
    postedAt: hoursAgo(20),
    targetStatus: 'open' as const,
    targetOffers: 5,
    seedThreadOnOffer: true,
  },
];

async function ensureSupplier(): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { email: FAKE_SUPPLIER.email } });
  if (existing) return existing.id;
  // We need *some* password value to satisfy the not-null constraint;
  // this account is server-seeded only, no login intended.
  const created = await prisma.user.create({
    data: {
      email: FAKE_SUPPLIER.email,
      password: 'demo-only-no-login',
      firstName: FAKE_SUPPLIER.firstName,
      lastName: FAKE_SUPPLIER.lastName,
      isVerified: true,
    },
  });
  console.log(`[seed-marketplace:demo] created demo supplier ${FAKE_SUPPLIER.email}`);
  return created.id;
}

async function ensureCategoryMap(): Promise<Map<string, string>> {
  const cats = await prisma.marketplaceCategory.findMany();
  if (!cats.length) {
    throw new Error(
      'Marketplace categories are empty. Run `npm run seed:marketplace` first to populate them.',
    );
  }
  return new Map(cats.map((c) => [c.slug, c.id]));
}

async function main() {
  const user = await prisma.user.findUnique({ where: { email: TARGET_EMAIL } });
  if (!user) {
    throw new Error(`User ${TARGET_EMAIL} not found. Sign up first, then re-run.`);
  }
  console.log(`[seed-marketplace:demo] seeding marketplace data for ${TARGET_EMAIL} (${user.id})`);

  const supplierId = await ensureSupplier();
  const categoryMap = await ensureCategoryMap();

  for (const spec of DEMO_JOBS) {
    const categoryId = categoryMap.get(spec.categorySlug);
    if (!categoryId) {
      console.warn(`  ↳ skipping ${spec.title} — unknown category ${spec.categorySlug}`);
      continue;
    }

    // Idempotent: keyed by (customerId, title)
    let job = await prisma.marketplaceJob.findFirst({
      where: { customerId: user.id, title: spec.title },
    });

    if (!job) {
      job = await prisma.marketplaceJob.create({
        data: {
          customerId: user.id,
          categoryId,
          title: spec.title,
          description: spec.description,
          locationLabel: spec.locationLabel,
          postcode: spec.postcode,
          distanceMi: spec.distanceMi,
          urgency: spec.urgency,
          availability: spec.availability,
          availableDates: spec.availableDates as any,
          budgetMin: spec.budgetMin,
          budgetMax: spec.budgetMax ?? null,
          photoBg: spec.photoBg,
          photoBgs: [] as any,
          status: 'open', // we promote it below if needed
          postedAt: spec.postedAt,
          offerCount: 0,
        },
      });
    } else if (job.photoBg !== spec.photoBg) {
      // Backfill: refresh photoBg on existing demo rows so a single
      // re-run picks up the latest loremflickr image for the home
      // and projects feeds without needing to wipe.
      job = await prisma.marketplaceJob.update({
        where: { id: job.id },
        data: { photoBg: spec.photoBg },
      });
    }

    // Build offers (one is the fake supplier; rest are anonymous price
    // bumps that just inflate the offer counter so the UI shows variety
    // without us needing more user rows).
    const existingOffer = await prisma.marketplaceOffer.findUnique({
      where: { jobId_supplierId: { jobId: job.id, supplierId } },
    });

    let supplierOffer = existingOffer;
    if (!supplierOffer) {
      const offerPrice = Math.round((spec.budgetMin + (spec.budgetMax ?? spec.budgetMin)) / 2);
      supplierOffer = await prisma.marketplaceOffer.create({
        data: {
          jobId: job.id,
          supplierId,
          price: offerPrice,
          message: `Hi! Happy to take this on. I have 12+ years in the trade and can start ${spec.availability?.toLowerCase() ?? 'this week'}. Quote includes labour and minor consumables; major materials as agreed.`,
          availableDate: spec.availableDates[0] ?? null,
          status: 'pending',
        },
      });
    }

    // Bump cached counter to match the target so the UI's "N offers"
    // pill looks realistic (the actual supplierOffer row above is one
    // of those N).
    if (job.offerCount !== spec.targetOffers) {
      await prisma.marketplaceJob.update({
        where: { id: job.id },
        data: { offerCount: spec.targetOffers },
      });
    }

    // Optional: open a thread with one mock message exchange.
    if (spec.seedThreadOnOffer || spec.acceptOffer) {
      const existingThread = await prisma.marketplaceThread.findUnique({
        where: { jobId_supplierId: { jobId: job.id, supplierId } },
      });
      let thread = existingThread;
      if (!thread) {
        thread = await prisma.marketplaceThread.create({
          data: {
            jobId: job.id,
            supplierId,
            customerId: user.id,
            lastMessageAt: hoursAgo(2),
          },
        });
        await prisma.marketplaceMessage.createMany({
          data: [
            {
              threadId: thread.id,
              senderId: supplierId,
              body: 'Morning! I had a quick look at your job description — happy to start when works for you. Just to check — is access through the front door OK?',
              createdAt: hoursAgo(6),
              readAt: hoursAgo(5),
            },
            {
              threadId: thread.id,
              senderId: user.id,
              body: 'Yep, front-door access. Could you confirm whether the quote covers waste removal?',
              createdAt: hoursAgo(5),
              readAt: hoursAgo(4),
            },
            {
              threadId: thread.id,
              senderId: supplierId,
              body: 'Yes — skip + tip charges are baked into the price. Anything you want to keep, let me know upfront.',
              createdAt: hoursAgo(2),
              readAt: null,
            },
          ],
        });
      }
    }

    // For jobs that should be "in progress" or "completed", we need a
    // payment row and (optionally) a review.
    if (spec.acceptOffer) {
      const offerPrice = supplierOffer!.price;
      const amount = offerPrice * 100;
      const platformFee = Math.round(amount * 0.10);
      const total = amount + platformFee;

      const existingPayment = await prisma.marketplacePayment.findUnique({
        where: { jobId: job.id },
      });
      if (!existingPayment) {
        await prisma.$transaction([
          prisma.marketplacePayment.create({
            data: {
              jobId: job.id,
              offerId: supplierOffer!.id,
              customerId: user.id,
              supplierId,
              amount,
              platformFee,
              total,
              status: spec.releasePayment ? 'released' : 'held',
              stripePaymentIntentId: `demo_pi_${job.id.slice(0, 8)}`,
              heldAt: daysAgo(3),
              releasedAt: spec.releasePayment ? daysAgo(1) : null,
            },
          }),
          prisma.marketplaceOffer.update({
            where: { id: supplierOffer!.id },
            data: { status: 'accepted' },
          }),
          prisma.marketplaceJob.update({
            where: { id: job.id },
            data: { status: spec.releasePayment ? 'completed' : 'in_progress' },
          }),
        ]);
      }

      if (spec.leaveReview) {
        const existingReview = await prisma.marketplaceReview.findUnique({
          where: { jobId_fromUserId: { jobId: job.id, fromUserId: user.id } },
        });
        if (!existingReview) {
          await prisma.marketplaceReview.create({
            data: {
              jobId: job.id,
              fromUserId: user.id,
              toUserId: supplierId,
              direction: 'customer_to_supplier',
              rating: 5,
              body: 'Brilliant. Showed up on time, kept the place tidy, and finished a day early. Would 100% use again.',
              createdAt: daysAgo(1),
            },
          });
        }
      }
    } else if (spec.targetStatus !== 'open' && job.status === 'open') {
      // Specs can ask for in_progress/completed without a payment — sync
      // the status separately so the demo Projects page shows variety.
      await prisma.marketplaceJob.update({
        where: { id: job.id },
        data: { status: spec.targetStatus },
      });
    }

    console.log(`  ✓ ${spec.title}`);
  }

  console.log(`[seed-marketplace:demo] done — sign in as ${TARGET_EMAIL} to see the marketplace populated.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
