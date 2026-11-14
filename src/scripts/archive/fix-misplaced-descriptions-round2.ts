// Follow-up systematic scan (client request, 2026-10-06): re-ran the
// misplaced-description check across the ENTIRE 326-row content pack, not
// just the sections touched so far. Most of the ~170 initial matches were
// false positives (fixturesAndFittings' item-name + clarifying-description
// pairs, landlord_* upload explanations - all legitimate, left alone).
// Five genuine instances found:
//  - rightsAndInformalArrangements/shared_services_and_utilities had TWO
//    more (order=7, order=10) beyond the two already fixed in the first
//    pass (order=8, order=9) - same exact bug, just missed by the
//    narrower scan that round.
//  - leasehold/ownership_and_management order=1 and order=2 both titled
//    "Who owns the freehold?" (duplicate), distinguished only by their
//    description ("not controlled by the tenants" vs "controlled by the
//    tenants") - same bug, different shape (two near-duplicate rows
//    instead of one row's title+description).
//  - leasehold/documents order=10's description was a stray leftover
//    copy of order=9's ("The share or membership certificate") that
//    doesn't match order=10's own title (company accounts) - cleared.
//
// Run manually: npx ts-node -r tsconfig-paths/register src/scripts/fix-misplaced-descriptions-round2.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // rightsAndInformalArrangements/shared_services_and_utilities order=7 (top-level RADIO)
  {
    const id = '77de2a32-71fd-4092-a531-037a2ef45a3e';
    const row = await prisma.questionTemplate.findUniqueOrThrow({ where: { id } });
    const newTitle = 'Does the seller know if the property benefits from any customary rights (e.g. rights deriving from local traditions)?';
    console.log(`${row.sectionKey}/${row.taskKey} (order ${row.order}): "${row.title}" + "${row.description}" -> "${newTitle}"`);
    await prisma.questionTemplate.update({ where: { id }, data: { title: newTitle, description: '' } });
  }

  // rightsAndInformalArrangements/shared_services_and_utilities order=10 (MULTIPART part)
  {
    const id = '2e9655eb-643d-42d7-8871-556ee6577163';
    const row = await prisma.questionTemplate.findUniqueOrThrow({ where: { id } });
    const parts = row.parts as any[];
    const p0 = parts[0];
    const newTitle =
      "Does the seller know if the property is affected by other people's rights to take things from the land (such as timber, hay or fish)?";
    console.log(`${row.sectionKey}/${row.taskKey} (order ${row.order}, part): "${p0.title}" + "${p0.description}" -> "${newTitle}"`);
    p0.title = newTitle;
    p0.description = '';
    await prisma.questionTemplate.update({ where: { id }, data: { parts } });
  }

  // leasehold/ownership_and_management order=1 and order=2 - duplicate titles
  {
    const fixes: Array<{ id: string; title: string }> = [
      {
        id: '89c8e866-b9c1-4d6a-9df0-45f8f4e144bb',
        title: 'Is the freehold owned by a person or company that is not controlled by the tenants?',
      },
      {
        id: '87001544-6ad0-4d15-8ba8-ecd9b6a2d867',
        title: 'Is the freehold owned by a person or company that is controlled by the tenants?',
      },
    ];
    for (const fix of fixes) {
      const row = await prisma.questionTemplate.findUniqueOrThrow({ where: { id: fix.id } });
      console.log(`${row.sectionKey}/${row.taskKey} (order ${row.order}): "${row.title}" + "${row.description}" -> "${fix.title}"`);
      await prisma.questionTemplate.update({ where: { id: fix.id }, data: { title: fix.title, description: '' } });
    }
  }

  // leasehold/documents order=10 - stray leftover description from order=9
  {
    const id = '01f3f58a-85e2-45cb-a45d-dd586f86bf3d';
    const row = await prisma.questionTemplate.findUniqueOrThrow({ where: { id } });
    const parts = row.parts as any[];
    const p0 = parts[0];
    console.log(`${row.sectionKey}/${row.taskKey} (order ${row.order}, part): clearing stray leftover description "${p0.description}" (copy of a different question's)`);
    p0.description = '';
    await prisma.questionTemplate.update({ where: { id }, data: { parts } });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
