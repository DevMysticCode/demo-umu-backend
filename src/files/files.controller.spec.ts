/**
 * Coverage for FilesController — the HTTP entry point to signed-URL
 * file delivery.
 *
 * Two layers worth testing here that aren't covered by FilesService:
 *   1. Path-traversal guards: dotfile / `..` / separator-in-path
 *      rejection BEFORE any FS or DB call.
 *   2. Verification-then-stream sequencing: must call res.sendFile
 *      only after FilesService.verifyAndAuthorise succeeds.
 *
 * res.sendFile and fs.existsSync are spied; we don't touch the disk.
 * FilesService is stubbed so we can drive its success / failure modes
 * without HMAC-signing real URLs in every test.
 */
// Mock fs.existsSync at the module level — jest.spyOn can't redefine
// the named binding once it's been imported by the controller.
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn(() => true),
  };
});

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { existsSync } from 'fs';
import { FilesController } from './files.controller';

function makeMocks() {
  const filesStub: any = {
    verifyAndAuthorise: jest.fn().mockResolvedValue({ userId: 'user-1' }),
  };
  const controller = new FilesController(filesStub);

  const res: any = {
    set: jest.fn().mockReturnThis(),
    sendFile: jest.fn(),
  };
  return { controller, filesStub, res };
}

beforeEach(() => {
  (existsSync as jest.Mock).mockReturnValue(true);
});

describe('FilesController path-safety guards', () => {
  // These all run BEFORE verifyAndAuthorise is called — the controller
  // refuses obviously-bad params without paying the DB or HMAC cost.
  const badInputs = [
    { bucket: '..', filename: 'abc.pdf', why: 'bucket is `..`' },
    { bucket: 'documents', filename: '..', why: 'filename is `..`' },
    { bucket: 'documents/sub', filename: 'abc.pdf', why: 'bucket contains slash' },
    { bucket: 'documents\\sub', filename: 'abc.pdf', why: 'bucket contains backslash' },
    { bucket: 'documents', filename: '.htaccess', why: 'filename starts with dot' },
    { bucket: 'documents', filename: '../../etc/passwd', why: 'filename contains traversal' },
    { bucket: '', filename: 'abc.pdf', why: 'empty bucket' },
    { bucket: 'documents', filename: '', why: 'empty filename' },
  ];

  it.each(badInputs)('rejects $why', async ({ bucket, filename }) => {
    const { controller, filesStub, res } = makeMocks();
    await expect(
      controller.serve(bucket, filename, 'user-1', '123', 'sig', res),
    ).rejects.toThrow(BadRequestException);
    expect(filesStub.verifyAndAuthorise).not.toHaveBeenCalled();
    expect(res.sendFile).not.toHaveBeenCalled();
  });
});

describe('FilesController verify → stream', () => {
  it('rejects with generic 403 when verifyAndAuthorise throws', async () => {
    const { controller, filesStub, res } = makeMocks();
    filesStub.verifyAndAuthorise.mockRejectedValue(new Error('signature mismatch'));

    await expect(
      controller.serve('documents', 'abc.pdf', 'user-1', '123', 'sig', res),
    ).rejects.toThrow(ForbiddenException);
    // CRITICAL: the file must not be served when verification fails,
    // even though the path itself was valid.
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('does NOT echo the verification reason (no oracle for attackers)', async () => {
    const { controller, filesStub, res } = makeMocks();
    filesStub.verifyAndAuthorise.mockRejectedValue(new Error('expired'));

    try {
      await controller.serve('documents', 'abc.pdf', 'user-1', '123', 'sig', res);
      fail('should have thrown');
    } catch (err: any) {
      // The thrown error is the controller's opaque ForbiddenException —
      // NOT the inner "expired" reason. An attacker probing the endpoint
      // can't distinguish "wrong sig" from "expired" from "no access".
      expect(err.message).not.toContain('expired');
      expect(err.message).toBe('Access denied');
    }
  });

  it('returns 404 when the file does not exist on disk', async () => {
    const { controller, res } = makeMocks();
    (existsSync as jest.Mock).mockReturnValueOnce(false);

    await expect(
      controller.serve('documents', 'abc.pdf', 'user-1', '123', 'sig', res),
    ).rejects.toThrow(NotFoundException);
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('streams the file when verification + disk check both pass', async () => {
    const { controller, filesStub, res } = makeMocks();

    await controller.serve('documents', 'abc.pdf', 'user-1', '123', 'sig', res);

    expect(filesStub.verifyAndAuthorise).toHaveBeenCalledWith(
      'documents/abc.pdf',
      'sig',
      '123',
      'user-1',
    );
    // Cache + content-disposition + sendFile all wired.
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, max-age=300');
    expect(res.set).toHaveBeenCalledWith('Content-Disposition', 'inline');
    expect(res.sendFile).toHaveBeenCalledTimes(1);
    const sentPath: string = res.sendFile.mock.calls[0][0];
    // Path is the absolute uploads-rooted form.
    expect(sentPath).toMatch(/[\\/]uploads[\\/]documents[\\/]abc\.pdf$/);
  });
});
