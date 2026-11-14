import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from '../lib/config.js';
import { HttpError } from '../lib/errors.js';

const API_BASE_URL = 'https://api.monime.io/v1';
const API_VERSION = 'caph.2025-08-23';

const checkoutSessionSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['pending', 'completed', 'cancelled', 'expired']),
  redirectUrl: z.string().url().optional(),
  reference: z.string().nullable().optional(),
  lineItems: z.object({
    data: z.array(z.object({
      quantity: z.number().int().positive(),
      price: z.object({ currency: z.string(), value: z.number().int().nonnegative() }),
    })),
  }).optional(),
});

function getCredentials() {
  const accessToken = config.MONIME_ACCESS_TOKEN ?? config.MONIME_ACCESS_KEY;
  if (!accessToken || !config.MONIME_SPACE_ID) {
    throw new HttpError(503, 'Monime credentials are not configured.', 'MONIME_NOT_CONFIGURED');
  }
  const isTestToken = accessToken.startsWith('mon_test_');
  const isLiveToken = accessToken.startsWith('mon_') && !isTestToken;
  if (!isTestToken && !isLiveToken) {
    throw new HttpError(503, 'Monime access token must use the mon_test_ or mon_ prefix.', 'MONIME_INVALID_TOKEN');
  }
  if (config.NODE_ENV === 'production' && !isLiveToken) {
    throw new HttpError(503, 'Production checkout requires a live Monime token and merchant approval.', 'MONIME_LIVE_TOKEN_REQUIRED');
  }
  if (config.NODE_ENV === 'production' && !config.API_PUBLIC_URL) {
    throw new HttpError(503, 'Set API_PUBLIC_URL to the public API origin before enabling hosted checkout.', 'MONIME_RETURN_URL_NOT_CONFIGURED');
  }
  return {
    accessToken,
    spaceId: config.MONIME_SPACE_ID,
    apiPublicUrl: (config.API_PUBLIC_URL ?? `http://localhost:${config.PORT}`).replace(/\/+$/, ''),
  };
}

async function monimeRequest(path: string, init: RequestInit) {
  const { accessToken, spaceId } = getCredentials();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Monime-Space-Id': spaceId,
      'Monime-Version': API_VERSION,
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new HttpError(502, `Monime request failed with status ${response.status}.`, 'MONIME_REQUEST_FAILED');
  }
  const responseBody: unknown = await response.json();
  const envelope = z.object({ success: z.literal(true), result: z.unknown() }).safeParse(responseBody);
  if (!envelope.success) {
    throw new HttpError(502, 'Monime returned an invalid response.', 'MONIME_INVALID_RESPONSE');
  }
  return envelope.data.result;
}

export function sleToMinorUnits(amount: string | number) {
  const value = typeof amount === 'number' ? String(amount) : amount;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new HttpError(400, 'SLE amount must have no more than two decimal places.', 'INVALID_PAYMENT_AMOUNT');
  const minorUnits = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (minorUnits <= 0n || minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new HttpError(400, 'SLE amount is outside the supported range.', 'INVALID_PAYMENT_AMOUNT');
  }
  return Number(minorUnits);
}

export async function createMonimeCheckout(input: {
  orderId: string;
  transactionRef: string;
  amount: string;
  idempotencyKey: string;
}) {
  const { apiPublicUrl } = getCredentials();
  const amount = sleToMinorUnits(input.amount);
  const result = await monimeRequest('/checkout-sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
    },
    body: JSON.stringify({
      name: `Monoprix order ${input.orderId}`,
      description: `Payment for Monoprix order ${input.orderId}`,
      reference: input.transactionRef,
      successUrl: `${apiPublicUrl}/api/v1/payments/monime/success?orderId=${encodeURIComponent(input.orderId)}`,
      cancelUrl: `${config.CLIENT_URL}/orders?payment=cancelled&orderId=${encodeURIComponent(input.orderId)}`,
      lineItems: [{
        type: 'custom',
        name: `Monoprix order ${input.orderId}`,
        quantity: 1,
        price: { currency: 'SLE', value: amount },
      }],
      metadata: { orderId: input.orderId },
    }),
  });
  const session = checkoutSessionSchema.extend({ redirectUrl: z.string().url() }).parse(result);
  return { id: session.id, redirectUrl: session.redirectUrl, status: session.status };
}

export async function getMonimeCheckout(sessionId: string) {
  const result = await monimeRequest(`/checkout-sessions/${encodeURIComponent(sessionId)}`, { method: 'GET' });
  return checkoutSessionSchema.parse(result);
}

export function verifyMonimeWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string,
  nowMilliseconds = Date.now(),
) {
  if (secret.length < 32 || secret.length > 100) return false;
  const parts = new Map(signatureHeader.split(',').map((part) => {
    const [key, ...value] = part.trim().split('=');
    return [key, value.join('=')];
  }));
  const timestamp = parts.get('t');
  const signature = parts.get('v1');
  if (!timestamp || !signature || !/^\d+$/.test(timestamp) || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) return false;
  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(nowMilliseconds / 1000);
  if (nowSeconds - timestampSeconds > 300 || timestampSeconds - nowSeconds > 60) return false;

  const expected = createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}_`), rawBody]))
    .digest();
  const received = Buffer.from(signature, 'base64');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
