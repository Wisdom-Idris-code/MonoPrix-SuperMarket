import { z } from 'zod';

const configSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long.'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  AUTH_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  ALLOW_DEMO_SEED: z.enum(['true', 'false']).default('false'),
  DEMO_SEED_PASSWORD: z.string().min(12).optional(),
  TEST_DATABASE_URL: z.string().optional(),
  TEST_DIRECT_URL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  OPEN_FOOD_FACTS_USER_AGENT: z.string().min(8).default('MonoprixOnlineDemo/1.0 (contact: demo@example.invalid)'),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),
  MONIME_ACCESS_TOKEN: z.string().optional(),
  MONIME_ACCESS_KEY: z.string().optional(),
  MONIME_SPACE_ID: z.string().optional(),
  MONIME_WEBHOOK_SECRET: z.string().optional(),
  API_PUBLIC_URL: z.string().url().optional(),
  ENABLE_MOCK_PAYMENTS: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
});

export const config = configSchema.parse(process.env);
