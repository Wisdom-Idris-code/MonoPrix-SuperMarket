import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/db.js';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { parseBody } from '../lib/validation.js';
import { createOrder } from '../services/order-service.js';

const router = Router();
router.use(requireAuth);

const checkoutSchema = z.object({
  customerName: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(6).max(30),
  email: z.string().trim().email().max(254).optional(),
  addressLine: z.string().trim().min(5).max(300),
  area: z.string().trim().min(2).max(100),
  instructions: z.string().trim().max(500).optional(),
  paymentMethod: z.enum(['CASH_ON_DELIVERY', 'ORANGE_MONEY', 'VISA', 'MASTERCARD', 'MONIME']),
});

router.post('/', asyncHandler(async (req, res) => {
  const input = parseBody(checkoutSchema, req);
  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey || !z.string().uuid().safeParse(idempotencyKey).success) {
    throw new HttpError(400, 'A valid Idempotency-Key UUID header is required.', 'IDEMPOTENCY_KEY_REQUIRED');
  }
  const order = await createOrder(req.user!.id, { ...input, idempotencyKey });
  res.status(201).json({ data: { order } });
}));

router.get('/', asyncHandler(async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { userId: req.user!.id },
    include: { items: true, delivery: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ data: { orders } });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const orderId = Array.isArray(req.params.id) ? req.params.id[0] ?? '' : req.params.id ?? '';
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: req.user!.id },
    include: { items: true, delivery: true },
  });
  if (!order) throw new HttpError(404, 'Order not found.', 'ORDER_NOT_FOUND');
  res.json({ data: { order } });
}));

export default router;
