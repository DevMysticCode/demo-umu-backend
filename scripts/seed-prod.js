import { PrismaClient } from '@prisma/client';
import { seedDatabase } from '../prisma/seed';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding production database...');
  await seedDatabase(prisma);
  console.log('✅ Seeding complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
