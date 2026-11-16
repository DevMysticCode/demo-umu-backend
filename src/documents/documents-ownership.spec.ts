/**
 * Coverage for the ownership checks that guard every document mutation.
 *
 * Surfaces tested: deleteDocument, getDocumentDetail, updateDocumentMeta,
 * setDocumentAccess, addDocumentGrant, removeDocumentGrant - each must
 * reject a caller who isn't the document's owner, and succeed for the
 * owner. These are IDOR rails: the id in every one of these routes is
 * caller-supplied, so "does owner check run before any mutation" is the
 * one thing standing between a logged-in user and someone else's files.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DocumentsService } from './documents.service';

function makeService() {
  const prismaStub: any = {
    userDocument: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    questionAnswer: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    documentVersion: { create: jest.fn().mockResolvedValue({}) },
    documentAccessGrant: {
      deleteMany: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    passportCollaborator: { findFirst: jest.fn() },
  };
  const filesStub: any = {};
  return { svc: new DocumentsService(prismaStub, filesStub), prismaStub };
}

const OWNER_ID = 'owner-1';
const OTHER_ID = 'other-2';
const DOC_ID = 'doc-1';

describe('DocumentsService ownership checks', () => {
  describe('deleteDocument', () => {
    it('rejects a caller who does not own the document', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userDocument.findUnique.mockResolvedValue({
        id: DOC_ID,
        userId: OWNER_ID,
        version: 1,
        fileUrl: '/uploads/documents/x.pdf',
        fileSize: 10,
        mimeType: 'application/pdf',
        name: 'x',
      });

      await expect(svc.deleteDocument(OTHER_ID, DOC_ID)).rejects.toThrow(ForbiddenException);
      expect(prismaStub.userDocument.update).not.toHaveBeenCalled();
    });

    it('404s for a document that does not exist', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userDocument.findUnique.mockResolvedValue(null);
      await expect(svc.deleteDocument(OWNER_ID, DOC_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getDocumentDetail', () => {
    it('rejects a caller who does not own the document', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userDocument.findUnique.mockResolvedValue({
        id: DOC_ID,
        userId: OWNER_ID,
        deletedAt: null,
        accessGrants: [],
      });

      await expect(svc.getDocumentDetail(OTHER_ID, DOC_ID)).rejects.toThrow(ForbiddenException);
    });

    it('404s for a soft-deleted document even if the caller owns it', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userDocument.findUnique.mockResolvedValue({
        id: DOC_ID,
        userId: OWNER_ID,
        deletedAt: new Date(),
        accessGrants: [],
      });

      await expect(svc.getDocumentDetail(OWNER_ID, DOC_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateDocumentMeta', () => {
    it('rejects a caller who does not own the document', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userDocument.findUnique.mockResolvedValue({
        id: DOC_ID,
        userId: OWNER_ID,
        deletedAt: null,
      });

      await expect(
        svc.updateDocumentMeta(OTHER_ID, DOC_ID, { name: 'renamed' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaStub.userDocument.update).not.toHaveBeenCalled();
    });

    it('allows the owner to rename it', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userDocument.findUnique.mockResolvedValue({
        id: DOC_ID,
        userId: OWNER_ID,
        deletedAt: null,
      });
      prismaStub.userDocument.update.mockResolvedValue({ id: DOC_ID, name: 'renamed', category: null, passportId: null });

      const result = await svc.updateDocumentMeta(OWNER_ID, DOC_ID, { name: 'renamed' });
      expect(result.name).toBe('renamed');
    });
  });

  describe('setDocumentAccess', () => {
    it('rejects a caller who does not own a user-kind document', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userDocument.findUnique.mockResolvedValue({ userId: OWNER_ID, passportId: null });

      await expect(
        svc.setDocumentAccess('user', DOC_ID, OTHER_ID, 'PUBLISHED'),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaStub.userDocument.update).not.toHaveBeenCalled();
    });

    it('rejects an invalid access level before touching ownership', async () => {
      const { svc } = makeService();
      await expect(
        svc.setDocumentAccess('user', DOC_ID, OWNER_ID, 'NOT_A_LEVEL'),
      ).rejects.toThrow();
    });

    it('allows the owner to change access level', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userDocument.findUnique.mockResolvedValue({ userId: OWNER_ID, passportId: null });

      const result = await svc.setDocumentAccess('user', DOC_ID, OWNER_ID, 'PUBLISHED');
      expect(result).toEqual({ id: DOC_ID, accessLevel: 'PUBLISHED' });
      expect(prismaStub.userDocument.update).toHaveBeenCalledWith({
        where: { id: DOC_ID },
        data: { accessLevel: 'PUBLISHED' },
      });
    });
  });

  describe('addDocumentGrant / removeDocumentGrant', () => {
    it('addDocumentGrant rejects a caller who does not own the document', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userDocument.findUnique.mockResolvedValue({ userId: OWNER_ID, passportId: null });

      await expect(
        svc.addDocumentGrant('user', DOC_ID, OTHER_ID, 'some-collaborator'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('removeDocumentGrant rejects a caller who does not own the document', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userDocument.findUnique.mockResolvedValue({ userId: OWNER_ID, passportId: null });

      await expect(
        svc.removeDocumentGrant('user', DOC_ID, OTHER_ID, 'some-collaborator'),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaStub.documentAccessGrant.deleteMany).not.toHaveBeenCalled();
    });
  });
});
