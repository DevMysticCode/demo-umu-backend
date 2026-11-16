/**
 * Coverage for the ownership checks that guard every caller-supplied-id
 * mutation in CollectionService.
 *
 * Surfaces tested: addToCollection, removeFromCollection, deleteCollection.
 * Each route takes a collectionId AND (for addToCollection) a passportId,
 * both caller-supplied - a collection owner shouldn't be able to file a
 * passport they themselves have no relationship to into their own
 * collection just by guessing/leaking its id (security review 2026-09-22,
 * M2), and nobody should be able to touch a collection they don't own.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CollectionService } from './collection.service';

function makeService() {
  const prismaStub: any = {
    passportCollection: { findMany: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
    passportCollectionItem: { upsert: jest.fn(), deleteMany: jest.fn() },
    passportCollaborator: { findMany: jest.fn() },
    passport: { findMany: jest.fn() },
  };
  const passportServiceStub: any = { checkUserAccess: jest.fn() };
  return {
    svc: new CollectionService(prismaStub, passportServiceStub),
    prismaStub,
    passportServiceStub,
  };
}

const OWNER_ID = 'owner-1';
const OTHER_ID = 'other-2';
const COLLECTION_ID = 'collection-1';
const PASSPORT_ID = 'passport-1';

describe('CollectionService ownership checks', () => {
  describe('addToCollection', () => {
    it('rejects a caller who does not own the collection', async () => {
      const { svc, prismaStub, passportServiceStub } = makeService();
      prismaStub.passportCollection.findUnique.mockResolvedValue({ id: COLLECTION_ID, userId: OWNER_ID });

      await expect(
        svc.addToCollection(OTHER_ID, COLLECTION_ID, PASSPORT_ID),
      ).rejects.toThrow(ForbiddenException);
      expect(passportServiceStub.checkUserAccess).not.toHaveBeenCalled();
      expect(prismaStub.passportCollectionItem.upsert).not.toHaveBeenCalled();
    });

    it('404s for a collection that does not exist', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.passportCollection.findUnique.mockResolvedValue(null);
      await expect(
        svc.addToCollection(OWNER_ID, COLLECTION_ID, PASSPORT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects filing a passport the caller has no access to, even into their own collection', async () => {
      const { svc, prismaStub, passportServiceStub } = makeService();
      prismaStub.passportCollection.findUnique.mockResolvedValue({ id: COLLECTION_ID, userId: OWNER_ID });
      passportServiceStub.checkUserAccess.mockResolvedValue(false);

      await expect(
        svc.addToCollection(OWNER_ID, COLLECTION_ID, PASSPORT_ID),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaStub.passportCollectionItem.upsert).not.toHaveBeenCalled();
    });

    it('allows the owner to file a passport they have access to', async () => {
      const { svc, prismaStub, passportServiceStub } = makeService();
      prismaStub.passportCollection.findUnique.mockResolvedValue({ id: COLLECTION_ID, userId: OWNER_ID });
      passportServiceStub.checkUserAccess.mockResolvedValue(true);
      prismaStub.passportCollectionItem.upsert.mockResolvedValue({ id: 'item-1', collectionId: COLLECTION_ID, passportId: PASSPORT_ID });

      const result = await svc.addToCollection(OWNER_ID, COLLECTION_ID, PASSPORT_ID);
      expect(result).toEqual({ id: 'item-1', collectionId: COLLECTION_ID, passportId: PASSPORT_ID });
    });
  });

  describe('removeFromCollection', () => {
    it('rejects a caller who does not own the collection', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.passportCollection.findUnique.mockResolvedValue({ id: COLLECTION_ID, userId: OWNER_ID });

      await expect(
        svc.removeFromCollection(OTHER_ID, COLLECTION_ID, PASSPORT_ID),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaStub.passportCollectionItem.deleteMany).not.toHaveBeenCalled();
    });

    it('404s for a collection that does not exist', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.passportCollection.findUnique.mockResolvedValue(null);
      await expect(
        svc.removeFromCollection(OWNER_ID, COLLECTION_ID, PASSPORT_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteCollection', () => {
    it('rejects a caller who does not own the collection', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.passportCollection.findUnique.mockResolvedValue({ id: COLLECTION_ID, userId: OWNER_ID });

      await expect(svc.deleteCollection(OTHER_ID, COLLECTION_ID)).rejects.toThrow(ForbiddenException);
      expect(prismaStub.passportCollection.delete).not.toHaveBeenCalled();
    });

    it('404s for a collection that does not exist', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.passportCollection.findUnique.mockResolvedValue(null);
      await expect(svc.deleteCollection(OWNER_ID, COLLECTION_ID)).rejects.toThrow(NotFoundException);
    });

    it('allows the owner to delete it', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.passportCollection.findUnique.mockResolvedValue({ id: COLLECTION_ID, userId: OWNER_ID });
      prismaStub.passportCollection.delete.mockResolvedValue({});

      const result = await svc.deleteCollection(OWNER_ID, COLLECTION_ID);
      expect(result).toEqual({ success: true });
    });
  });
});
