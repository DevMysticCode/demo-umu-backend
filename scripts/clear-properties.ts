/**
 * One-off: clear all Property rows (and their dependent passports/answers)
 * so the next homescore search re-inserts them with the v6-2 enrichment
 * fields (lmk-key, fabric, recommendations, etc).
 *
 * Run with:
 *   npx ts-node scripts/clear-properties.ts
 *
 * The backend must be stopped first if it holds an open Prisma client
 * (Windows DLL lock). Restart after the script completes.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('[clear] Deleting dependent rows first…');

  // Order matters: passport sub-tables → passports → properties.
  const sectionTasks = await prisma.passportSectionTask.deleteMany().catch(() => ({ count: 0 }));
  console.log(`[clear] passportSectionTask: ${sectionTasks.count}`);

  const sections = await prisma.passportSection.deleteMany().catch(() => ({ count: 0 }));
  console.log(`[clear] passportSection:     ${sections.count}`);

  const questions = await (prisma as any).passportQuestion?.deleteMany().catch(() => ({ count: 0 })) ?? { count: 0 };
  console.log(`[clear] passportQuestion:    ${questions.count}`);

  const collaborators = await prisma.passportCollaborator.deleteMany().catch(() => ({ count: 0 }));
  console.log(`[clear] passportCollaborator:${collaborators.count}`);

  const buyerAccess = await (prisma as any).buyerPassportAccess?.deleteMany().catch(() => ({ count: 0 })) ?? { count: 0 };
  console.log(`[clear] buyerPassportAccess: ${buyerAccess.count}`);

  const sharedLinks = await (prisma as any).sharedPassportLink?.deleteMany().catch(() => ({ count: 0 })) ?? { count: 0 };
  console.log(`[clear] sharedPassportLink:  ${sharedLinks.count}`);

  const buyerNotes = await (prisma as any).buyerNote?.deleteMany().catch(() => ({ count: 0 })) ?? { count: 0 };
  console.log(`[clear] buyerNote:           ${buyerNotes.count}`);

  const passports = await prisma.passport.deleteMany().catch(() => ({ count: 0 }));
  console.log(`[clear] passport:            ${passports.count}`);

  const homescores = await (prisma as any).homeScoreResult?.deleteMany().catch(() => ({ count: 0 })) ?? { count: 0 };
  console.log(`[clear] homeScoreResult:     ${homescores.count}`);

  const wishlists = await (prisma as any).propertyWishlist?.deleteMany().catch(() => ({ count: 0 })) ?? { count: 0 };
  console.log(`[clear] propertyWishlist:    ${wishlists.count}`);

  const searchLogs = await (prisma as any).propertySearchLog?.deleteMany().catch(() => ({ count: 0 })) ?? { count: 0 };
  console.log(`[clear] propertySearchLog:   ${searchLogs.count}`);

  const verifications = await (prisma as any).ownershipVerification?.deleteMany().catch(() => ({ count: 0 })) ?? { count: 0 };
  console.log(`[clear] ownershipVerification:${verifications.count}`);

  const properties = await prisma.property.deleteMany();
  console.log(`[clear] property:            ${properties.count}`);

  console.log('[clear] Done. Restart the backend and re-search to refill.');
}

main()
  .catch((err) => {
    console.error('[clear] Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
