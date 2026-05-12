/**
 * One-off: delete every user except itsbunty12398@gmail.com (case-insensitive)
 * along with all their data. User → most relations cascade; the exceptions
 * (OtpCode, HomeScoreResult, SupportRequest, PassportCollaborator,
 *  BuyerPassportAccess) we clean up explicitly by email/userId.
 *
 * Run from the backend dir:
 *   npx ts-node prisma/wipe-users-except-bunty.ts
 */
import { PrismaClient } from '@prisma/client'

const KEEP_EMAIL = 'itsbunty12398@gmail.com'

async function main() {
  const prisma = new PrismaClient()
  try {
    // Auth normalises emails to lowercase before storage, so a plain match works.
    const keep = await prisma.user.findFirst({
      where: { email: KEEP_EMAIL },
      select: { id: true, email: true },
    })

    if (!keep) {
      console.error(`✗ Keep-user "${KEEP_EMAIL}" not found in DB. Aborting.`)
      process.exit(1)
    }

    console.log(`Keeping: ${keep.email} (${keep.id})`)

    const before = await prisma.user.count()
    console.log(`Total users before: ${before}`)

    // OtpCode is keyed by email, no relation. Wipe everyone else's codes.
    const otp = await prisma.otpCode.deleteMany({
      where: { email: { not: keep.email } },
    })
    console.log(`Deleted ${otp.count} OtpCode rows`)

    // HomeScoreResult has userId but no FK cascade.
    const hs = await prisma.homeScoreResult.deleteMany({
      where: { userId: { not: keep.id } },
    })
    console.log(`Deleted ${hs.count} HomeScoreResult rows`)

    // SupportRequest is keyed by email, no relation.
    const sr = await prisma.supportRequest.deleteMany({
      where: { email: { not: keep.email } },
    })
    console.log(`Deleted ${sr.count} SupportRequest rows`)

    // Now the User cascade handles UserAddress, UserCompany, UserSolicitor,
    // UserPreference, Passport (→ sections → tasks → questions → answers,
    // collaborators, buyer-access, shared-links, buyer-notes, collection
    // items), PassportCollection, UserCollaborator (both sides), UserWishlist,
    // UserSavedProperty, UserReminder, UserDocument, VideoProgress,
    // BuyerProfile.
    const users = await prisma.user.deleteMany({
      where: { id: { not: keep.id } },
    })
    console.log(`Deleted ${users.count} User rows (and all cascaded relations)`)

    const after = await prisma.user.count()
    console.log(`Total users after: ${after}`)
    console.log('✓ Done.')
  } finally {
    // PrismaClient cleanup
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
