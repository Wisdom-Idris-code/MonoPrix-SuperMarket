import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: Array<{ path: string; message: string }> | unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({
      error: error.code === 'LIMIT_FILE_SIZE' ? 'Image exceeds the 10 MB upload limit.' : 'Invalid image upload request.',
      code: error.code,
    });
  }

  if (error instanceof ZodError) {
    return res.status(400).json({
      error: 'Request validation failed.',
      code: 'VALIDATION_ERROR',
      details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }

  if (error instanceof HttpError) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code,
      ...(error.details !== undefined ? { details: error.details } : {}),
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const target = Array.isArray(error.meta?.target)
        ? (error.meta?.target as string[]).join(', ')
        : (typeof error.meta?.target === 'string' ? error.meta?.target : 'field');
      const isSku = target.toLowerCase().includes('sku');
      const message = isSku
        ? 'This SKU is already assigned to another product.'
        : `A record with this ${target} already exists.`;
      const path = isSku ? 'sku' : target;
      return res.status(409).json({
        error: message,
        code: 'CONFLICT',
        details: [{ path, message }],
      });
    }

    if (error.code === 'P2003') {
      return res.status(400).json({
        error: 'A referenced database record was not found.',
        code: 'FOREIGN_KEY_CONSTRAINT_FAILED',
      });
    }

    if (error.code === 'P2025') {
      return res.status(404).json({
        error: 'Record not found.',
        code: 'NOT_FOUND',
      });
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    console.error('Prisma validation error:', error.message);
    return res.status(400).json({
      error: 'Database record format failed validation.',
      code: 'DATABASE_VALIDATION_ERROR',
    });
  }

  const referenceId = `ERR-${randomUUID().slice(0, 8).toUpperCase()}`;
  console.error(`Unhandled API error [${referenceId}]:`, error);
  return res.status(500).json({
    error: `An unexpected error occurred. (Reference: ${referenceId})`,
    code: 'INTERNAL_SERVER_ERROR',
    referenceId,
  });
}

