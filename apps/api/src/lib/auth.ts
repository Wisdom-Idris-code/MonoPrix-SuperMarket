import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from './config.js';
import { prisma } from './db.js';
import { HttpError } from './errors.js';

export const roles = ['CUSTOMER', 'ADMIN', 'STAFF'] as const;
export type UserRole = (typeof roles)[number];
export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  phone: string | null;
};

export const permissions = [
  'dashboard:read',
  'catalog:read',
  'catalog:write',
  'catalog:archive',
  'categories:read',
  'categories:manage',
  'orders:read',
  'orders:update',
  'orders:cancel',
  'refunds:authorize',
  'inventory:read',
  'inventory:manage',
  'media:manage',
  'users:manage',
  'audit:read',
  'settings:manage',
] as const;
export type Permission = (typeof permissions)[number];

const rolePermissions: Record<UserRole, ReadonlySet<Permission>> = {
  CUSTOMER: new Set(),
  STAFF: new Set([
    'dashboard:read',
    'catalog:read',
    'catalog:write',
    'categories:read',
    'orders:read',
    'orders:update',
    'inventory:read',
    'inventory:manage',
    'media:manage',
  ]),
  ADMIN: new Set(permissions),
};

const tokenSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  role: z.enum(roles),
});

export function signToken(payload: { userId: string; email: string; role: UserRole }) {
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: `${config.AUTH_SESSION_TTL_HOURS}h`,
    issuer: 'monoprix-online',
  });
}

function verifyToken(token: string) {
  const decoded = jwt.verify(token, config.JWT_SECRET, { issuer: 'monoprix-online' });
  return tokenSchema.parse(decoded);
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie('monoprix_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    maxAge: config.AUTH_SESSION_TTL_HOURS * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie('monoprix_token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    path: '/',
  });
}

export async function getCurrentUser(req: Request): Promise<AuthUser | null> {
  const token = req.cookies?.monoprix_token;
  if (!token) return null;

  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, name: true, email: true, role: true, phone: true, isActive: true },
    });
    if (!user || !user.isActive || !roles.includes(user.role as UserRole)) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role as UserRole,
      phone: user.phone,
    };
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof z.ZodError) return null;
    throw error;
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await getCurrentUser(req);
    if (!user) throw new HttpError(401, 'Authentication required.', 'UNAUTHENTICATED');
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRoles(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return next(new HttpError(403, 'You do not have permission to access this resource.', 'FORBIDDEN'));
    }
    next();
  };
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !hasPermission(req.user.role, permission)) {
      return next(new HttpError(403, 'You do not have permission to access this resource.', 'FORBIDDEN'));
    }
    next();
  };
}

export function hasPermission(role: UserRole, permission: Permission) {
  return rolePermissions[role].has(permission);
}
