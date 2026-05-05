// One-off diagnostic — checks whether the landlord templates exist in the
// DB and whether a given passport actually has landlord-prefixed sections.
//
// Run from the backend directory:
//   npx ts-node prisma/diag-landlord.ts <passportId?>

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const passportId = process.argv[2] ?? null;

  console.log('\n=== Section templates ===');
  const allST = await prisma.sectionTemplate.findMany({
    select: { key: true, type: true, conditionalKey: true },
    orderBy: { key: 'asc' },
  });
  const landlordST = allST.filter((s) => s.key.startsWith('landlord_'));
  const sellerST = allST.filter((s) => !s.key.startsWith('landlord_'));
  console.log(`Total: ${allST.length}`);
  console.log(`Landlord-prefixed: ${landlordST.length}`);
  console.log(`Seller (non-landlord): ${sellerST.length}`);
  console.log('Landlord keys:', landlordST.map((s) => s.key).join(', ') || '(none)');
  console.log(
    'Landlord types:',
    landlordST.map((s) => `${s.key}=${s.type}`).join(', ') || '(none)',
  );

  console.log('\n=== Question templates ===');
  const allQT = await prisma.questionTemplate.findMany({
    select: { sectionKey: true, type: true },
  });
  const landlordQT = allQT.filter((q) => q.sectionKey.startsWith('landlord_'));
  console.log(`Total: ${allQT.length}`);
  console.log(`Landlord-prefixed: ${landlordQT.length}`);

  if (passportId) {
    console.log(`\n=== Passport ${passportId} ===`);
    const p = await prisma.passport.findUnique({
      where: { id: passportId },
      select: {
        id: true,
        type: true,
        isHmo: true,
        addressLine1: true,
        sections: { select: { key: true, status: true }, orderBy: { order: 'asc' } },
      },
    });
    if (!p) {
      console.log('NOT FOUND');
    } else {
      console.log(`Address: ${p.addressLine1}`);
      console.log(`Type: ${p.type}`);
      console.log(`HMO: ${p.isHmo}`);
      console.log(`Total sections: ${p.sections.length}`);
      console.log(`Landlord sections: ${p.sections.filter((s) => s.key.startsWith('landlord_')).length}`);
      console.log(`Seller sections: ${p.sections.filter((s) => !s.key.startsWith('landlord_')).length}`);
      console.log(
        'Section keys:',
        p.sections.map((s) => s.key).join(', ') || '(none)',
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
