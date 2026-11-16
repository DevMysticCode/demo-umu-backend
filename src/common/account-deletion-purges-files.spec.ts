/**
 * Finding #10 regression guard: both places an account can be deleted
 * (self-service and admin bulk-delete) must purge the user's files
 * BEFORE the row delete - once the row is gone, its fileUrl columns
 * are gone too.
 */
const purgeUserFiles = jest.fn().mockResolvedValue(undefined);
jest.mock('./purge-user-files', () => ({
  purgeUserFiles: (...args: any[]) => purgeUserFiles(...args),
}));

import { ProfileService } from '../profile/profile.service';
import { AdminService } from '../admin/admin.service';

beforeEach(() => {
  purgeUserFiles.mockClear();
});

describe('ProfileService.deleteAccount', () => {
  it('purges files before deleting the user row', async () => {
    const calls: string[] = [];
    purgeUserFiles.mockImplementation(async () => {
      calls.push('purge');
    });
    const prismaStub: any = {
      user: {
        delete: jest.fn().mockImplementation(async () => {
          calls.push('delete');
        }),
      },
    };
    const svc = new ProfileService(prismaStub, { buildSignedUrl: jest.fn() } as any);
    await svc.deleteAccount('user-1');

    expect(purgeUserFiles).toHaveBeenCalledWith(prismaStub, 'user-1');
    expect(calls).toEqual(['purge', 'delete']);
  });
});

describe('AdminService.deleteUsersByEmail', () => {
  it('purges files before deleting each matched user row', async () => {
    const calls: string[] = [];
    purgeUserFiles.mockImplementation(async () => {
      calls.push('purge');
    });
    const prismaStub: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1', email: 'a@example.com' }),
        delete: jest.fn().mockImplementation(async () => {
          calls.push('delete');
        }),
      },
    };
    const svc = new AdminService(prismaStub);
    const result = await svc.deleteUsersByEmail(['a@example.com']);

    expect(result.deleted).toEqual(['a@example.com']);
    expect(purgeUserFiles).toHaveBeenCalledWith(prismaStub, 'user-1');
    expect(calls).toEqual(['purge', 'delete']);
  });

  it('does not purge for an email that was not found', async () => {
    const prismaStub: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        delete: jest.fn(),
      },
    };
    const svc = new AdminService(prismaStub);
    const result = await svc.deleteUsersByEmail(['nobody@example.com']);

    expect(result.notFound).toEqual(['nobody@example.com']);
    expect(purgeUserFiles).not.toHaveBeenCalled();
    expect(prismaStub.user.delete).not.toHaveBeenCalled();
  });
});
