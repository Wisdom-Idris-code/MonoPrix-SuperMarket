import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { clearAuthCookie, getCurrentUser, requireAuth, setAuthCookie, signToken } from '../lib/auth.js';
import { parseBody } from '../lib/validation.js';
import { emailProvider } from '../services/notifications.js';

const router = Router();
const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
  phone: z.string().trim().max(30).optional(),
});
const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
});

router.post('/register', asyncHandler(async (req, res) => {
  const input = parseBody(registerSchema, req);
  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        phone: input.phone,
        role: 'CUSTOMER',
        cart: { create: {} },
      },
      select: { id: true, name: true, email: true, role: true, phone: true },
    });
    const token = signToken({ userId: user.id, email: user.email, role: 'CUSTOMER' });
    setAuthCookie(res, token);
    try {
      await emailProvider.send({
        to: user.email,
        subject: 'Welcome to Monoprix Online',
        text: `Welcome ${user.name}. This is a demonstration account for the Monoprix Online concept.`,
      });
    } catch (error) {
      console.error(`Welcome email failed for user ${user.id}:`, error);
    }
    res.status(201).json({ data: { user } });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'P2002') {
      throw new HttpError(409, 'An account with this email already exists.', 'EMAIL_ALREADY_REGISTERED');
    }
    throw error;
  }
}));

router.post('/login', asyncHandler(async (req, res) => {
  const input = parseBody(loginSchema, req);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !user.isActive || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new HttpError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS');
  }
  if (!['CUSTOMER', 'ADMIN', 'STAFF'].includes(user.role)) {
    throw new HttpError(403, 'This account has an invalid role.', 'INVALID_ACCOUNT_ROLE');
  }

  const role = user.role as 'CUSTOMER' | 'ADMIN' | 'STAFF';
  setAuthCookie(res, signToken({ userId: user.id, email: user.email, role }));
  res.json({ data: { user: { id: user.id, name: user.name, email: user.email, role, phone: user.phone } } });
}));

router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ data: { loggedOut: true } });
});

router.get('/me', asyncHandler(async (req, res) => {
  res.json({ data: { user: await getCurrentUser(req) } });
}));

router.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const input = parseBody(z.object({
    name: z.string().trim().min(2).max(100).optional(),
    phone: z.string().trim().max(30).nullable().optional(),
  }).refine((value) => value.name !== undefined || value.phone !== undefined), req);
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: input,
    select: { id: true, name: true, email: true, role: true, phone: true },
  });
  res.json({ data: { user } });
}));

export default router;
