// Fixes the "generic title + topic stuffed into description" pattern
// across the whole app (client feedback, 2026-10-06, same bug as the
// Guarantees and Warranties fix earlier this session - "Is the property
// connected to mains:" with "A foul water drainage?" as the description,
// instead of one self-contained question). Hand-written per row rather
// than templated - "connected to mains X" and "provided by a X" need
// different grammar for the folded-in fragment, so a generic merge
// produced broken English for half of these.
//
// Run manually: npx ts-node -r tsconfig-paths/register src/scripts/fix-misplaced-descriptions.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Top-level RADIO rows (title + description columns).
const TOP_LEVEL_FIXES: Array<{ id: string; title: string }> = [
  { id: '2d2cc8fb-be87-4922-8010-ed8911070eee', title: 'Is the property connected to mains foul water drainage?' },
  { id: '394be694-d649-4d76-85ed-f810823a0f02', title: 'Is the property connected to mains surface water drainage?' },
  { id: '6e04a862-9c69-4e7d-9e91-716f2425dd5e', title: 'Is sewerage for any part of the property provided by a sewage treatment plant?' },
  { id: '59fad030-1d9b-4686-a8bf-97fe735d1bb9', title: 'Is sewerage for any part of the property provided by a cesspool?' },
  { id: 'property_rights_and_protections:5', title: 'Does the seller know if the property benefits from any rights of light?' },
  { id: 'other_rights_or_arrangements:6', title: 'Does the seller know if the property benefits from any rights of support from adjoining properties?' },
];

// MULTIPART rows whose first part carries the same pattern.
const PART_FIXES: Array<{ id: string; title: string }> = [
  { id: '3e98856a-1ae1-4ad8-a1e9-98bbec051401', title: 'Is sewerage for the property provided by a septic tank?' },
  { id: 'shared_services_and_utilities:8', title: "Does the seller know if the property is affected by other people's rights to mines and minerals under the land?" },
  { id: 'shared_services_and_utilities:9', title: 'Does the seller know if the property is affected by chancel repair liability?' },
];

async function resolveId(idOrKey: string): Promise<string | null> {
  if (!idOrKey.includes(':')) return idOrKey;
  const [taskKey, orderStr] = idOrKey.split(':');
  const row = await prisma.questionTemplate.findFirst({
    where: { sectionKey: 'rightsAndInformalArrangements', taskKey, order: Number(orderStr) },
    select: { id: true },
  });
  return row?.id ?? null;
}

async function main() {
  for (const fix of TOP_LEVEL_FIXES) {
    const id = await resolveId(fix.id);
    if (!id) {
      console.log(`SKIP ${fix.id} - not found.`);
      continue;
    }
    const row = await prisma.questionTemplate.findUniqueOrThrow({ where: { id } });
    console.log(`${row.sectionKey}/${row.taskKey} (order ${row.order}): "${row.title}" + "${row.description}" -> "${fix.title}"`);
    await prisma.questionTemplate.update({ where: { id }, data: { title: fix.title, description: '' } });
  }

  for (const fix of PART_FIXES) {
    const id = await resolveId(fix.id);
    if (!id) {
      console.log(`SKIP ${fix.id} - not found.`);
      continue;
    }
    const row = await prisma.questionTemplate.findUniqueOrThrow({ where: { id } });
    const parts = row.parts as any[];
    const p0 = parts[0];
    console.log(`${row.sectionKey}/${row.taskKey} (order ${row.order}, part): "${p0.title}" + "${p0.description}" -> "${fix.title}"`);
    p0.title = fix.title;
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
