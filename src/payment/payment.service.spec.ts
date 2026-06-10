/**
 * Coverage for the £99 passport-unlock paywall.
 *
 * Mocks Prisma + the Stripe SDK so tests run with zero IO. Any
 * regression that re-opens the DF4 Finding #1 bypass should fail here.
 */

// Mock the stripe package BEFORE importing anything that touches it.
// PaymentService instantiates `new Stripe(key)` in its constructor.
const stripePaymentIntents = {
  create: jest.fn(),
  retrieve: jest.fn(),
};
const stripeWebhooks = {
  constructEvent: jest.fn(),
};
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: stripePaymentIntents,
    webhooks: stripeWebhooks,
  }));
});

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentService } from './payment.service';

function makeService() {
  const prismaStub: any = {
    passport: {
      findUnique: jest.fn(),
    },
    buyerPassportAccess: {
      findUnique: jest.fn(),
    },
    passportPayment: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  return { svc: new PaymentService(prismaStub), prismaStub };
}

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_dummy';
  process.env.JWT_SECRET = 'jwt-test-secret-at-least-sixteen-chars';
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createPassportPaymentIntent — refusal paths', () => {
  it('throws NotFoundException when the passport does not exist', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue(null);
    await expect(svc.createPassportPaymentIntent('user-1', 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('refuses to charge a passport owner for their own passport', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'user-1' });
    await expect(svc.createPassportPaymentIntent('user-1', 'p1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('returns 409 when the user already has buyer access', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'owner-x' });
    prismaStub.buyerPassportAccess.findUnique.mockResolvedValue({ id: 'access-1' });
    await expect(svc.createPassportPaymentIntent('user-1', 'p1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('returns 409 when a successful payment already exists (caller should hit /buyer-unlock)', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'owner-x' });
    prismaStub.buyerPassportAccess.findUnique.mockResolvedValue(null);
    prismaStub.passportPayment.findFirst.mockImplementation(({ where }: any) =>
      where.status === 'succeeded' ? { id: 'pp-1' } : null,
    );
    await expect(svc.createPassportPaymentIntent('user-1', 'p1')).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('createPassportPaymentIntent — happy + reuse paths', () => {
  it('creates a Stripe intent + DB row when the user is fresh', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'owner-x' });
    prismaStub.buyerPassportAccess.findUnique.mockResolvedValue(null);
    prismaStub.passportPayment.findFirst.mockResolvedValue(null);
    prismaStub.passportPayment.create.mockResolvedValue({ id: 'pp-new' });
    stripePaymentIntents.create.mockResolvedValue({
      id: 'pi_1',
      client_secret: 'cs_secret_1',
    });
    prismaStub.passportPayment.update.mockResolvedValue({});

    const res = await svc.createPassportPaymentIntent('user-1', 'p1');
    expect(res).toEqual({ clientSecret: 'cs_secret_1', paymentId: 'pp-new' });

    // Stripe was called with the (user, passport, payment) triple in metadata.
    const stripeArg = stripePaymentIntents.create.mock.calls[0][0];
    expect(stripeArg.amount).toBe(9900);
    expect(stripeArg.metadata).toMatchObject({
      umuType: 'passport_unlock',
      userId: 'user-1',
      passportId: 'p1',
      paymentId: 'pp-new',
    });
  });

  it('reuses a still-valid pending intent instead of stacking up dead ones', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'owner-x' });
    prismaStub.buyerPassportAccess.findUnique.mockResolvedValue(null);
    prismaStub.passportPayment.findFirst.mockImplementation(({ where }: any) =>
      where.status === 'pending'
        ? { id: 'pp-pending', stripePaymentIntentId: 'pi_existing' }
        : null,
    );
    stripePaymentIntents.retrieve.mockResolvedValue({
      id: 'pi_existing',
      status: 'requires_payment_method',
      client_secret: 'cs_existing_secret',
    });

    const res = await svc.createPassportPaymentIntent('user-1', 'p1');
    expect(res).toEqual({ clientSecret: 'cs_existing_secret', paymentId: 'pp-pending' });
    // No new intent created.
    expect(stripePaymentIntents.create).not.toHaveBeenCalled();
    expect(prismaStub.passportPayment.create).not.toHaveBeenCalled();
  });

  it('supersedes a pending row whose Stripe intent has been canceled', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passport.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'owner-x' });
    prismaStub.buyerPassportAccess.findUnique.mockResolvedValue(null);
    prismaStub.passportPayment.findFirst.mockImplementation(({ where }: any) =>
      where.status === 'pending'
        ? { id: 'pp-dead', stripePaymentIntentId: 'pi_canceled' }
        : null,
    );
    stripePaymentIntents.retrieve.mockResolvedValue({
      id: 'pi_canceled',
      status: 'canceled',
      client_secret: null,
    });
    prismaStub.passportPayment.create.mockResolvedValue({ id: 'pp-fresh' });
    stripePaymentIntents.create.mockResolvedValue({
      id: 'pi_fresh',
      client_secret: 'cs_fresh',
    });

    const res = await svc.createPassportPaymentIntent('user-1', 'p1');
    expect(res.paymentId).toBe('pp-fresh');
    // The dead row was marked failed before we made the new one.
    expect(prismaStub.passportPayment.update).toHaveBeenCalledWith({
      where: { id: 'pp-dead' },
      data: { status: 'failed' },
    });
  });
});

describe('handleWebhook', () => {
  it('throws when STRIPE_WEBHOOK_SECRET is missing', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { svc } = makeService();
    await expect(svc.handleWebhook(Buffer.from('x'), 'sig')).rejects.toThrow(BadRequestException);
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_dummy';
  });

  it('throws when the signature is invalid', async () => {
    const { svc } = makeService();
    stripeWebhooks.constructEvent.mockImplementation(() => {
      throw new Error('bad sig');
    });
    await expect(svc.handleWebhook(Buffer.from('x'), 'sig')).rejects.toThrow(BadRequestException);
  });

  it('ignores marketplace events (umuType != passport_unlock)', async () => {
    const { svc, prismaStub } = makeService();
    stripeWebhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: {
        object: { id: 'pi_x', metadata: { umuType: 'marketplace_escrow' } },
      },
    });
    const res = await svc.handleWebhook(Buffer.from('x'), 'sig');
    expect(res).toEqual({ received: true });
    expect(prismaStub.passportPayment.updateMany).not.toHaveBeenCalled();
  });

  it('marks the row succeeded on payment_intent.succeeded', async () => {
    const { svc, prismaStub } = makeService();
    stripeWebhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_x',
          metadata: { umuType: 'passport_unlock', paymentId: 'pp-1' },
        },
      },
    });
    await svc.handleWebhook(Buffer.from('x'), 'sig');
    expect(prismaStub.passportPayment.updateMany).toHaveBeenCalledWith({
      where: { id: 'pp-1', status: { not: 'refunded' } },
      data: { status: 'succeeded', succeededAt: expect.any(Date) },
    });
  });

  it('marks pending → failed on payment_intent.canceled', async () => {
    const { svc, prismaStub } = makeService();
    stripeWebhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.canceled',
      data: {
        object: {
          id: 'pi_x',
          metadata: { umuType: 'passport_unlock', paymentId: 'pp-1' },
        },
      },
    });
    await svc.handleWebhook(Buffer.from('x'), 'sig');
    expect(prismaStub.passportPayment.updateMany).toHaveBeenCalledWith({
      where: { id: 'pp-1', status: 'pending' },
      data: { status: 'failed' },
    });
  });

  it('marks succeeded → refunded on charge.refunded', async () => {
    const { svc, prismaStub } = makeService();
    stripeWebhooks.constructEvent.mockReturnValue({
      type: 'charge.refunded',
      data: {
        object: {
          id: 'pi_x',
          metadata: { umuType: 'passport_unlock', paymentId: 'pp-1' },
        },
      },
    });
    await svc.handleWebhook(Buffer.from('x'), 'sig');
    expect(prismaStub.passportPayment.updateMany).toHaveBeenCalledWith({
      where: { id: 'pp-1', status: 'succeeded' },
      data: { status: 'refunded', refundedAt: expect.any(Date) },
    });
  });

  it('ignores events with no paymentId in metadata (logged, not crashed)', async () => {
    const { svc, prismaStub } = makeService();
    stripeWebhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: {
        object: { id: 'pi_x', metadata: { umuType: 'passport_unlock' } }, // no paymentId
      },
    });
    const res = await svc.handleWebhook(Buffer.from('x'), 'sig');
    expect(res).toEqual({ received: true });
    expect(prismaStub.passportPayment.updateMany).not.toHaveBeenCalled();
  });
});

describe('hasSuccessfulPayment', () => {
  it('returns true when a succeeded row exists in the DB', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passportPayment.findFirst.mockImplementation(({ where }: any) =>
      where.status === 'succeeded' ? { id: 'pp-1' } : null,
    );
    const result = await svc.hasSuccessfulPayment('user-1', 'p1');
    expect(result).toBe(true);
    expect(stripePaymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it('falls through to sync Stripe re-fetch when DB shows only pending', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passportPayment.findFirst.mockImplementation(({ where }: any) =>
      where.status === 'pending'
        ? { id: 'pp-1', stripePaymentIntentId: 'pi_x' }
        : null,
    );
    stripePaymentIntents.retrieve.mockResolvedValue({ id: 'pi_x', status: 'succeeded' });

    const result = await svc.hasSuccessfulPayment('user-1', 'p1');
    expect(result).toBe(true);
    // We promoted the row to succeeded so the next call doesn't pay
    // Stripe's API again.
    expect(prismaStub.passportPayment.update).toHaveBeenCalledWith({
      where: { id: 'pp-1' },
      data: { status: 'succeeded', succeededAt: expect.any(Date) },
    });
  });

  it('returns false when sync re-fetch finds Stripe still pending', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passportPayment.findFirst.mockImplementation(({ where }: any) =>
      where.status === 'pending'
        ? { id: 'pp-1', stripePaymentIntentId: 'pi_x' }
        : null,
    );
    stripePaymentIntents.retrieve.mockResolvedValue({ id: 'pi_x', status: 'requires_payment_method' });
    const result = await svc.hasSuccessfulPayment('user-1', 'p1');
    expect(result).toBe(false);
  });

  it('returns false when there is no payment row at all', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passportPayment.findFirst.mockResolvedValue(null);
    const result = await svc.hasSuccessfulPayment('user-1', 'p1');
    expect(result).toBe(false);
    expect(stripePaymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it('returns false (not throw) when Stripe re-fetch errors', async () => {
    const { svc, prismaStub } = makeService();
    prismaStub.passportPayment.findFirst.mockImplementation(({ where }: any) =>
      where.status === 'pending'
        ? { id: 'pp-1', stripePaymentIntentId: 'pi_x' }
        : null,
    );
    stripePaymentIntents.retrieve.mockRejectedValue(new Error('Stripe down'));
    const result = await svc.hasSuccessfulPayment('user-1', 'p1');
    expect(result).toBe(false);
  });
});
