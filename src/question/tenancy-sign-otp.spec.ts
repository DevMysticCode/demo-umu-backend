/**
 * Coverage for the OTP gate added to the tenant e-signing flow (Onward
 * pen-test finding #6, 2026-11-16): a forwarded sign link must not stay
 * signable just because token the real tenant holds hasn't expired.
 *
 * Surfaces tested: createTenancySignLink (tenantEmail now required,
 * shorter expiry), requestSignOtp (resend cooldown, rejects on an
 * already-used/expired link), submitTenantSignature (otpCode required,
 * verified against the stored code at submit time - not a persisted
 * "verified" flag - wrong code increments attempts, lockout after too
 * many, expired code rejected, and successful signature records the
 * tenant's email in the audit trail).
 */

// Mock Resend so the constructor's `new Resend(...)` doesn't make any
// network call, and tests can inspect/control what was "sent".
const resendSend = jest.fn().mockResolvedValue({ id: 'mock', error: null });
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: (...args: any[]) => resendSend(...args) },
  })),
}));

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QuestionService } from './question.service';

function makeService() {
  const prismaStub: any = {
    tenancySignLink: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    passportQuestion: { findUnique: jest.fn() },
    questionAnswer: { upsert: jest.fn() },
  };
  const passportServiceStub: any = { checkUserAccess: jest.fn() };
  const eventsStub: any = {};
  const actionsStub: any = {};
  const pathwaysStub: any = {};
  const rewardsStub: any = {};
  const documentsStub: any = {};
  const svc = new QuestionService(
    prismaStub,
    passportServiceStub,
    eventsStub,
    actionsStub,
    pathwaysStub,
    rewardsStub,
    documentsStub,
  );
  return { svc, prismaStub, passportServiceStub };
}

const TOKEN = 'tok-123';
const TENANT_EMAIL = 'tenant@example.com';

function baseLink(extra: any = {}) {
  const future = new Date(Date.now() + 60 * 60 * 1000);
  return {
    token: TOKEN,
    passportQuestionId: 'question-1',
    kind: 'tenancy',
    tenantEmail: TENANT_EMAIL,
    expiresAt: future,
    usedAt: null,
    otpCode: null,
    otpSentAt: null,
    otpExpiresAt: null,
    otpAttempts: 0,
    ...extra,
  };
}

beforeEach(() => {
  resendSend.mockClear();
  resendSend.mockResolvedValue({ id: 'mock', error: null });
});

function stubQuestionAccess(prismaStub: any, passportServiceStub: any) {
  prismaStub.passportQuestion.findUnique.mockResolvedValue({
    id: 'question-1',
    passportSectionTask: { passportSection: { passportId: 'passport-1' } },
  });
  passportServiceStub.checkUserAccess.mockResolvedValue(true);
}

describe('createTenancySignLink', () => {
  it('rejects a missing/invalid tenantEmail', async () => {
    const { svc, prismaStub, passportServiceStub } = makeService();
    stubQuestionAccess(prismaStub, passportServiceStub);
    await expect(
      svc.createTenancySignLink('question-1', 'landlord-1', 'tenancy', undefined, undefined),
    ).rejects.toThrow(BadRequestException);
    await expect(
      svc.createTenancySignLink('question-1', 'landlord-1', 'tenancy', undefined, 'not-an-email'),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates a link with the tenant email stored and a 7-day expiry', async () => {
    const { svc, prismaStub, passportServiceStub } = makeService();
    stubQuestionAccess(prismaStub, passportServiceStub);
    prismaStub.tenancySignLink.create.mockResolvedValue({ token: TOKEN });
    await svc.createTenancySignLink('question-1', 'landlord-1', 'tenancy', undefined, ' Tenant@Example.com ');

    const data = prismaStub.tenancySignLink.create.mock.calls[0][0].data;
    expect(data.tenantEmail).toBe('tenant@example.com');
    const days = (data.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });
});

describe('requestSignOtp', () => {
  it('404s on an unknown token', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.tenancySignLink.findUnique.mockResolvedValue(null);
    await expect(svc.requestSignOtp(TOKEN)).rejects.toThrow(NotFoundException);
  });

  it('rejects an expired link', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.tenancySignLink.findUnique.mockResolvedValue(
      baseLink({ expiresAt: new Date(Date.now() - 1000) }),
    );
    await expect(svc.requestSignOtp(TOKEN)).rejects.toThrow(ForbiddenException);
  });

  it('rejects a link already used to sign', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.tenancySignLink.findUnique.mockResolvedValue(baseLink({ usedAt: new Date() }));
    await expect(svc.requestSignOtp(TOKEN)).rejects.toThrow(ForbiddenException);
  });

  it('enforces the resend cooldown', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.tenancySignLink.findUnique.mockResolvedValue(
      baseLink({ otpSentAt: new Date(Date.now() - 5000) }),
    );
    await expect(svc.requestSignOtp(TOKEN)).rejects.toThrow(BadRequestException);
    expect(resendSend).not.toHaveBeenCalled();
  });

  it('sends a code to the link tenant email and stores it', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.tenancySignLink.findUnique.mockResolvedValue(baseLink());
    const result = await svc.requestSignOtp(TOKEN);

    expect(result).toEqual({ sent: true });
    expect(resendSend).toHaveBeenCalledTimes(1);
    expect(resendSend.mock.calls[0][0].to).toBe(TENANT_EMAIL);
    const updateData = prismaStub.tenancySignLink.update.mock.calls[0][0].data;
    expect(updateData.otpCode).toMatch(/^\d{6}$/);
    expect(updateData.otpAttempts).toBe(0);
  });
});

function signDto(extra: any = {}) {
  return {
    signerName: 'Jane Tenant',
    signatureDataUrl: 'data:image/png;base64,QUJD',
    otpCode: '123456',
    ...extra,
  };
}

describe('submitTenantSignature OTP gate', () => {
  it('rejects when no otpCode is supplied', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.tenancySignLink.findUnique.mockResolvedValue(
      baseLink({ otpCode: '123456', otpExpiresAt: new Date(Date.now() + 60_000) }),
    );
    await expect(
      svc.submitTenantSignature(TOKEN, signDto({ otpCode: '' }), '1.2.3.4'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when no code was ever requested', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.tenancySignLink.findUnique.mockResolvedValue(baseLink());
    await expect(
      svc.submitTenantSignature(TOKEN, signDto(), '1.2.3.4'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects an expired code', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.tenancySignLink.findUnique.mockResolvedValue(
      baseLink({ otpCode: '123456', otpExpiresAt: new Date(Date.now() - 1000) }),
    );
    await expect(
      svc.submitTenantSignature(TOKEN, signDto(), '1.2.3.4'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a wrong code and increments attempts', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.tenancySignLink.findUnique.mockResolvedValue(
      baseLink({ otpCode: '654321', otpExpiresAt: new Date(Date.now() + 60_000), otpAttempts: 1 }),
    );
    await expect(
      svc.submitTenantSignature(TOKEN, signDto({ otpCode: '000000' }), '1.2.3.4'),
    ).rejects.toThrow(ForbiddenException);
    expect(prismaStub.tenancySignLink.update).toHaveBeenCalledWith({
      where: { token: TOKEN },
      data: { otpAttempts: { increment: 1 } },
    });
  });

  it('locks out after too many incorrect attempts', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.tenancySignLink.findUnique.mockResolvedValue(
      baseLink({ otpCode: '654321', otpExpiresAt: new Date(Date.now() + 60_000), otpAttempts: 5 }),
    );
    await expect(
      svc.submitTenantSignature(TOKEN, signDto({ otpCode: '654321' }), '1.2.3.4'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('accepts the right code, signs, and records the tenant email in the audit trail', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.tenancySignLink.findUnique.mockResolvedValue(
      baseLink({ otpCode: '123456', otpExpiresAt: new Date(Date.now() + 60_000) }),
    );
    prismaStub.passportQuestion.findUnique.mockResolvedValue({
      id: 'question-1',
      answer: { answerJson: { tenantName: 'Jane Tenant' } },
    });

    const result = await svc.submitTenantSignature(TOKEN, signDto(), '1.2.3.4');

    expect(result).toEqual({ success: true });
    const upsertData = prismaStub.questionAnswer.upsert.mock.calls[0][0];
    expect(upsertData.update.answerJson.audit.tenant).toMatchObject({
      name: 'Jane Tenant',
      email: TENANT_EMAIL,
      ip: '1.2.3.4',
    });
    expect(prismaStub.tenancySignLink.update).toHaveBeenCalledWith({
      where: { token: TOKEN },
      data: { usedAt: expect.any(Date) },
    });
  });
});
