/**
 * Coverage for KycService — focused on the security boundary.
 *
 * The Persona webhook is public (no JWT) — its only auth is the HMAC
 * signature. If that verification ever breaks, anyone can flip
 * `user.isVerified = true` by POSTing a forged payload. These tests
 * lock the contract in place.
 *
 * `normaliseStatus` is private but small + critical (Persona's status
 * vocabulary → our 4 internal states). Reached via cast.
 */
import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { KycService } from './kyc.service';

const SECRET = 'whtest_persona_signing_secret_value';

function signBody(body: string, ts: string, secret = SECRET): string {
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return `t=${ts},v1=${sig}`;
}

function makeService() {
  const prismaStub: any = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  return { svc: new KycService(prismaStub), prismaStub };
}

beforeAll(() => {
  process.env.PERSONA_WEBHOOK_SECRET = SECRET;
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('KycService.handleWebhook — HMAC verification', () => {
  it('returns ok:false (does not throw) when PERSONA_WEBHOOK_SECRET is unset', async () => {
    delete process.env.PERSONA_WEBHOOK_SECRET;
    const { svc, prismaStub } = makeService();
    const res = await svc.handleWebhook('{}', 'sig');
    expect(res).toEqual({ ok: false });
    // No user touched without the secret.
    expect(prismaStub.user.update).not.toHaveBeenCalled();
    process.env.PERSONA_WEBHOOK_SECRET = SECRET;
  });

  it('throws BadRequest when the Persona-Signature header is missing', async () => {
    const { svc } = makeService();
    await expect(svc.handleWebhook('{}', undefined)).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequest when the signature header is malformed', async () => {
    const { svc } = makeService();
    await expect(svc.handleWebhook('{}', 'no-equals-signs')).rejects.toThrow(
      BadRequestException,
    );
    await expect(svc.handleWebhook('{}', 't=,v1=')).rejects.toThrow(BadRequestException);
  });

  it('REJECTS a forged signature (HMAC computed with wrong secret)', async () => {
    const { svc, prismaStub } = makeService();
    const body = JSON.stringify({ data: { attributes: { name: 'inquiry.approved' } } });
    const ts = String(Math.floor(Date.now() / 1000));
    const forgedHeader = signBody(body, ts, 'wrong-secret');

    await expect(svc.handleWebhook(body, forgedHeader)).rejects.toThrow(
      BadRequestException,
    );
    // CRITICAL regression guard: never persist on a bad signature.
    expect(prismaStub.user.update).not.toHaveBeenCalled();
  });

  it('REJECTS a body that has been tampered with after signing', async () => {
    const { svc, prismaStub } = makeService();
    const originalBody = JSON.stringify({ data: { attributes: { name: 'inquiry.approved' } } });
    const ts = String(Math.floor(Date.now() / 1000));
    const validHeader = signBody(originalBody, ts);

    const tamperedBody = JSON.stringify({
      data: { attributes: { name: 'inquiry.approved', extra: 'oops' } },
    });

    await expect(svc.handleWebhook(tamperedBody, validHeader)).rejects.toThrow(
      BadRequestException,
    );
    expect(prismaStub.user.update).not.toHaveBeenCalled();
  });

  it('accepts a correctly-signed webhook and proceeds to payload processing', async () => {
    const { svc, prismaStub } = makeService();
    const body = JSON.stringify({
      data: {
        attributes: {
          name: 'inquiry.approved',
          payload: {
            data: {
              id: 'inq_test_123',
              attributes: {
                status: 'approved',
                'reference-id': 'user-1',
              },
            },
          },
        },
      },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const header = signBody(body, ts);

    prismaStub.user.findUnique.mockResolvedValue({ id: 'user-1' });

    const res = await svc.handleWebhook(body, header);
    expect(res).toEqual({ ok: true });
    expect(prismaStub.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({ kycStatus: 'approved', isVerified: true }),
      }),
    );
  });

  it('returns ok:true (logged + ignored) for an incomplete payload — no crash', async () => {
    const { svc, prismaStub } = makeService();
    const body = JSON.stringify({ data: { attributes: {} } }); // missing name + payload
    const ts = String(Math.floor(Date.now() / 1000));
    const header = signBody(body, ts);

    const res = await svc.handleWebhook(body, header);
    expect(res).toEqual({ ok: true });
    expect(prismaStub.user.update).not.toHaveBeenCalled();
  });
});

describe('KycService.normaliseStatus', () => {
  // Private method reached via cast — locks in the Persona-status → our-status mapping.
  const svc = makeService().svc;
  const norm = (s: string) => (svc as any).normaliseStatus(s);

  it.each([
    ['approved', 'approved'],
    ['completed', 'approved'],
    ['passed', 'approved'],
    ['APPROVED', 'approved'], // case-insensitive
    ['declined', 'declined'],
    ['failed', 'declined'],
    ['needs_review', 'needs_review'],
    ['needs-review', 'needs_review'],
    ['open', 'needs_review'],
    ['anything-else', 'pending'],
    ['', 'pending'],
  ])('maps Persona "%s" → "%s"', (input, expected) => {
    expect(norm(input)).toBe(expected);
  });
});
