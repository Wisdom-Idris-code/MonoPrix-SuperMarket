import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { AddressInfo } from 'node:net';

process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/monoprix_test?schema=marketplace_test';
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.JWT_SECRET = 'monoprix-test-secret-that-is-long-enough';
process.env.NODE_ENV = 'test';

const [{ default: app }, { prisma }] = await Promise.all([
  import('../src/app.js'),
  import('../src/lib/db.js'),
]);

let server: ReturnType<typeof app.listen>;
let baseUrl: string;

before(async () => {
  Object.defineProperty(prisma.user, 'findUnique', {
    configurable: true,
    value: async () => null,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api/v1/auth/login`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await prisma.$disconnect();
});

test('authentication rate limit rejects attempts after the configured threshold', async () => {
  const attempt = () => fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'unknown@example.test', password: 'valid-length-password' }),
  });

  for (let count = 0; count < 15; count += 1) {
    assert.equal((await attempt()).status, 401);
  }
  const limited = await attempt();
  assert.equal(limited.status, 429);
  assert.match(limited.headers.get('ratelimit') ?? '', /limit=15/i);
});
