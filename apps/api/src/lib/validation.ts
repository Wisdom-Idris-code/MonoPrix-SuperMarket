import type { Request } from 'express';
import { z } from 'zod';
import { HttpError } from './errors.js';

export function parseBody<T extends z.ZodType>(schema: T, req: Request): z.infer<T> {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw parsed.error;
  }
  return parsed.data;
}

export function parseQuery<T extends z.ZodType>(schema: T, req: Request): z.infer<T> {
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    throw parsed.error;
  }
  return parsed.data;
}

export const idSchema = z.string().min(1).max(64);
