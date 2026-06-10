/**
 * Regression coverage for the HMAC-signed file URL flow.
 *
 * The cryptographic heart of /uploads/* auth — if any of these fail,
 * the security model is broken. DB-ownership checks are mocked here;
 * they're covered by the ownership lookup logic itself, which is just
 * a Prisma findFirst.
 */
import { FilesService } from './files.service';

function makeSvc() {
  const prismaStub: any = {
    userDocument: { findFirst: jest.fn().mockResolvedValue(null) },
    questionAnswer: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  return { svc: new FilesService(prismaStub), prismaStub };
}

describe('FilesService — signing', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'sentinel-secret-at-least-sixteen-chars';
  });

  it('buildSignedUrl produces /files/<path>?u=&exp=&sig=', () => {
    const { svc } = makeSvc();
    const url = svc.buildSignedUrl('documents/abc.pdf', 'user-1');
    expect(url).toMatch(/^\/files\/documents\/abc\.pdf\?/);
    expect(url).toContain('u=user-1');
    expect(url).toContain('exp=');
    expect(url).toMatch(/sig=[0-9a-f]{64}/);
  });

  it('strips leading and trailing slashes from the path', () => {
    const { svc } = makeSvc();
    const url = svc.buildSignedUrl('/documents/abc.pdf/', 'user-1');
    expect(url).toMatch(/^\/files\/documents\/abc\.pdf\?/);
  });

  it('the signature depends on (path, userId, exp) — changing any of them changes the sig', () => {
    const { svc } = makeSvc();
    const a = new URLSearchParams(svc.buildSignedQuery('documents/abc.pdf', 'user-1')).get('sig');
    const b = new URLSearchParams(svc.buildSignedQuery('documents/abc.pdf', 'user-2')).get('sig');
    const c = new URLSearchParams(svc.buildSignedQuery('documents/xyz.pdf', 'user-1')).get('sig');
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('FilesService — verifyAndAuthorise', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'sentinel-secret-at-least-sixteen-chars';
  });

  it('accepts a freshly-signed URL when the user owns the document', async () => {
    const { svc, prismaStub } = makeSvc();
    prismaStub.userDocument.findFirst.mockResolvedValue({ id: 'doc-1' });
    const q = svc.buildSignedQuery('documents/abc.pdf', 'user-1');
    const params = new URLSearchParams(q);
    await expect(
      svc.verifyAndAuthorise(
        'documents/abc.pdf',
        params.get('sig')!,
        params.get('exp')!,
        'user-1',
      ),
    ).resolves.toEqual({ userId: 'user-1' });
  });

  it('rejects a tampered signature', async () => {
    const { svc, prismaStub } = makeSvc();
    prismaStub.userDocument.findFirst.mockResolvedValue({ id: 'doc-1' });
    await expect(
      svc.verifyAndAuthorise(
        'documents/abc.pdf',
        'a'.repeat(64), // wrong sig
        String(Math.floor(Date.now() / 1000) + 3600),
        'user-1',
      ),
    ).rejects.toThrow(/signature/i);
  });

  it('rejects when the URL has expired', async () => {
    const { svc, prismaStub } = makeSvc();
    prismaStub.userDocument.findFirst.mockResolvedValue({ id: 'doc-1' });
    const expiredExp = Math.floor(Date.now() / 1000) - 60;
    // We need to use the same exp the sig was generated for.
    const sig = (svc as any).computeSig('documents/abc.pdf', 'user-1', expiredExp);
    await expect(
      svc.verifyAndAuthorise('documents/abc.pdf', sig, String(expiredExp), 'user-1'),
    ).rejects.toThrow(/expired/i);
  });

  it('rejects when the user does not own the file (DB miss)', async () => {
    const { svc } = makeSvc();
    // Both findFirst mocks return null by default
    const q = svc.buildSignedQuery('documents/abc.pdf', 'user-1');
    const params = new URLSearchParams(q);
    await expect(
      svc.verifyAndAuthorise(
        'documents/abc.pdf',
        params.get('sig')!,
        params.get('exp')!,
        'user-1',
      ),
    ).rejects.toThrow(/does not own/i);
  });

  it('rejects an attempted user-swap (sig issued for user-1, query says user-2)', async () => {
    const { svc, prismaStub } = makeSvc();
    prismaStub.userDocument.findFirst.mockResolvedValue({ id: 'doc-1' });
    const q1 = svc.buildSignedQuery('documents/abc.pdf', 'user-1');
    const params = new URLSearchParams(q1);
    // Pretend the attacker swapped u=user-1 for u=user-2 while reusing
    // the signature. computeSig binds the userId so verify fails.
    await expect(
      svc.verifyAndAuthorise(
        'documents/abc.pdf',
        params.get('sig')!,
        params.get('exp')!,
        'user-2',
      ),
    ).rejects.toThrow(/signature|does not own/i);
  });
});
