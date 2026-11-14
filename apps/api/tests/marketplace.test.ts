import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import bcrypt from 'bcryptjs';
import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';

process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/monoprix_test?sslmode=require';
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.JWT_SECRET = 'monoprix-test-secret-that-is-long-enough';
process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = 'http://localhost:5173';
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-api-key';
process.env.CLOUDINARY_API_SECRET = 'test-api-secret';
process.env.ENABLE_MOCK_PAYMENTS = 'true';
process.env.MONIME_ACCESS_TOKEN = 'mon_test_isolated_unit_test_token';
process.env.MONIME_SPACE_ID = 'spc-isolated-test-space';
process.env.MONIME_WEBHOOK_SECRET = 'monime-webhook-secret-isolated-test-value-123456';

const [{ default: app }, { prisma }, { signToken, hasPermission, permissions }, { createOrder, updateOrderStatus }] = await Promise.all([
  import('../src/app.js'),
  import('../src/lib/db.js'),
  import('../src/lib/auth.js'),
  import('../src/services/order-service.js'),
]);
const { DEFAULT_DELIVERY_FEE, formatSLE } = await import('../src/lib/currency.js');
const { validateImageSignature } = await import('../src/lib/image-upload.js');
const { sleToMinorUnits, verifyMonimeWebhookSignature } = await import('../src/services/monime.js');
const { assertSafeDemoSeedTarget } = await import('../src/lib/demo-seed-safety.js');
const { assertIsolatedTestDatabase } = await import('../src/lib/test-database-safety.js');

const testUser = {
  id: 'user-test-1',
  name: 'Test Customer',
  email: 'customer@example.test',
  role: 'CUSTOMER',
  phone: null,
};

const restorers: Array<() => void> = [];
const httpFetch = globalThis.fetch.bind(globalThis);
let server: Server;
let originUrl: string;
let baseUrl: string;

function stub(target: object, method: string, implementation: (...args: unknown[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, writable: true, value: implementation });
  restorers.push(() => {
    if (original) Object.defineProperty(target, method, original);
    else Reflect.deleteProperty(target, method);
  });
}

function cookieFor(role: 'CUSTOMER' | 'ADMIN' | 'STAFF' = 'CUSTOMER') {
  return `monoprix_token=${signToken({
    userId: testUser.id,
    email: testUser.email,
    role,
  })}`;
}

function monimeSignature(rawBody: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac('sha256', process.env.MONIME_WEBHOOK_SECRET!)
    .update(`${timestamp}_${rawBody}`)
    .digest('base64');
  return `t=${timestamp},v1=${signature}`;
}

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  originUrl = `http://127.0.0.1:${address.port}`;
  baseUrl = `${originUrl}/api/v1`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

afterEach(() => {
  while (restorers.length) restorers.pop()!();
});

test('registration hashes passwords, assigns customer role, and exposes the session user', async () => {
  const passwordHash = await bcrypt.hash('correct-horse-battery', 4);
  let createdData: Record<string, unknown> | undefined;
  stub(prisma.user, 'create', async (argument) => {
    createdData = (argument as { data: Record<string, unknown> }).data;
    return testUser;
  });
  stub(prisma.user, 'findUnique', async () => ({ ...testUser, isActive: true }));

  const response = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: testUser.name,
      email: testUser.email,
      password: 'correct-horse-battery',
      role: 'ADMIN',
    }),
  });

  assert.equal(response.status, 201);
  assert.match(response.headers.get('set-cookie') ?? '', /monoprix_token=.*HttpOnly/i);
  assert.equal(createdData?.role, 'CUSTOMER');
  assert.equal(createdData?.email, testUser.email);
  assert.equal(await bcrypt.compare('correct-horse-battery', String(createdData?.passwordHash)), true);
  assert.notEqual(createdData?.passwordHash, 'correct-horse-battery');
  assert.equal(bcrypt.getRounds(String(createdData?.passwordHash)), 12);
  assert.match(response.headers.get('set-cookie') ?? '', /SameSite=Lax/i);
  assert.match(response.headers.get('set-cookie') ?? '', /Max-Age=86400/i);

  const me = await fetch(`${baseUrl}/auth/me`, {
    headers: { Cookie: response.headers.get('set-cookie')!.split(';')[0] },
  });
  assert.equal(me.status, 200);
  assert.deepEqual((await me.json() as { data: { user: unknown } }).data.user, testUser);
});

test('login accepts a correct password and rejects invalid credentials', async () => {
  const passwordHash = await bcrypt.hash('correct-horse-battery', 4);
  stub(prisma.user, 'findUnique', async () => ({ ...testUser, passwordHash, isActive: true }));

  const invalid = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testUser.email, password: 'wrong-password' }),
  });
  assert.equal(invalid.status, 401);

  const valid = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testUser.email, password: 'correct-horse-battery' }),
  });
  assert.equal(valid.status, 200);
  assert.match(valid.headers.get('set-cookie') ?? '', /monoprix_token=.*HttpOnly/i);
  assert.equal((await valid.json() as { data: { user: { role: string } } }).data.user.role, 'CUSTOMER');
});

test('admin endpoints reject anonymous and customer sessions', async () => {
  stub(prisma.user, 'findUnique', async () => ({ ...testUser, isActive: true }));

  const anonymous = await fetch(`${baseUrl}/admin/dashboard`);
  assert.equal(anonymous.status, 401);

  const customer = await fetch(`${baseUrl}/admin/dashboard`, {
    headers: { Cookie: cookieFor('CUSTOMER') },
  });

  test('inactive accounts cannot use existing session cookies', async () => {
    stub(prisma.user, 'findUnique', async () => ({ ...testUser, isActive: false }));
    const response = await fetch(`${baseUrl}/cart`, {
      headers: { Cookie: cookieFor() },
    });
    assert.equal(response.status, 401);
  });

  test('unsafe cross-origin state-changing requests are rejected', async () => {
    const response = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { Origin: 'https://attacker.example' },
    });
    assert.equal(response.status, 403);
  });

  test('demo seed refuses production, remote databases, and missing explicit confirmations', () => {
    const base = {
      NODE_ENV: 'development',
      ALLOW_DEMO_SEED: 'true',
      DEMO_SEED_PASSWORD: 'local-only-password-123',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/monoprix_test',
    };
    assert.doesNotThrow(() => assertSafeDemoSeedTarget(base, ['--confirm-demo-seed']));
    assert.throws(() => assertSafeDemoSeedTarget({ ...base, NODE_ENV: 'production' }, ['--confirm-demo-seed']), /disabled/);
    assert.throws(() => assertSafeDemoSeedTarget(base, []), /confirm-demo-seed/);
    assert.throws(() => assertSafeDemoSeedTarget({
      ...base,
      DATABASE_URL: 'postgresql://test:test@project.supabase.co:5432/postgres',
    }, ['--confirm-demo-seed']), /local database/);
  });

  test('test database guard permits only a separate schema on the existing Supabase project', () => {
    const environment = {
      DATABASE_URL: 'postgresql://postgres.projectref123:secret@aws-0-region.pooler.supabase.com:6543/postgres?schema=public&pgbouncer=true',
      DIRECT_URL: 'postgresql://postgres.projectref123:secret@db.projectref123.supabase.co:5432/postgres?schema=public',
      TEST_DATABASE_URL: 'postgresql://postgres.projectref123:secret@aws-0-region.pooler.supabase.com:6543/postgres?schema=marketplace_test&pgbouncer=true',
      TEST_DIRECT_URL: 'postgresql://postgres.projectref123:secret@db.projectref123.supabase.co:5432/postgres?schema=marketplace_test',
    };
    assert.equal(assertIsolatedTestDatabase(environment).schema, 'marketplace_test');
    assert.throws(() => assertIsolatedTestDatabase({
      ...environment,
      TEST_DATABASE_URL: environment.DATABASE_URL,
      TEST_DIRECT_URL: environment.DIRECT_URL,
    }), /production database schema/);
  });
  assert.equal(customer.status, 403);
});

test('role permission matrix grants operational access to staff and admin-only controls to administrators', () => {
  const staffPermissions = [
    'dashboard:read',
    'catalog:read',
    'catalog:write',
    'categories:read',
    'orders:read',
    'orders:update',
    'inventory:read',
    'inventory:manage',
    'media:manage',
  ] as const;
  for (const permission of staffPermissions) assert.equal(hasPermission('STAFF', permission), true);
  for (const permission of permissions) assert.equal(hasPermission('ADMIN', permission), true);
  for (const permission of ['catalog:archive', 'categories:manage', 'orders:cancel', 'refunds:authorize', 'users:manage', 'audit:read', 'settings:manage'] as const) {
    assert.equal(hasPermission('STAFF', permission), false);
  }
});

test('an ADMIN account can access the Operations dashboard API', async () => {
  stub(prisma.user, 'findUnique', async () => ({ ...testUser, role: 'ADMIN', isActive: true }));
  stub(prisma.order, 'count', async () => 0);
  stub(prisma.order, 'aggregate', async () => ({ _sum: { total: null } }));
  stub(prisma.product, 'findMany', async () => []);
  stub(prisma.productVariant, 'findMany', async () => []);
  stub(prisma.order, 'findMany', async () => []);

  const response = await fetch(`${baseUrl}/admin/dashboard`, {
    headers: { Cookie: cookieFor('ADMIN') },
  });

  assert.equal(response.status, 200);
  const result = await response.json() as { data: { demoDataLabel: string } };
  assert.equal(result.data.demoDataLabel, 'Live figures from the marketplace database');
});

test('Monime SLE amounts convert exactly to minor units and reject excess precision', () => {
  assert.equal(sleToMinorUnits('20251.00'), 2025100);
  assert.equal(sleToMinorUnits('0.05'), 5);
  assert.throws(() => sleToMinorUnits('10.005'), /two decimal places/);
});

test('Sierra Leone monetary values follow the NLe standard and default delivery fee', () => {
  assert.equal(DEFAULT_DELIVERY_FEE, '50.00');
  assert.equal(formatSLE('50.00'), 'NLe 50.00');
  assert.equal(formatSLE(250), 'NLe 250.00');
});

test('Monime webhook signatures require raw-body HMAC and a fresh timestamp', () => {
  const body = '{"event":"test"}';
  const signature = monimeSignature(body);
  assert.equal(verifyMonimeWebhookSignature(Buffer.from(body), signature, process.env.MONIME_WEBHOOK_SECRET!), true);
  assert.equal(verifyMonimeWebhookSignature(Buffer.from(`${body} `), signature, process.env.MONIME_WEBHOOK_SECRET!), false);
  assert.equal(verifyMonimeWebhookSignature(
    Buffer.from(body),
    monimeSignature(body, Math.floor(Date.now() / 1000) - 301),
    process.env.MONIME_WEBHOOK_SECRET!,
  ), false);
});

test('product browsing filters inactive products and hides unapproved gallery images', async () => {
  let productFilter: unknown;
  stub(prisma.product, 'findMany', async (argument) => {
    productFilter = (argument as { where: unknown }).where;
    return [{
      id: 'product-test-1',
      name: 'Test Rice',
      slug: 'test-rice',
      price: '125.50',
      compareAtPrice: null,
      imageUrl: 'https://images.example.test/unreviewed.jpg',
      thumbnailUrl: 'https://images.example.test/unreviewed-thumb.jpg',
      altText: 'Unreviewed rice image',
      imageStatus: 'NEEDS_REVIEW',
      brand: 'Test Brand',
      productImages: [{
        id: 'image-test-1',
        imageUrl: 'https://images.example.test/unreviewed-gallery.jpg',
        altText: 'Unreviewed gallery image',
        isPrimary: true,
        order: 0,
      }],
      category: { id: 'category-test-1', name: 'Pantry', slug: 'pantry' },
    }];
  });
  stub(prisma.product, 'count', async () => 1);

  const response = await fetch(`${baseUrl}/products?page=1&limit=10`);
  assert.equal(response.status, 200);
  const result = await response.json() as {
    data: { products: Array<{ imageUrl: string; brand: string | null; productImages: Array<{ imageUrl: string }> }> };
  };
  assert.equal((productFilter as { isActive: boolean }).isActive, true);
  assert.equal(result.data.products[0].imageUrl, '/api/v1/assets/product/placeholder.svg');
  assert.equal(result.data.products[0].brand, 'Test Brand');
  assert.equal(result.data.products[0].productImages[0].imageUrl, '/api/v1/assets/product/placeholder.svg');
});

test('catalog product search includes brand matches', async () => {
  let productFilter: unknown;
  stub(prisma.product, 'findMany', async (argument) => {
    productFilter = (argument as { where: unknown }).where;
    return [];
  });
  stub(prisma.product, 'count', async () => 0);

  const response = await fetch(`${baseUrl}/products?q=Acme`);
  assert.equal(response.status, 200);
  const clauses = (productFilter as { OR: Array<Record<string, unknown>> }).OR;
  assert.ok(clauses.some((clause) => 'brand' in clause));
});

test('admin product search includes brand matches', async () => {
  let productFilter: unknown;
  stub(prisma.user, 'findUnique', async () => ({ ...testUser, role: 'ADMIN', isActive: true }));
  stub(prisma.product, 'findMany', async (argument) => {
    productFilter = (argument as { where: unknown }).where;
    return [];
  });
  const response = await fetch(`${baseUrl}/admin/products?q=Acme`, {
    headers: { Cookie: cookieFor('ADMIN') },
  });
  assert.equal(response.status, 200);
  const clauses = (productFilter as { OR: Array<Record<string, unknown>> }).OR;
  assert.ok(clauses.some((clause) => 'brand' in clause));
});

test('canonical category navigation filters matching existing catalogue categories', async () => {
  let productFilter: unknown;
  stub(prisma.product, 'findMany', async (argument) => {
    productFilter = (argument as { where: unknown }).where;
    return [];
  });
  stub(prisma.product, 'count', async () => 0);

  const response = await fetch(`${baseUrl}/products?category=food-groceries`);
  assert.equal(response.status, 200);
  assert.deepEqual(
    (productFilter as { category: { slug: { in: string[] } } }).category.slug.in,
    ['food-groceries', 'rice-and-grains', 'cooking-oils', 'cereal', 'bakery', 'frozen-foods'],
  );
});

test('cart writes require authentication and enforce current stock', async () => {
  const product = {
    id: 'product-test-1',
    name: 'Test Rice',
    brand: null as string | null,
    slug: 'test-rice',
    price: '125.50',
    stock: 2,
    imageUrl: 'https://images.example.test/rice.jpg',
    altText: 'Rice package',
    isActive: true,
    category: { name: 'Pantry' },
  };
  let cartItems: Array<Record<string, unknown>> = [];
  let writes = 0;
  const variant = {
    id: 'variant-test-1',
    productId: product.id,
    name: '1 kg',
    quantity: '1',
    unit: 'kg',
    sku: 'RICE-001-1KG',
    price: '125.50',
    stock: 2,
    isActive: true,
    isDefault: true,
  };
  stub(prisma.user, 'findUnique', async () => ({ ...testUser, isActive: true }));
  stub(prisma.product, 'findFirst', async () => product);
  stub(prisma.productVariant, 'findFirst', async () => variant);
  stub(prisma.cart, 'upsert', async () => ({
    id: 'cart-test-1',
    userId: testUser.id,
    items: cartItems,
  }));
  stub(prisma.cartItem, 'upsert', async (argument) => {
    const data = (argument as { create: { productId: string; quantity: number } }).create;
    writes += 1;
    cartItems = [{
      id: 'cart-item-test-1',
      productId: data.productId,
      variantId: variant.id,
      quantity: data.quantity,
      product,
      variant,
    }];
    return { id: 'cart-item-test-1' };
  });

  const unauthenticated = await fetch(`${baseUrl}/cart/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: product.id, quantity: 1 }),
  });
  assert.equal(unauthenticated.status, 401);

  const overStock = await fetch(`${baseUrl}/cart/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieFor() },
    body: JSON.stringify({ productId: product.id, quantity: 3 }),
  });
  assert.equal(overStock.status, 409);
  assert.equal(writes, 0);

  const accepted = await fetch(`${baseUrl}/cart/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieFor() },
    body: JSON.stringify({ productId: product.id, quantity: 2 }),
  });
  assert.equal(accepted.status, 201);
  assert.equal(writes, 1);
  assert.equal((await accepted.json() as { data: { cart: { items: Array<{ quantity: number }> } } }).data.cart.items[0].quantity, 2);
});

test('image validation matches JPEG, PNG, and WebP signatures to declared MIME types', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  const webp = Buffer.from('RIFF0000WEBP', 'ascii');
  assert.doesNotThrow(() => validateImageSignature('image/png', png));
  assert.doesNotThrow(() => validateImageSignature('image/jpeg', jpeg));
  assert.doesNotThrow(() => validateImageSignature('image/webp', webp));
  assert.throws(() => validateImageSignature('image/png', Buffer.from('not a png')), { code: 'IMAGE_SIGNATURE_MISMATCH' });
  assert.throws(() => validateImageSignature('image/jpeg', png), { code: 'IMAGE_SIGNATURE_MISMATCH' });
});

test('Cloudinary upload proxy rejects customers, unapproved folders, and oversized files', async () => {
  stub(prisma.user, 'findUnique', async () => ({ ...testUser, isActive: true }));
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const form = (folder: string, file: Blob = new Blob([png], { type: 'image/png' })) => {
    const body = new FormData();
    body.append('file', file, 'image.png');
    body.append('folder', folder);
    return body;
  };

  const forbidden = await fetch(`${baseUrl}/admin/images/upload`, {
    method: 'POST',
    headers: { Cookie: cookieFor('CUSTOMER') },
    body: form('monoprix/products'),
  });
  assert.equal(forbidden.status, 403);

  stub(prisma.user, 'findUnique', async () => ({ ...testUser, role: 'ADMIN', isActive: true }));
  const invalidFolder = await fetch(`${baseUrl}/admin/images/upload`, {
    method: 'POST',
    headers: { Cookie: cookieFor('ADMIN') },
    body: form('arbitrary-folder'),
  });
  assert.equal(invalidFolder.status, 400);

  const oversized = await fetch(`${baseUrl}/admin/images/upload`, {
    method: 'POST',
    headers: { Cookie: cookieFor('ADMIN') },
    body: form('monoprix/products', new Blob([Buffer.alloc(10 * 1024 * 1024 + 1)], { type: 'image/png' })),
  });
  assert.equal(oversized.status, 413);
});

test('staff can create and edit products but cannot archive; administrators can archive', async () => {
  const staffUser = { ...testUser, role: 'STAFF', isActive: true };
  const adminUser = { ...testUser, role: 'ADMIN', isActive: true };
  const category = { id: 'category-test-1', name: 'Pantry', slug: 'pantry' };
  const product = {
    id: 'product-test-1',
    sku: 'RICE-001',
    name: 'Test Rice',
    slug: 'test-rice',
    price: '12.34',
    stock: 5,
    isActive: true,
    variants: [{
      id: 'variant-test-1',
      productId: 'product-test-1',
      sku: 'RICE-001',
      name: 'Standard',
      quantity: '1',
      unit: 'item',
      price: '12.34',
      stock: 5,
      isActive: true,
      isDefault: true,
    }],
  };
  let createdData: Record<string, unknown> | undefined;
  let updatedData: Record<string, unknown> | undefined;
  const createdProducts: Record<string, unknown>[] = [];
  let archived = false;
  const inventoryMovements: Array<Record<string, unknown>> = [];
  const auditEntries: Array<Record<string, unknown>> = [];
  stub(prisma.user, 'findUnique', async () => staffUser);
  stub(prisma.category, 'findUnique', async () => category);
  stub(prisma.product, 'findUnique', async () => product);
  stub(prisma.product, 'create', async (argument) => {
    createdData = (argument as { data: Record<string, unknown> }).data;
    createdProducts.push(createdData);
    const variantsArg = (createdData?.variants as { create?: Array<Record<string, unknown>> })?.create ?? [];
    const createdVariants = variantsArg.map((v, i) => ({ id: `variant-${i}`, ...v }));
    return { ...product, ...createdData, variants: createdVariants, brand: createdData.brand ?? null };
  });
  stub(prisma.product, 'update', async (argument) => {
    const data = (argument as { data: Record<string, unknown> }).data;
    if (data.isActive === false) archived = true;
    else updatedData = data;
    return { ...product, ...data };
  });
  stub(prisma.productVariant, 'update', async () => ({}));
  stub(prisma.inventoryMovement, 'create', async (argument) => {
    inventoryMovements.push(argument as Record<string, unknown>);
    return {};
  });
  stub(prisma.auditLog, 'create', async (argument) => {
    auditEntries.push(argument as Record<string, unknown>);
    return {};
  });
  stub(prisma, '$transaction', async (callback) => {
    assert.equal(typeof callback, 'function');
    return (callback as (transaction: typeof prisma) => Promise<unknown>)(prisma);
  });

  const headers = { 'Content-Type': 'application/json', Cookie: cookieFor('STAFF') };
  const created = await fetch(`${baseUrl}/admin/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sku: 'RICE-001',
      name: 'Test Rice',
      brand: 'Monoprix Select',
      description: 'A test pantry product.',
      categoryId: category.id,
      price: '12.34',
      stock: 5,
      imageUrl: 'https://images.example.test/rice.jpg',
      altText: 'Bag of rice',
      imageSource: 'approved-upload',
      license: 'Approved internal demonstration image',
    }),
  });
  assert.equal(created.status, 201);
  assert.match(String(createdData?.slug), /^test-rice-/);
  assert.equal((createdData?.price as { toString(): string }).toString(), '12.34');
  assert.equal(createdData?.brand, 'Monoprix Select');
  assert.equal((await created.json() as { data: { product: { brand: string | null } } }).data.product.brand, 'Monoprix Select');

  const unbrandedCreate = await fetch(`${baseUrl}/admin/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sku: 'RICE-002',
      name: 'Plain Rice',
      description: 'Another test pantry product.',
      categoryId: category.id,
      price: '8.50',
      stock: 3,
      imageUrl: 'https://images.example.test/plain-rice.jpg',
      altText: 'Bag of plain rice',
      imageSource: 'approved-upload',
      license: 'Approved internal demonstration image',
    }),
  });
  assert.equal(unbrandedCreate.status, 201);
  assert.equal(createdProducts[1].brand, undefined);
  assert.equal((await unbrandedCreate.json() as { data: { product: { brand?: string | null } } }).data.product.brand, null);

  const edited = await fetch(`${baseUrl}/admin/products/${product.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ price: '15.00', stock: 7, brand: 'Fresh Choice' }),
  });
  assert.equal(edited.status, 200);
  assert.equal((updatedData?.price as { toString(): string }).toString(), '15');
  assert.equal(updatedData?.stock, 7);
  assert.equal(updatedData?.brand, 'Fresh Choice');
  assert.equal((await edited.json() as { data: { product: { brand: string | null } } }).data.product.brand, 'Fresh Choice');
  const clearBrand = await fetch(`${baseUrl}/admin/products/${product.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ brand: null }),
  });
  assert.equal(clearBrand.status, 200);
  assert.equal(updatedData?.brand, null);
  const stockMovement = inventoryMovements.find((entry) => (
    (entry.data as { type?: string }).type === 'ADMIN_ADJUSTMENT'
  ));
  assert.equal((stockMovement?.data as { quantity: number }).quantity, 2);
  const stockAudit = auditEntries.find((entry) => (
    (entry.data as { action?: string }).action === 'PRODUCT_UPDATED'
  ));
  assert.match(String((stockAudit?.data as { details: string }).details), /stock 5 -> 7/);

  const staffRestore = await fetch(`${baseUrl}/admin/products/${product.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ isActive: true }),
  });
  assert.equal(staffRestore.status, 403);

  const archivedResponse = await fetch(`${baseUrl}/admin/products/${product.id}`, {
    method: 'DELETE',
    headers: { Cookie: headers.Cookie },
  });
  assert.equal(archivedResponse.status, 403);
  stub(prisma.user, 'findUnique', async () => adminUser);
  const adminArchive = await fetch(`${baseUrl}/admin/products/${product.id}`, {
    method: 'DELETE',
    headers: { Cookie: cookieFor('ADMIN') },
  });
  assert.equal(adminArchive.status, 200);
  assert.equal(archived, true);
});

test('staff cannot manage categories, user roles, audit logs, or cancel orders', async () => {
  const staffUser = { ...testUser, role: 'STAFF', isActive: true };
  stub(prisma.user, 'findUnique', async () => staffUser);

  const category = await fetch(`${baseUrl}/admin/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieFor('STAFF') },
    body: JSON.stringify({ name: 'Restricted category' }),
  });
  assert.equal(category.status, 403);

  const roleChange = await fetch(`${baseUrl}/admin/users/user-test-2`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookieFor('STAFF') },
    body: JSON.stringify({ role: 'ADMIN' }),
  });
  assert.equal(roleChange.status, 403);

  const auditLogs = await fetch(`${baseUrl}/admin/audit-logs`, {
    headers: { Cookie: cookieFor('STAFF') },
  });
  assert.equal(auditLogs.status, 403);

  const cancellation = await fetch(`${baseUrl}/admin/orders/order-test-1/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookieFor('STAFF') },
    body: JSON.stringify({ status: 'CANCELLED' }),
  });
  assert.equal(cancellation.status, 403);
});

test('staff order listings exclude payment credential and payload relations', async () => {
  const staffUser = { ...testUser, role: 'STAFF', isActive: true };
  let orderQuery: { include?: Record<string, unknown> } | undefined;
  stub(prisma.user, 'findUnique', async () => staffUser);
  stub(prisma.order, 'findMany', async (argument) => {
    orderQuery = argument as { include?: Record<string, unknown> };
    return [{
      id: 'order-test-1',
      customerName: 'Test Customer',
      paymentStatus: 'PENDING',
      paymentMethod: 'CASH_ON_DELIVERY',
    }];
  });

  const response = await fetch(`${baseUrl}/admin/orders`, {
    headers: { Cookie: cookieFor('STAFF') },
  });
  assert.equal(response.status, 200);
  assert.equal(orderQuery?.include?.payment, undefined);
  assert.equal('payment' in (await response.json() as { data: { orders: Array<Record<string, unknown>> } }).data.orders[0], false);
});

test('staff cannot manage user accounts or authorize refunds', async () => {
  const staffUser = { ...testUser, role: 'STAFF', isActive: true };
  stub(prisma.user, 'findUnique', async () => staffUser);

  const users = await fetch(`${baseUrl}/admin/users`, {
    headers: { Cookie: cookieFor('STAFF') },
  });
  assert.equal(users.status, 403);

  const refund = await fetch(`${baseUrl}/admin/orders/order-test-1/refund-authorizations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieFor('STAFF') },
    body: JSON.stringify({ reason: 'Customer request' }),
  });
  assert.equal(refund.status, 403);
});

test('Monime initiates an idempotent SLE hosted checkout using minor units', async () => {
  const payment = {
    id: 'payment-monime-1',
    orderId: 'order-monime-1',
    provider: 'monime',
    transactionRef: 'MONIME-test-ref',
    amount: { toString: () => '20251.00' },
    currency: 'SLE',
    status: 'PENDING',
    providerSessionId: null,
    payload: null,
  };
  const order = { id: payment.orderId, userId: testUser.id, status: 'PENDING', payment };
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  let savedData: Record<string, unknown> | undefined;
  stub(prisma.user, 'findUnique', async () => ({ ...testUser, isActive: true }));
  stub(prisma.order, 'findFirst', async () => order);
  stub(globalThis, 'fetch', async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    if (requestUrl.startsWith('https://api.monime.io/')) {
      return new Response(JSON.stringify({
        success: true,
        result: { id: 'chk-test-1', status: 'pending', redirectUrl: 'https://checkout.monime.io/test-session' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return httpFetch(input, init);
  });
  stub(prisma.payment, 'update', async (argument) => {
    savedData = (argument as { data: Record<string, unknown> }).data;
    return payment;
  });
  stub(prisma.paymentEvent, 'create', async () => ({}));
  stub(prisma, '$transaction', async (callback) => (
    (callback as (transaction: typeof prisma) => Promise<unknown>)(prisma)
  ));

  const response = await fetch(`${baseUrl}/payments/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieFor() },
    body: JSON.stringify({ orderId: order.id }),
  });
  assert.equal(response.status, 200);
  assert.equal(requestUrl, 'https://api.monime.io/v1/checkout-sessions');
  assert.match(String(requestInit?.headers && new Headers(requestInit.headers).get('Idempotency-Key')), /^monoprix-payment-monime-1-/);
  const body = JSON.parse(String(requestInit?.body)) as {
    reference: string;
    lineItems: Array<{ price: { currency: string; value: number } }>;
  };
  assert.equal(body.reference, payment.transactionRef);
  assert.deepEqual(body.lineItems[0].price, { currency: 'SLE', value: 2025100 });
  assert.equal('paymentOptions' in body, false);
  assert.equal(savedData?.providerSessionId, 'chk-test-1');
  assert.equal((await response.json() as { data: { payment: { redirectUrl: string } } }).data.payment.redirectUrl, 'https://checkout.monime.io/test-session');
});

test('Monime success callback accepts the provider POST and redirects to order status', async () => {
  const response = await fetch(`${baseUrl}/payments/monime/success?orderId=order-test-1`, {
    method: 'POST',
    redirect: 'manual',
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'http://localhost:5173/orders?payment=returned&orderId=order-test-1');
});

function monimeWebhookBody(eventName: string, sessionStatus: string, eventId = `wke-${eventName}`) {
  return JSON.stringify({
    apiVersion: 'caph.2025-08-23',
    event: { id: eventId, name: eventName, timestamp: String(Math.floor(Date.now() / 1000)) },
    object: { id: 'chk-test-1', type: 'checkout_session' },
    data: { id: 'chk-test-1', status: sessionStatus },
  });
}

function stubMonimeSession(status: string, options: { reference?: string; currency?: string; amount?: number } = {}) {
  stub(globalThis, 'fetch', async (input, init) => {
    if (!String(input).startsWith('https://api.monime.io/')) return httpFetch(input, init);
    return new Response(JSON.stringify({
      success: true,
      result: {
        id: 'chk-test-1',
        status,
        reference: options.reference ?? 'MONIME-test-ref',
        ...(status === 'completed' ? {
          lineItems: { data: [{
            quantity: 1,
            price: { currency: options.currency ?? 'SLE', value: options.amount ?? 2025100 },
          }] },
        } : {}),
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}

function stubMonimeWebhookPayment() {
  stub(prisma.payment, 'findFirst', async () => ({
    id: 'payment-monime-1',
    orderId: 'order-monime-1',
    provider: 'monime',
    providerSessionId: 'chk-test-1',
    transactionRef: 'MONIME-test-ref',
    amount: { toString: () => '20251.00' },
    currency: 'SLE',
    status: 'PENDING',
    order: {
      id: 'order-monime-1',
      userId: testUser.id,
      status: 'PENDING',
      total: { toString: () => '20251.00' },
    },
  }));
}

async function assertMonimeSessionMismatchRejected(
  options: { reference?: string; currency?: string; amount?: number },
  eventId: string,
) {
  let paymentUpdated = false;
  stubMonimeWebhookPayment();
  stubMonimeSession('completed', options);
  stub(prisma.payment, 'updateMany', async () => { paymentUpdated = true; return { count: 1 }; });
  const rawBody = monimeWebhookBody('checkout_session.completed', 'completed', eventId);
  const response = await fetch(`${baseUrl}/payments/webhooks/monime`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'monime-signature': monimeSignature(rawBody) },
    body: rawBody,
  });
  assert.equal(response.status, 409);
  assert.equal(paymentUpdated, false);
}

test('Monime completed webhook verifies current session and records payment as paid', async () => {
  let paymentStatus = '';
  let orderStatus: unknown;
  let lifecycleStatus: unknown;
  stubMonimeWebhookPayment();
  stubMonimeSession('completed');
  stub(prisma.paymentEvent, 'create', async () => ({}));
  stub(prisma.payment, 'updateMany', async (argument) => {
    paymentStatus = (argument as { data: { status: string } }).data.status;
    return { count: 1 };
  });
  stub(prisma.order, 'update', async (argument) => {
    orderStatus = (argument as { data: { paymentStatus: string } }).data.paymentStatus;
    lifecycleStatus = (argument as { data: { status?: string } }).data.status;
    return {};
  });
  stub(prisma.notification, 'create', async () => ({}));
  stub(prisma, '$transaction', async (callback) => (
    (callback as (transaction: typeof prisma) => Promise<unknown>)(prisma)
  ));
  const rawBody = monimeWebhookBody('checkout_session.completed', 'completed');
  const response = await fetch(`${baseUrl}/payments/webhooks/monime`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'monime-signature': monimeSignature(rawBody) },
    body: rawBody,
  });
  assert.equal(response.status, 200);
  assert.equal(paymentStatus, 'PAID');
  assert.equal(orderStatus, 'PAID');
  assert.equal(lifecycleStatus, 'CONFIRMED');
});

test('Monime completed webhook rejects amount mismatches without updating payment', async () => {
  await assertMonimeSessionMismatchRejected({ amount: 2025099 }, 'wke-wrong-amount');
});

test('Monime completed webhook rejects currency mismatches without updating payment', async () => {
  await assertMonimeSessionMismatchRejected({ currency: 'USD' }, 'wke-wrong-currency');
});

test('Monime completed webhook rejects reference mismatches without updating payment', async () => {
  await assertMonimeSessionMismatchRejected({ reference: 'MONIME-wrong-ref' }, 'wke-wrong-reference');
});

test('Monime cancelled checkout marks payment failed and leaves order unconfirmed', async () => {
  let paymentStatus = '';
  let orderPaymentStatus: unknown;
  stubMonimeWebhookPayment();
  stubMonimeSession('cancelled');
  stub(prisma.paymentEvent, 'create', async () => ({}));
  stub(prisma.payment, 'updateMany', async (argument) => {
    paymentStatus = (argument as { data: { status: string } }).data.status;
    return { count: 1 };
  });
  stub(prisma.order, 'updateMany', async (argument) => {
    orderPaymentStatus = (argument as { data: { paymentStatus: string } }).data.paymentStatus;
    return { count: 1 };
  });
  stub(prisma.notification, 'create', async () => ({}));
  stub(prisma, '$transaction', async (callback) => (
    (callback as (transaction: typeof prisma) => Promise<unknown>)(prisma)
  ));
  const rawBody = monimeWebhookBody('checkout_session.cancelled', 'cancelled');
  const response = await fetch(`${baseUrl}/payments/webhooks/monime`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'monime-signature': monimeSignature(rawBody) },
    body: rawBody,
  });
  assert.equal(response.status, 200);
  assert.equal(paymentStatus, 'FAILED');
  assert.equal(orderPaymentStatus, 'FAILED');
});

test('Monime duplicate webhook event is acknowledged without repeating payment effects', async () => {
  stubMonimeWebhookPayment();
  stubMonimeSession('completed');
  stub(prisma.paymentEvent, 'create', async () => {
    throw Object.assign(new Error('Duplicate event'), { code: 'P2002' });
  });
  stub(prisma, '$transaction', async (callback) => (
    (callback as (transaction: typeof prisma) => Promise<unknown>)(prisma)
  ));
  const rawBody = monimeWebhookBody('checkout_session.completed', 'completed', 'wke-duplicate');
  const response = await fetch(`${baseUrl}/payments/webhooks/monime`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'monime-signature': monimeSignature(rawBody) },
    body: rawBody,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { data: { duplicate: boolean } }).data.duplicate, true);
});

test('Monime webhook rejects invalid signatures before loading or changing payment state', async () => {
  let paymentLookups = 0;
  stub(prisma.payment, 'findFirst', async () => { paymentLookups += 1; return null; });
  const rawBody = monimeWebhookBody('checkout_session.completed', 'completed');
  const response = await fetch(`${baseUrl}/payments/webhooks/monime`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'monime-signature': 't=1,v1=invalid' },
    body: rawBody,
  });
  assert.equal(response.status, 401);
  assert.equal(paymentLookups, 0);
});

test('Monime webhook accepts requests from external origins and proxies without CSRF rejection', async () => {
  const rawBody = ` {\n  "apiVersion": "caph.2025-08-23",\n  "event": { "id": "wke-external-origin", "name": "external.probe", "timestamp": "2026-11-14T10:00:00Z" },\n  "object": { "id": "chk-external-origin", "type": "checkout_session" },\n  "data": { "id": "chk-external-origin" }\n} `;
  const response = await fetch(`${baseUrl}/payments/webhooks/monime`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://petroleum-blizzard-implosive.ngrok-free.dev',
      'monime-signature': monimeSignature(rawBody),
    },
    body: rawBody,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { accepted: true, ignored: true } });
});

test('Monime compatibility webhook accepts a correctly signed raw body at the registered path', async () => {
  const rawBody = ` {\n  "apiVersion": "caph.2025-08-23",\n  "event": { "id": "wke-compatibility", "name": "compatibility.probe", "timestamp": "2026-11-14T10:00:00Z" },\n  "object": { "id": "chk-compatibility", "type": "checkout_session" },\n  "data": { "id": "chk-compatibility" }\n} `;
  const response = await fetch(`${originUrl}/webhooks/monime`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'monime-signature': monimeSignature(rawBody) },
    body: rawBody,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { accepted: true, ignored: true } });
});

test('Monime compatibility webhook rejects invalid signatures at the registered path', async () => {
  let paymentLookups = 0;
  stub(prisma.payment, 'findFirst', async () => { paymentLookups += 1; return null; });
  const rawBody = monimeWebhookBody('checkout_session.completed', 'completed');
  const response = await fetch(`${originUrl}/webhooks/monime`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'monime-signature': 't=1,v1=invalid' },
    body: rawBody,
  });
  assert.equal(response.status, 401);
  assert.equal(paymentLookups, 0);
});

test('checkout prices orders from the database, reserves stock, and empties the cart transactionally', async () => {
  const product = {
    id: 'product-test-1',
    name: 'Test Rice',
    price: '125.50',
    stock: 5,
    isActive: true,
  };
  const variant = {
    id: 'variant-test-1',
    productId: product.id,
    name: 'Standard',
    quantity: '1',
    unit: 'item',
    sku: 'RICE-001',
    price: '125.50',
    stock: 5,
    isActive: true,
    isDefault: true,
  };
  let orderCreate: Record<string, unknown> | undefined;
  let stockUpdate: Record<string, unknown> | undefined;
  let cartCleared = false;
  stub(prisma.order, 'findFirst', async () => null);
  stub(prisma.cart, 'findUnique', async () => ({
    id: 'cart-test-1',
    items: [{ productId: product.id, variantId: variant.id, quantity: 2, product, variant }],
  }));
  stub(prisma.productVariant, 'updateMany', async (argument) => {
    stockUpdate = argument as Record<string, unknown>;
    return { count: 1 };
  });
  stub(prisma.product, 'update', async () => ({ ...product }));
  stub(prisma.inventoryMovement, 'create', async () => ({}));
  stub(prisma.order, 'create', async (argument) => {
    orderCreate = argument as Record<string, unknown>;
    return { id: 'order-test-1', total: '20251.00', email: null };
  });
  stub(prisma.paymentEvent, 'create', async () => ({}));
  stub(prisma.cartItem, 'deleteMany', async () => { cartCleared = true; return { count: 1 }; });
  stub(prisma.auditLog, 'create', async () => ({}));
  stub(prisma.notification, 'create', async () => ({}));
  stub(prisma, '$transaction', async (callback) => {
    assert.equal(typeof callback, 'function');
    return (callback as (transaction: typeof prisma) => Promise<unknown>)(prisma);
  });

  const order = await createOrder(testUser.id, {
    customerName: testUser.name,
    phone: '+232000000',
    addressLine: '1 Test Street',
    area: 'Freetown',
    paymentMethod: 'CASH_ON_DELIVERY',
    idempotencyKey: 'a89f9ca5-59f9-41b8-ae24-01c099a3a840',
  });

  assert.equal(order.id, 'order-test-1');
  assert.equal(((orderCreate?.data as { subtotal: { toString(): string } }).subtotal).toString(), '251');
  assert.equal(((orderCreate?.data as { total: { toString(): string } }).total).toString(), '301');
  assert.equal((stockUpdate?.where as { stock: { gte: number } }).stock.gte, 2);
  assert.equal((stockUpdate?.data as { stock: { decrement: number } }).stock.decrement, 2);
  assert.equal(cartCleared, true);
});

test('order cancellation follows valid transitions and records stock restoration', async () => {
  let stockRestored: Record<string, unknown> | undefined;
  let movement: Record<string, unknown> | undefined;
  let orderUpdate: Record<string, unknown> | undefined;
  let newStatus = '';
  stub(prisma.order, 'findUnique', async () => ({
    id: 'order-test-1',
    status: 'PENDING',
    paymentStatus: 'PENDING',
    paymentMethod: 'CASH_ON_DELIVERY',
    items: [{ productId: 'product-test-1', quantity: 2 }],
  }));
  stub(prisma.product, 'update', async (argument) => {
    stockRestored = argument as Record<string, unknown>;
    return {};
  });
  stub(prisma.inventoryMovement, 'create', async (argument) => {
    movement = argument as Record<string, unknown>;
    return {};
  });
  stub(prisma.order, 'update', async (argument) => {
    orderUpdate = argument as Record<string, unknown>;
    const data = (argument as { data: { status: string } }).data;
    newStatus = data.status;
    return {
      id: 'order-test-1',
      status: data.status,
      userId: testUser.id,
      email: null,
    };
  });
  stub(prisma.notification, 'create', async () => ({}));
  stub(prisma.auditLog, 'create', async () => ({}));
  stub(prisma, '$transaction', async (callback) => {
    assert.equal(typeof callback, 'function');
    return (callback as (transaction: typeof prisma) => Promise<unknown>)(prisma);
  });

  const order = await updateOrderStatus('order-test-1', 'CANCELLED', 'staff-test-1');
  assert.equal(order.status, 'CANCELLED');
  assert.equal(newStatus, 'CANCELLED');
  assert.equal(orderUpdate?.include, undefined);
  assert.equal('user' in order, false);
  assert.equal((stockRestored?.data as { stock: { increment: number } }).stock.increment, 2);
  assert.equal((movement?.data as { type: string }).type, 'ORDER_CANCELLATION');
});

test('unpaid Monime orders cannot be confirmed', async () => {
  stub(prisma.order, 'findUnique', async () => ({
    id: 'order-test-1',
    status: 'PENDING',
    paymentStatus: 'PENDING',
    paymentMethod: 'MONIME',
    items: [],
  }));
  stub(prisma, '$transaction', async (callback) => (
    (callback as (transaction: typeof prisma) => Promise<unknown>)(prisma)
  ));
  await assert.rejects(
    updateOrderStatus('order-test-1', 'CONFIRMED', 'staff-test-1'),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'PAYMENT_REQUIRED',
  );
});

test('failed Monime orders can be cancelled and audited without refund authorization', async () => {
  let updatedStatus = '';
  stub(prisma.order, 'findUnique', async () => ({
    id: 'order-test-1',
    status: 'PENDING',
    paymentStatus: 'FAILED',
    paymentMethod: 'MONIME',
    items: [],
  }));
  stub(prisma.order, 'update', async (argument) => {
    updatedStatus = (argument as { data: { status: string } }).data.status;
    return { id: 'order-test-1', status: updatedStatus, userId: testUser.id, email: null };
  });
  stub(prisma.notification, 'create', async () => ({}));
  stub(prisma.auditLog, 'create', async () => ({}));
  stub(prisma, '$transaction', async (callback) => (
    (callback as (transaction: typeof prisma) => Promise<unknown>)(prisma)
  ));
  const order = await updateOrderStatus('order-test-1', 'CANCELLED', 'staff-test-1');
  assert.equal(order.status, 'CANCELLED');
  assert.equal(updatedStatus, 'CANCELLED');
});

test('product creation validates required fields and returns field-level details', async () => {
  stub(prisma.user, 'findUnique', async () => ({ ...testUser, role: 'ADMIN', isActive: true }));

  // Missing name, price, SKU, etc.
  const invalidResponse = await fetch(`${baseUrl}/admin/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieFor('ADMIN') },
    body: JSON.stringify({
      name: '',
      sku: '',
      categoryId: '',
      price: '-10.00',
      stock: -5,
      description: 'hi',
    }),
  });

  assert.equal(invalidResponse.status, 400);
  const result = await invalidResponse.json() as { error: string; code: string; details: Array<{ path: string; message: string }> };
  assert.equal(result.code, 'VALIDATION_ERROR');
  assert.ok(Array.isArray(result.details));
  assert.ok(result.details.some((d) => d.path === 'name'));
  assert.ok(result.details.some((d) => d.path === 'sku'));
  assert.ok(result.details.some((d) => d.path === 'categoryId'));
  assert.ok(result.details.some((d) => d.path === 'price'));
  assert.ok(result.details.some((d) => d.path === 'stock'));
});

test('product creation translates duplicate SKU unique constraint to 409 conflict with field path', async () => {
  stub(prisma.user, 'findUnique', async () => ({ ...testUser, role: 'ADMIN', isActive: true }));
  stub(prisma.category, 'findUnique', async () => ({ id: 'cat-1', name: 'Pantry' }));
  stub(prisma, '$transaction', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`sku`)', {
      code: 'P2002',
      clientVersion: '5.22.0',
      meta: { target: ['sku'] },
    });
    throw error;
  });

  const response = await fetch(`${baseUrl}/admin/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieFor('ADMIN') },
    body: JSON.stringify({
      name: 'Duplicate Rice',
      sku: 'DUPLICATE-SKU',
      categoryId: 'cat-1',
      price: '15.00',
      stock: 10,
      description: 'Test pantry description.',
      imageUrl: 'https://images.example.test/rice.jpg',
      altText: 'Alt text',
      imageSource: 'test',
      license: 'MIT License',
      variants: [{
        name: 'Standard',
        quantity: '1',
        unit: 'kg',
        sku: 'DUPLICATE-SKU',
        price: '15.00',
        stock: 10,
        isActive: true,
        isDefault: true,
      }],
    }),
  });

  assert.equal(response.status, 409);
  const result = await response.json() as { error: string; code: string; details: Array<{ path: string; message: string }> };
  assert.equal(result.code, 'CONFLICT');
  assert.equal(result.error, 'This SKU is already assigned to another product.');
  assert.equal(result.details[0]?.path, 'sku');
});
