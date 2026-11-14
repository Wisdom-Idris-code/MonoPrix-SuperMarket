import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './lib/config.js';
import { errorHandler, HttpError } from './lib/errors.js';
import authRouter from './routes/auth.js';
import catalogRouter from './routes/catalog.js';
import cartRouter from './routes/cart.js';
import ordersRouter from './routes/orders.js';
import paymentsRouter, { monimeWebhookHandler } from './routes/payments.js';
import adminRouter from './routes/admin.js';
import assetsRouter from './routes/assets.js';

const app = express();

app.disable('x-powered-by');
app.use(helmet());
const clientUrlParsed = new URL(config.CLIENT_URL);
const allowedOrigins = new Set<string>([
  clientUrlParsed.origin,
  ...(config.NODE_ENV !== 'production'
    ? [
        `http://localhost:${clientUrlParsed.port || '5173'}`,
        `http://127.0.0.1:${clientUrlParsed.port || '5173'}`,
      ]
    : []),
]);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}));
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
const stateChangeOriginGuard = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.header('origin');
  if (origin && !allowedOrigins.has(origin)) {
    return next(new HttpError(403, 'Request origin is not allowed.', 'INVALID_ORIGIN'));
  }
  if (req.header('sec-fetch-site') === 'cross-site') {
    return next(new HttpError(403, 'Cross-site state changes are not allowed.', 'CROSS_SITE_REQUEST'));
  }
  next();
};

app.post(
  ['/webhooks/monime', '/api/v1/payments/webhooks/monime'],
  apiLimiter,
  express.raw({ type: 'application/json', limit: '1mb' }),
  monimeWebhookHandler,
);

app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buffer) => {
    (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
  },
}));
app.use(cookieParser());
app.use(stateChangeOriginGuard);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Try again later.' },
});

app.get('/api/v1/health', (_req, res) => res.json({ data: { ok: true, service: 'monoprix-api' } }));
app.use('/api/v1/assets', assetsRouter);
app.use('/api/v1/auth', authLimiter, authRouter);
app.use('/api/v1', apiLimiter, catalogRouter);
app.use('/api/v1/cart', cartRouter);
app.use('/api/v1/orders', ordersRouter);
app.use('/api/v1/payments', paymentsRouter);
app.use('/api/v1/admin', adminRouter);

app.use((_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.use(errorHandler);

export default app;
