/**
 * Regression coverage for finding #8: confirms every admin/maintenance/
 * verifier-admin route actually calls assertAdminAccess with the real
 * request's secret/IP before touching its service - admin-guard.spec.ts
 * covers the guard function in isolation, this covers that each
 * controller is wired to it correctly, so a future edit to any of these
 * routes can't silently skip the check for just one of them.
 */
import { ForbiddenException } from '@nestjs/common';
import { AdminController } from '../admin/admin.controller';
import { MaintenanceController } from '../maintenance/maintenance.controller';
import { VerifierAdminController } from '../verifier-api/verifier-api.controller';

const GOOD_SECRET = 'correct-admin-secret';
const IP = '203.0.113.9';

beforeEach(() => {
  process.env.ADMIN_SECRET = GOOD_SECRET;
  delete process.env.ADMIN_IP_ALLOWLIST;
});

describe('AdminController', () => {
  function makeController() {
    const adminServiceStub: any = {
      findUsersByEmailContains: jest.fn().mockResolvedValue([]),
      deleteUsersByEmail: jest.fn().mockResolvedValue({ deleted: [], notFound: [] }),
    };
    return { controller: new AdminController(adminServiceStub), adminServiceStub };
  }

  it('rejects searchUsers with a wrong secret and never calls the service', async () => {
    const { controller, adminServiceStub } = makeController();
    await expect(
      controller.searchUsers('wrong-secret', 'foo', IP),
    ).rejects.toThrow(ForbiddenException);
    expect(adminServiceStub.findUsersByEmailContains).not.toHaveBeenCalled();
  });

  it('rejects deleteUsers when the IP allowlist is set and the caller is outside it, even with the right secret', async () => {
    process.env.ADMIN_IP_ALLOWLIST = '10.0.0.0/24';
    const { controller, adminServiceStub } = makeController();
    await expect(
      controller.deleteUsers(GOOD_SECRET, ['a@b.com'], IP),
    ).rejects.toThrow(ForbiddenException);
    expect(adminServiceStub.deleteUsersByEmail).not.toHaveBeenCalled();
  });

  it('allows searchUsers through with the right secret and no allowlist configured', async () => {
    const { controller, adminServiceStub } = makeController();
    await controller.searchUsers(GOOD_SECRET, 'foo', IP);
    expect(adminServiceStub.findUsersByEmailContains).toHaveBeenCalledWith(['foo']);
  });
});

describe('MaintenanceController', () => {
  function makeController() {
    const maintenanceServiceStub: any = {
      clearPexelsImages: jest.fn().mockResolvedValue({ updated: 0 }),
      deleteAllPassports: jest.fn().mockResolvedValue({ deleted: 0 }),
      deleteAllProperties: jest.fn().mockResolvedValue({ deleted: 0 }),
      nukeAll: jest.fn().mockResolvedValue({ passportsDeleted: 0, propertiesDeleted: 0 }),
    };
    return { controller: new MaintenanceController(maintenanceServiceStub), maintenanceServiceStub };
  }

  it('rejects the one-shot wipe with a wrong secret, before even checking confirm', async () => {
    const { controller, maintenanceServiceStub } = makeController();
    await expect(
      controller.deleteAll('wrong-secret', 'DELETE-EVERYTHING', IP),
    ).rejects.toThrow(ForbiddenException);
    expect(maintenanceServiceStub.nukeAll).not.toHaveBeenCalled();
  });

  it('rejects the one-shot wipe with the right secret but wrong confirm literal', async () => {
    const { controller, maintenanceServiceStub } = makeController();
    await expect(
      controller.deleteAll(GOOD_SECRET, 'not-the-right-literal', IP),
    ).rejects.toThrow();
    expect(maintenanceServiceStub.nukeAll).not.toHaveBeenCalled();
  });

  it('rejects a destructive call from outside the configured IP allowlist even with the right secret and confirm', async () => {
    process.env.ADMIN_IP_ALLOWLIST = '10.0.0.0/24';
    const { controller, maintenanceServiceStub } = makeController();
    await expect(
      controller.deletePassports(GOOD_SECRET, 'DELETE-EVERYTHING', IP),
    ).rejects.toThrow(ForbiddenException);
    expect(maintenanceServiceStub.deleteAllPassports).not.toHaveBeenCalled();
  });

  it('allows the one-shot wipe through with the right secret and confirm literal', async () => {
    const { controller, maintenanceServiceStub } = makeController();
    await controller.deleteAll(GOOD_SECRET, 'DELETE-EVERYTHING', IP);
    expect(maintenanceServiceStub.nukeAll).toHaveBeenCalled();
  });
});

describe('VerifierAdminController', () => {
  function makeController() {
    const verifierServiceStub: any = {
      registerOrg: jest.fn().mockResolvedValue({ org: {}, clientSecret: 'x' }),
    };
    return { controller: new VerifierAdminController(verifierServiceStub), verifierServiceStub };
  }

  it('rejects registerOrg with a wrong secret and never calls the service', async () => {
    const { controller, verifierServiceStub } = makeController();
    await expect(
      controller.registerOrg('wrong-secret', { name: 'Acme', contactEmail: 'a@acme.com' } as any, IP),
    ).rejects.toThrow(ForbiddenException);
    expect(verifierServiceStub.registerOrg).not.toHaveBeenCalled();
  });

  it('allows registerOrg through with the right secret', async () => {
    const { controller, verifierServiceStub } = makeController();
    await controller.registerOrg(GOOD_SECRET, { name: 'Acme', contactEmail: 'a@acme.com' } as any, IP);
    expect(verifierServiceStub.registerOrg).toHaveBeenCalled();
  });
});
