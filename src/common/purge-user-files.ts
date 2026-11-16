import { PrismaService } from '../prisma/prisma.service';
import { deleteFileAtUploadsUrl } from './storage';

// Finding #10 (Onward pen-test, 2026-11-16): deleting a user's account
// (self-service "Delete my account" and the admin bulk-delete) only ever
// removed DB rows - cascading deletes never touch physical file bytes, so
// avatars, Documents-feature uploads (title deeds, certificates, KYC
// evidence - anything tagged via the copies system) and buyer-profile ID
// /funds evidence were left behind in storage forever. A UK GDPR "right
// to erasure" gap.
//
// Must run BEFORE prisma.user.delete - the file URLs live on rows the
// cascade is about to remove, so they have to be collected first. Only
// covers structured, directly-queryable file-URL fields; does NOT parse
// arbitrary file references that might be buried inside a multipart
// question's answerJson blob or a tenancy-sign record's inline signature
// data URL (the latter isn't a stored file at all - see
// question.service.ts's TenancySignLink comments) - those are a known,
// deliberately out-of-scope remainder, not an oversight.
export async function purgeUserFiles(prisma: PrismaService, userId: string): Promise<void> {
  const [user, documents, buyerProfile, passports] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { avatarUrl: true } }),
    prisma.userDocument.findMany({
      where: { userId, deletedAt: null },
      select: { fileUrl: true },
    }),
    prisma.buyerProfile.findUnique({
      where: { userId },
      select: { idDocumentUrl: true, fundsDocumentUrl: true },
    }),
    prisma.passport.findMany({
      where: { ownerId: userId },
      select: {
        sections: {
          select: {
            tasks: {
              select: {
                passportQuestions: { select: { answer: { select: { fileUrl: true } } } },
              },
            },
          },
        },
      },
    }),
  ]);

  const urls: Array<string | null | undefined> = [
    user?.avatarUrl,
    buyerProfile?.idDocumentUrl,
    buyerProfile?.fundsDocumentUrl,
    ...documents.map((d) => d.fileUrl),
  ];
  for (const passport of passports) {
    for (const section of passport.sections) {
      for (const task of section.tasks) {
        for (const question of task.passportQuestions) {
          if (question.answer?.fileUrl) urls.push(question.answer.fileUrl);
        }
      }
    }
  }

  await Promise.all(urls.filter(Boolean).map((url) => deleteFileAtUploadsUrl(url)));
}
