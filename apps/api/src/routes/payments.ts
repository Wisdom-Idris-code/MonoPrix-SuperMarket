import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../lib/config.js';
import { requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/db.js';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { parseBody } from '../lib/validation.js';
import { createMonimeCheckout, getMonimeCheckout, sleToMinorUnits, verifyMonimeWebhookSignature } from '../services/monime.js';

const router = Router();
const monimeEventSchema = z.object({
  apiVersion: z.string(),
  event: z.object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(100),
    timestamp: z.string(),
  }),
  object: z.object({ id: z.string().min(1), type: z.literal('checkout_session') }),
  data: z.object({ id: z.string().min(1), status: z.string().optional() }),
});
const mockPaymentSchema = z.object({
  eventId: z.string().min(1).max(100),
  reference: z.string().min(1).max(200),
  status: z.enum(['PAID', 'FAILED']),
  amount: z.number().nonnegative(),
});

const redirectMonimeSuccess = asyncHandler(async (req, res) => {
  const orderId = typeof req.query.orderId === 'string' ? req.query.orderId : '';
  if (!orderId) throw new HttpError(400, 'Order reference is required.', 'ORDER_REFERENCE_REQUIRED');
  res.redirect(303, `${config.CLIENT_URL}/orders?payment=returned&orderId=${encodeURIComponent(orderId)}`);
});

router.post('/monime/success', redirectMonimeSuccess);
router.get('/monime/success', redirectMonimeSuccess);

export const monimeWebhookHandler = asyncHandler(async (req, res) => {
  if (!config.MONIME_WEBHOOK_SECRET) {
    throw new HttpError(503, 'Monime webhook secret is not configured.', 'WEBHOOK_NOT_CONFIGURED');
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body : undefined;
  const signature = req.header('monime-signature') ?? '';
  if (!rawBody || !verifyMonimeWebhookSignature(rawBody, signature, config.MONIME_WEBHOOK_SECRET)) {
    throw new HttpError(401, 'Invalid Monime webhook signature.', 'INVALID_WEBHOOK_SIGNATURE');
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON request body.', 'INVALID_JSON');
  }
  const event = monimeEventSchema.parse(body);
  if (event.data.id !== event.object.id) {
    throw new HttpError(400, 'Monime event resource identifiers do not match.', 'INVALID_WEBHOOK_EVENT');
  }
  if (!['checkout_session.completed', 'checkout_session.cancelled', 'checkout_session.expired'].includes(event.event.name)) {
    return res.json({ data: { accepted: true, ignored: true } });
  }

  const payment = await prisma.payment.findFirst({
    where: { provider: 'monime', providerSessionId: event.object.id },
    include: { order: true },
  });
  if (!payment) throw new HttpError(404, 'Monime checkout session was not found.', 'PAYMENT_NOT_FOUND');
  const session = await getMonimeCheckout(event.object.id);
  if (session.id !== payment.providerSessionId) {
    throw new HttpError(409, 'Monime checkout session does not match the recorded payment.', 'PAYMENT_SESSION_MISMATCH');
  }

  let finalStatus: 'PAID' | 'FAILED' | null = null;
  if (session.status === 'completed') {
    const expectedAmount = sleToMinorUnits(payment.amount.toString());
    const lineItems = session.lineItems?.data;
    const sessionAmount = lineItems?.reduce((total, item) => {
      if (item.price.currency !== 'SLE') {
        throw new HttpError(409, 'Monime checkout currency does not match SLE.', 'PAYMENT_CURRENCY_MISMATCH');
      }
      return total + item.quantity * item.price.value;
    }, 0);
    if (session.reference !== payment.transactionRef) {
      throw new HttpError(409, 'Monime checkout reference does not match the order.', 'PAYMENT_REFERENCE_MISMATCH');
    }
    if (sessionAmount === undefined || !lineItems?.length || sessionAmount !== expectedAmount) {
      throw new HttpError(409, 'Monime checkout amount does not match the order.', 'PAYMENT_AMOUNT_MISMATCH');
    }
    if (payment.currency !== 'SLE' || payment.amount.toString() !== payment.order.total.toString()) {
      throw new HttpError(409, 'Recorded payment currency or amount does not match the order.', 'PAYMENT_AMOUNT_MISMATCH');
    }
    finalStatus = 'PAID';
  } else if (session.status === 'cancelled' || session.status === 'expired') {
    finalStatus = 'FAILED';
  }

  let duplicate = false;
  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.paymentEvent.create({
        data: {
          paymentId: payment.id,
          provider: 'monime',
          eventId: event.event.id,
          eventType: event.event.name.toUpperCase().replaceAll('.', '_'),
          payload: JSON.stringify(event),
        },
      });

      if (finalStatus === 'PAID') {
        if (payment.order.status === 'CANCELLED') {
          throw new HttpError(409, 'A cancelled order cannot be marked paid.', 'ORDER_CANCELLED');
        }
        const updated = await transaction.payment.updateMany({
          where: { id: payment.id, providerSessionId: session.id, status: { in: ['PENDING', 'FAILED'] } },
          data: { status: 'PAID' },
        });
        if (updated.count) {
          await transaction.order.update({
            where: { id: payment.orderId },
            data: {
              paymentStatus: 'PAID',
              ...(payment.order.status === 'PENDING' ? { status: 'CONFIRMED' } : {}),
            },
          });
          await transaction.notification.create({
            data: {
              userId: payment.order.userId,
              orderId: payment.orderId,
              type: 'PAYMENT_STATUS',
              message: `Payment for order ${payment.orderId} was verified.`,
            },
          });
        }
      } else if (finalStatus === 'FAILED') {
        const updated = await transaction.payment.updateMany({
          where: { id: payment.id, providerSessionId: session.id, status: 'PENDING' },
          data: { status: 'FAILED' },
        });
        if (updated.count) {
          await transaction.order.updateMany({
            where: { id: payment.orderId, status: 'PENDING', paymentStatus: 'PENDING' },
            data: { paymentStatus: 'FAILED' },
          });
          await transaction.notification.create({
            data: {
              userId: payment.order.userId,
              orderId: payment.orderId,
              type: 'PAYMENT_STATUS',
              message: `Payment for order ${payment.orderId} was cancelled or expired.`,
            },
          });
        }
      }
    });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'P2002') duplicate = true;
    else throw error;
  }
  res.json({ data: { accepted: true, duplicate } });
});

router.post('/webhooks/mock', asyncHandler(async (req, res) => {
  if (!config.ENABLE_MOCK_PAYMENTS || config.NODE_ENV === 'production') {
    throw new HttpError(404, 'Mock payments are disabled.', 'PROVIDER_NOT_CONFIGURED');
  }
  if (!config.PAYMENT_WEBHOOK_SECRET) {
    throw new HttpError(503, 'Mock webhook secret is not configured.', 'WEBHOOK_NOT_CONFIGURED');
  }
  const signature = req.header('x-mock-signature') ?? '';
  const expected = createHmac('sha256', config.PAYMENT_WEBHOOK_SECRET)
    .update(req.rawBody ?? Buffer.from(''))
    .digest('hex');
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    throw new HttpError(401, 'Invalid webhook signature.', 'INVALID_WEBHOOK_SIGNATURE');
  }
  const event = mockPaymentSchema.parse(req.body);
  const payment = await prisma.payment.findUnique({ where: { transactionRef: event.reference } });
  if (!payment || payment.provider !== 'mock') throw new HttpError(404, 'Mock payment reference was not found.', 'PAYMENT_NOT_FOUND');
  if (Number(payment.amount.toString()) !== event.amount) {
    throw new HttpError(409, 'Webhook amount does not match the recorded payment amount.', 'PAYMENT_AMOUNT_MISMATCH');
  }
  const applied = await prisma.$transaction(async (transaction) => {
    try {
      await transaction.paymentEvent.create({
        data: {
          paymentId: payment.id,
          provider: 'mock',
          eventId: event.eventId,
          eventType: `MOCK_${event.status}`,
          payload: JSON.stringify({ reference: event.reference, status: event.status, amount: event.amount }),
        },
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P2002') return false;
      throw error;
    }
    await transaction.payment.update({
      where: { id: payment.id },
      data: { status: event.status },
    });
    await transaction.order.update({
      where: { id: payment.orderId },
      data: { paymentStatus: event.status },
    });
    return true;
  });
  res.json({ data: { accepted: true, duplicate: !applied } });
}));

router.post('/initiate', requireAuth, asyncHandler(async (req, res) => {
  const { orderId } = parseBody(z.object({ orderId: z.string().min(1) }), req);
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: req.user!.id },
    include: { payment: true },
  });
  if (!order?.payment) throw new HttpError(404, 'Order payment was not found.', 'PAYMENT_NOT_FOUND');
  if (order.payment.provider === 'cash-on-delivery') {
    throw new HttpError(400, 'Cash-on-delivery orders do not need an online payment.', 'PAYMENT_NOT_REQUIRED');
  }
  if (order.payment.provider === 'mock') {
    if (!config.ENABLE_MOCK_PAYMENTS || config.NODE_ENV === 'production') {
      throw new HttpError(503, 'Mock payments are disabled.', 'MOCK_PAYMENTS_DISABLED');
    }
    if (order.payment.status !== 'PENDING') {
      throw new HttpError(409, 'This payment is no longer pending.', 'PAYMENT_NOT_PENDING');
    }
    return res.json({
      data: {
        payment: {
          id: order.payment.id,
          reference: order.payment.transactionRef,
          amount: order.payment.amount.toString(),
          currency: order.payment.currency,
          status: order.payment.status,
          provider: 'mock',
          message: 'Test-only payment simulation. No money is charged.',
        },
      },
    });
  }
  if (order.payment.provider !== 'monime') {
    throw new HttpError(400, 'No online payment integration is available for this order.', 'PAYMENT_NOT_REQUIRED');
  }
  if (order.status !== 'PENDING' || order.payment.status === 'PAID') {
    throw new HttpError(409, 'This payment is no longer pending.', 'PAYMENT_NOT_PENDING');
  }
  let payment = order.payment;
  if (payment.status === 'FAILED') {
    payment = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.payment.updateMany({
        where: { id: payment.id, status: 'FAILED' },
        data: {
          status: 'PENDING',
          transactionRef: `MONIME-${randomUUID()}`,
          providerSessionId: null,
          payload: null,
        },
      });
      if (!updated.count) throw new HttpError(409, 'Payment retry is already being processed.', 'PAYMENT_RETRY_CONFLICT');
      await transaction.order.update({ where: { id: order.id }, data: { paymentStatus: 'PENDING' } });
      await transaction.paymentEvent.create({
        data: {
          paymentId: payment.id,
          provider: 'monime',
          eventId: `retry-${randomUUID()}`,
          eventType: 'MONIME_CHECKOUT_RETRY_STARTED',
          payload: JSON.stringify({ orderId: order.id }),
        },
      });
      return transaction.payment.findUniqueOrThrow({ where: { id: payment.id } });
    });
  }

  if (payment.providerSessionId) {
    const saved = z.object({ redirectUrl: z.string().url() }).safeParse(
      payment.payload ? JSON.parse(payment.payload) : null,
    );
    if (saved.success) {
      return res.json({ data: { payment: { id: payment.id, status: payment.status, provider: 'monime', redirectUrl: saved.data.redirectUrl } } });
    }
    const existing = await getMonimeCheckout(payment.providerSessionId);
    if (!existing.redirectUrl) throw new HttpError(502, 'Monime checkout URL is unavailable.', 'MONIME_INVALID_RESPONSE');
    return res.json({ data: { payment: { id: payment.id, status: payment.status, provider: 'monime', redirectUrl: existing.redirectUrl } } });
  }

  const idempotencyKey = `monoprix-${payment.id}-${payment.transactionRef}`;
  let checkout: Awaited<ReturnType<typeof createMonimeCheckout>>;
  try {
    checkout = await createMonimeCheckout({
      orderId: order.id,
      transactionRef: payment.transactionRef,
      amount: payment.amount.toString(),
      idempotencyKey,
    });
  } catch (error) {
    await prisma.paymentEvent.create({
      data: {
        paymentId: payment.id,
        provider: 'monime',
        eventId: `initiation-failed-${randomUUID()}`,
        eventType: 'MONIME_CHECKOUT_INITIATION_FAILED',
        payload: JSON.stringify({ orderId: order.id, message: error instanceof Error ? error.message : 'Unknown initiation error' }),
      },
    });
    throw error;
  }
  await prisma.$transaction(async (transaction) => {
    await transaction.payment.update({
      where: { id: payment.id },
      data: { providerSessionId: checkout.id, payload: JSON.stringify({ redirectUrl: checkout.redirectUrl }) },
    });
    await transaction.paymentEvent.create({
      data: {
        paymentId: payment.id,
        provider: 'monime',
        eventId: `checkout-session-created-${randomUUID()}`,
        eventType: 'MONIME_CHECKOUT_SESSION_CREATED',
        payload: JSON.stringify({ sessionId: checkout.id, orderId: order.id }),
      },
    });
  });
  res.json({ data: { payment: { id: payment.id, status: payment.status, provider: 'monime', redirectUrl: checkout.redirectUrl } } });
}));

router.post('/:id/mock-complete', requireAuth, asyncHandler(async (req, res) => {
  if (!config.ENABLE_MOCK_PAYMENTS || config.NODE_ENV === 'production') {
    throw new HttpError(404, 'Mock payments are disabled.', 'PROVIDER_NOT_CONFIGURED');
  }
  const paymentId = Array.isArray(req.params.id) ? req.params.id[0] ?? '' : req.params.id ?? '';
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, provider: 'mock', order: { userId: req.user!.id } },
    include: { order: true },
  });
  if (!payment) throw new HttpError(404, 'Mock payment not found.', 'PAYMENT_NOT_FOUND');
  if (payment.status !== 'PENDING') {
    return res.json({ data: { payment: { id: payment.id, status: payment.status, alreadyProcessed: true } } });
  }

  const result = await prisma.$transaction(async (transaction) => {
    const updated = await transaction.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: { status: 'PAID' },
    });
    if (updated.count) {
      await transaction.order.updateMany({
        where: { id: payment.orderId, status: 'PENDING', paymentStatus: 'PENDING' },
        data: { paymentStatus: 'PAID' },
      });
      await transaction.paymentEvent.create({
        data: {
          paymentId: payment.id,
          provider: 'mock',
          eventId: `demo-complete-${payment.id}`,
          eventType: 'MOCK_PAYMENT_COMPLETED',
          payload: JSON.stringify({ demo: true }),
        },
      });
      await transaction.notification.create({
        data: {
          userId: req.user!.id,
          orderId: payment.orderId,
          type: 'PAYMENT_STATUS',
          message: `Demo payment for order ${payment.orderId} was simulated as paid. No real money was charged.`,
        },
      });
    }
    return transaction.payment.findUniqueOrThrow({ where: { id: payment.id } });
  });
  res.json({ data: { payment: { id: result.id, status: result.status, demo: true } } });
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const paymentId = Array.isArray(req.params.id) ? req.params.id[0] ?? '' : req.params.id ?? '';
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, order: { userId: req.user!.id } },
    select: { id: true, provider: true, transactionRef: true, amount: true, currency: true, status: true, createdAt: true },
  });
  if (!payment) throw new HttpError(404, 'Payment not found.', 'PAYMENT_NOT_FOUND');
  res.json({ data: { payment: { ...payment, amount: payment.amount.toString() } } });
}));

export default router;
