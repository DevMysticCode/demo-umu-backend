/**
 * Coverage for the ownership checks that guard every caller-supplied-id
 * mutation/read in ProfileService.
 *
 * Surfaces tested: updateAddress, deleteAddress, updateCompany,
 * deleteCompany, verifyCompany, updateSolicitor, deleteSolicitor,
 * getOrAssignFounderNumber, getCollaborator, removeCollaborator - each
 * route takes an id supplied by the caller (address/:id, company/:id,
 * solicitor/:id, collaborators/:id, ?passportId=) with no other scoping,
 * so "does the row's owner match the caller before any read/mutation" is
 * the one thing standing between a logged-in user and someone else's
 * profile data.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProfileService } from './profile.service';

function makeService() {
  const prismaStub: any = {
    userAddress: { findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
    userCompany: { findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
    userSolicitor: { findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
    passport: { findUnique: jest.fn() },
    founderNumber: { findUnique: jest.fn(), create: jest.fn() },
    userCollaborator: { findUnique: jest.fn(), delete: jest.fn() },
    user: { findUnique: jest.fn() },
  };
  const filesStub: any = { buildSignedUrl: jest.fn().mockReturnValue('/files/signed') };
  return { svc: new ProfileService(prismaStub, filesStub), prismaStub };
}

const OWNER_ID = 'owner-1';
const OTHER_ID = 'other-2';
const ROW_ID = 'row-1';

describe('ProfileService ownership checks', () => {
  describe('address', () => {
    it('updateAddress rejects a caller who does not own the address', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userAddress.findUnique.mockResolvedValue({ id: ROW_ID, userId: OWNER_ID });

      await expect(svc.updateAddress(OTHER_ID, ROW_ID, { label: 'x' } as any)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prismaStub.userAddress.update).not.toHaveBeenCalled();
    });

    it('updateAddress 404s when the address does not exist', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userAddress.findUnique.mockResolvedValue(null);
      await expect(svc.updateAddress(OWNER_ID, ROW_ID, {} as any)).rejects.toThrow(NotFoundException);
    });

    it('deleteAddress rejects a caller who does not own the address', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userAddress.findUnique.mockResolvedValue({ id: ROW_ID, userId: OWNER_ID });

      await expect(svc.deleteAddress(OTHER_ID, ROW_ID)).rejects.toThrow(ForbiddenException);
      expect(prismaStub.userAddress.delete).not.toHaveBeenCalled();
    });

    it('deleteAddress allows the owner', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userAddress.findUnique.mockResolvedValue({ id: ROW_ID, userId: OWNER_ID });
      prismaStub.userAddress.delete.mockResolvedValue({});

      const result = await svc.deleteAddress(OWNER_ID, ROW_ID);
      expect(result).toEqual({ message: 'Address deleted' });
    });
  });

  describe('company', () => {
    it('updateCompany rejects a caller who does not own the company', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userCompany.findUnique.mockResolvedValue({ id: ROW_ID, userId: OWNER_ID, companyNumber: null });

      await expect(svc.updateCompany(OTHER_ID, ROW_ID, {} as any)).rejects.toThrow(ForbiddenException);
      expect(prismaStub.userCompany.update).not.toHaveBeenCalled();
    });

    it('deleteCompany rejects a caller who does not own the company', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userCompany.findUnique.mockResolvedValue({ id: ROW_ID, userId: OWNER_ID });

      await expect(svc.deleteCompany(OTHER_ID, ROW_ID)).rejects.toThrow(ForbiddenException);
      expect(prismaStub.userCompany.delete).not.toHaveBeenCalled();
    });

    it('verifyCompany rejects a caller who does not own the company', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userCompany.findUnique.mockResolvedValue({ id: ROW_ID, userId: OWNER_ID, companyNumber: null });

      await expect(svc.verifyCompany(OTHER_ID, ROW_ID)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('solicitor', () => {
    it('updateSolicitor rejects a caller who does not own the solicitor', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userSolicitor.findUnique.mockResolvedValue({ id: ROW_ID, userId: OWNER_ID });

      await expect(svc.updateSolicitor(OTHER_ID, ROW_ID, {} as any)).rejects.toThrow(ForbiddenException);
      expect(prismaStub.userSolicitor.update).not.toHaveBeenCalled();
    });

    it('deleteSolicitor rejects a caller who does not own the solicitor', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userSolicitor.findUnique.mockResolvedValue({ id: ROW_ID, userId: OWNER_ID });

      await expect(svc.deleteSolicitor(OTHER_ID, ROW_ID)).rejects.toThrow(ForbiddenException);
      expect(prismaStub.userSolicitor.delete).not.toHaveBeenCalled();
    });
  });

  describe('getOrAssignFounderNumber', () => {
    it('rejects a caller who does not own the passport', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.passport.findUnique.mockResolvedValue({ ownerId: OWNER_ID });

      await expect(svc.getOrAssignFounderNumber(OTHER_ID, 'passport-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prismaStub.founderNumber.findUnique).not.toHaveBeenCalled();
    });

    it('404s when the passport does not exist', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.passport.findUnique.mockResolvedValue(null);

      await expect(svc.getOrAssignFounderNumber(OWNER_ID, 'passport-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('allows the owner', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.passport.findUnique.mockResolvedValue({ ownerId: OWNER_ID });
      prismaStub.founderNumber.findUnique.mockResolvedValue({ number: 7, passportId: 'passport-1' });

      const result = await svc.getOrAssignFounderNumber(OWNER_ID, 'passport-1');
      expect(result).toEqual({ number: 7, passportId: 'passport-1', isNew: false });
    });
  });

  describe('collaborators', () => {
    it('getCollaborator rejects a caller who does not own the row', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userCollaborator.findUnique.mockResolvedValue({
        id: ROW_ID,
        userId: OWNER_ID,
        collaborator: { id: 'c1', firstName: 'A', lastName: 'B', email: 'a@b.com', avatarUrl: null, createdAt: new Date() },
        permission: 'all',
        propertyIds: [],
        role: null,
        accessDuration: 'permanent',
        expiresAt: null,
        clientAccess: 'shared',
        allowComms: true,
        createdAt: new Date(),
      });

      await expect(svc.getCollaborator(OTHER_ID, ROW_ID)).rejects.toThrow(ForbiddenException);
    });

    it('getCollaborator 404s when the row does not exist', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userCollaborator.findUnique.mockResolvedValue(null);
      await expect(svc.getCollaborator(OWNER_ID, ROW_ID)).rejects.toThrow(NotFoundException);
    });

    it('removeCollaborator rejects a caller who does not own the row', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userCollaborator.findUnique.mockResolvedValue({ id: ROW_ID, userId: OWNER_ID });

      await expect(svc.removeCollaborator(OTHER_ID, ROW_ID)).rejects.toThrow(ForbiddenException);
      expect(prismaStub.userCollaborator.delete).not.toHaveBeenCalled();
    });

    it('removeCollaborator allows the owner', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userCollaborator.findUnique.mockResolvedValue({ id: ROW_ID, userId: OWNER_ID });
      prismaStub.userCollaborator.delete.mockResolvedValue({});

      const result = await svc.removeCollaborator(OWNER_ID, ROW_ID);
      expect(result).toEqual({ message: 'Collaborator removed' });
    });
  });
});
