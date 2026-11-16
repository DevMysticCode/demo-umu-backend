/**
 * Coverage for finding #10 (Onward pen-test, 2026-11-16): deleting an
 * account must also remove the physical files it owned, not just the DB
 * rows a cascade delete already handles.
 */

const deleteFileAtUploadsUrl = jest.fn().mockResolvedValue(undefined);
jest.mock('./storage', () => ({
  deleteFileAtUploadsUrl: (...args: any[]) => deleteFileAtUploadsUrl(...args),
}));

import { purgeUserFiles } from './purge-user-files';

function makePrismaStub(overrides: any = {}) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue({ avatarUrl: null }) },
    userDocument: { findMany: jest.fn().mockResolvedValue([]) },
    buyerProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    passport: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  } as any;
}

beforeEach(() => {
  deleteFileAtUploadsUrl.mockClear();
});

describe('purgeUserFiles', () => {
  it('does nothing (no errors) when the user owns no files', async () => {
    const prisma = makePrismaStub();
    await purgeUserFiles(prisma, 'user-1');
    expect(deleteFileAtUploadsUrl).not.toHaveBeenCalled();
  });

  it('deletes the avatar', async () => {
    const prisma = makePrismaStub({
      user: { findUnique: jest.fn().mockResolvedValue({ avatarUrl: '/uploads/avatars/a.png' }) },
    });
    await purgeUserFiles(prisma, 'user-1');
    expect(deleteFileAtUploadsUrl).toHaveBeenCalledWith('/uploads/avatars/a.png');
  });

  it('deletes active UserDocument files but not already-soft-deleted ones (scoped by the query, not filtered after)', async () => {
    const prisma = makePrismaStub({
      userDocument: {
        findMany: jest.fn().mockResolvedValue([
          { fileUrl: '/uploads/documents/d1.pdf' },
          { fileUrl: '/uploads/documents/d2.pdf' },
        ]),
      },
    });
    await purgeUserFiles(prisma, 'user-1');
    expect(prisma.userDocument.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', deletedAt: null },
      select: { fileUrl: true },
    });
    expect(deleteFileAtUploadsUrl).toHaveBeenCalledWith('/uploads/documents/d1.pdf');
    expect(deleteFileAtUploadsUrl).toHaveBeenCalledWith('/uploads/documents/d2.pdf');
  });

  it('deletes buyer-profile ID and funds evidence', async () => {
    const prisma = makePrismaStub({
      buyerProfile: {
        findUnique: jest.fn().mockResolvedValue({
          idDocumentUrl: '/uploads/kyc/id.jpg',
          fundsDocumentUrl: '/uploads/kyc/funds.pdf',
        }),
      },
    });
    await purgeUserFiles(prisma, 'user-1');
    expect(deleteFileAtUploadsUrl).toHaveBeenCalledWith('/uploads/kyc/id.jpg');
    expect(deleteFileAtUploadsUrl).toHaveBeenCalledWith('/uploads/kyc/funds.pdf');
  });

  it('walks owned passports down to each question answer file', async () => {
    const prisma = makePrismaStub({
      passport: {
        findMany: jest.fn().mockResolvedValue([
          {
            sections: [
              {
                tasks: [
                  {
                    passportQuestions: [
                      { answer: { fileUrl: '/uploads/passport-docs/gas.pdf' } },
                      { answer: null },
                      { answer: { fileUrl: null } },
                    ],
                  },
                ],
              },
            ],
          },
        ]),
      },
    });
    await purgeUserFiles(prisma, 'user-1');
    expect(prisma.passport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: 'user-1' } }),
    );
    expect(deleteFileAtUploadsUrl).toHaveBeenCalledWith('/uploads/passport-docs/gas.pdf');
    expect(deleteFileAtUploadsUrl).toHaveBeenCalledTimes(1);
  });
});
