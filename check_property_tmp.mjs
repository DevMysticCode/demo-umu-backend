import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const props = await prisma.property.findMany({
  where: { addressLine1: { contains: 'Woodfield Road' } },
  select: {
    id: true, addressLine1: true, postcode: true,
    propertyType: true, tenure: true, titleNumber: true,
    sqft: true, floorAreaSqm: true, epcRating: true, epcLmkKey: true,
    yearBuilt: true, epcEnrichedAt: true, uprn: true,
  },
})
console.log(JSON.stringify(props, null, 2))
await prisma.$disconnect()
