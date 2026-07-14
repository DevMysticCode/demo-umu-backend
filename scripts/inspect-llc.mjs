// Dump every LlcSearch row + its charges so we can see what's in the
// DB right now — cheaper than eyeballing Prisma Studio.
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const rows = await prisma.llcSearch.findMany({
  include: {
    charges: { select: { boundary: true, category: true, subCategory: true, location: true, description: true } },
    property: { select: { addressLine1: true, postcode: true, uprn: true } },
  },
})
for (const r of rows) {
  const direct = r.charges.filter((c) => !c.boundary)
  const bound = r.charges.filter((c) => c.boundary)
  console.log(`\n📍 ${r.property?.addressLine1}, ${r.property?.postcode} (uprn=${r.property?.uprn})`)
  console.log(`   status=${r.status}${r.errorCode ? ` err=${r.errorCode}` : ''}`)
  console.log(`   direct=${direct.length} boundary=${bound.length}  searchedAt=${r.searchedAt.toISOString()}`)
  for (const c of direct) console.log(`   • [direct]   ${c.category}${c.subCategory ? '/'+c.subCategory : ''}`)
  for (const c of bound)  console.log(`   • [boundary] ${c.category}${c.subCategory ? '/'+c.subCategory : ''} — ${c.location}`)
}
console.log(`\n[total] ${rows.length} LlcSearch rows`)
await prisma.$disconnect()
