/**
 * Dev/test utility — resets a single passport back to its "just claimed"
 * state: every question un-answered, every task/section back to PENDING/
 * LOCKED (first section ACTIVE), all points earned THROUGH THIS PASSPORT
 * removed from the ledger and the owner's balance, any stamps minted via
 * this passport revoked (so CORE_PASSPORT_COMPLETE / FIRST_PROPERTY_PASSPORT
 * etc. can re-fire), and this passport's Timeline activity cleared.
 *
 * Scope is exactly PointsLedgerEntry.passportId = this passport — streak
 * milestones (STREAK_3_DAY etc.) aren't passport-scoped, so they're left
 * alone on purpose; this only removes what THIS passport contributed.
 * Does not touch any other passport or user.
 *
 * Usage:
 *   npm run reset:passport -- <passportId>
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

async function main() {
  const passportId = process.argv[2];
  if (!passportId) {
    console.error('Usage: npm run reset:passport -- <passportId>');
    process.exit(1);
  }

  const passport = await prisma.passport.findUnique({
    where: { id: passportId },
    include: {
      owner: { select: { id: true, email: true, rewardPointsBalance: true } },
      sections: { orderBy: { order: 'asc' } },
    },
  });
  if (!passport) {
    console.error(`No passport found with id ${passportId}`);
    process.exit(1);
  }

  const sectionIds = passport.sections.map((s) => s.id);
  const tasks = await prisma.passportSectionTask.findMany({
    where: { passportSectionId: { in: sectionIds } },
    select: { id: true },
  });
  const taskIds = tasks.map((t) => t.id);
  const questions = await prisma.passportQuestion.findMany({
    where: { passportSectionTaskId: { in: taskIds } },
    select: { id: true },
  });
  const questionIds = questions.map((q) => q.id);

  const ledgerEntries = await prisma.pointsLedgerEntry.findMany({
    where: { passportId },
    select: { id: true, amount: true, type: true },
  });
  const pointsToRemove = ledgerEntries.reduce((sum, e) => sum + e.amount, 0);

  const stamps = await prisma.userStamp.findMany({
    where: { passportId },
    select: { id: true, stampDefinitionId: true },
  });

  console.log(`Passport: ${passport.addressLine1}, ${passport.postcode}`);
  console.log(`Owner: ${passport.owner.email} (current balance: ${passport.owner.rewardPointsBalance})`);
  console.log(`Sections: ${sectionIds.length}, Tasks: ${taskIds.length}, Questions: ${questionIds.length}`);
  console.log(`Points ledger entries to remove: ${ledgerEntries.length} (net ${pointsToRemove} pts)`);
  console.log(`Stamps to revoke: ${stamps.length}`);
  console.log('Resetting...');

  const firstSectionId = passport.sections[0]?.id;
  const otherSectionIds = passport.sections.slice(1).map((s) => s.id);

  await prisma.$transaction(
    async (tx) => {
      await tx.questionAnswer.deleteMany({ where: { passportQuestionId: { in: questionIds } } });
      await tx.passportQuestion.updateMany({ where: { id: { in: questionIds } }, data: { status: 'PENDING' } });
      await tx.passportSectionTask.updateMany({ where: { id: { in: taskIds } }, data: { status: 'PENDING' } });

      if (firstSectionId) {
        await tx.passportSection.update({ where: { id: firstSectionId }, data: { status: 'ACTIVE' } });
      }
      if (otherSectionIds.length) {
        await tx.passportSection.updateMany({ where: { id: { in: otherSectionIds } }, data: { status: 'LOCKED' } });
      }

      await tx.pointsLedgerEntry.deleteMany({ where: { passportId } });

      if (pointsToRemove !== 0) {
        const freshOwner = await tx.user.findUniqueOrThrow({
          where: { id: passport.ownerId },
          select: { rewardPointsBalance: true },
        });
        await tx.user.update({
          where: { id: passport.ownerId },
          data: { rewardPointsBalance: Math.max(0, freshOwner.rewardPointsBalance - pointsToRemove) },
        });
      }

      await tx.userStamp.deleteMany({ where: { passportId } });
      await tx.passportActivity.deleteMany({ where: { passportId } });

      await tx.passport.update({
        where: { id: passportId },
        data: { status: 'IN_PROGRESS', lastVisitedTaskId: null, lastVisitedAt: null },
      });
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  const updatedOwner = await prisma.user.findUnique({
    where: { id: passport.ownerId },
    select: { rewardPointsBalance: true },
  });
  console.log('Done.');
  console.log(`Owner balance: ${passport.owner.rewardPointsBalance} -> ${updatedOwner?.rewardPointsBalance}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
