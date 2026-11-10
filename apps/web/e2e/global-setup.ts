import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

async function globalSetup() {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.TEST_DATABASE_URL } },
  });
  try {
    const schema = new URL(process.env.TEST_DATABASE_URL!).searchParams.get('schema') ?? 'public';
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ${schema}
    `;
    const existing = new Set(tables.map((table) => table.table_name));
    for (const required of ['_prisma_migrations', 'User', 'Category', 'Product', 'Cart', 'CartItem', 'Order']) {
      if (!existing.has(required)) throw new Error(`E2E database is not migrated: missing ${required}.`);
    }

    const category = await prisma.category.upsert({
      where: { slug: 'e2e-phase2-category' },
      create: { name: 'E2E Phase 2', slug: 'e2e-phase2-category' },
      update: {},
    });
    const existingProduct = await prisma.product.findUnique({ where: { sku: 'E2E-PHASE2-001' } });
    if (!existingProduct) {
      await prisma.product.create({
        data: {
          sku: 'E2E-PHASE2-001',
          name: 'E2E Phase 2 Test Product',
          slug: 'e2e-phase2-product',
          description: 'Dedicated browser-test fixture.',
          categoryId: category.id,
          price: '10.00',
          stock: 1000,
          variants: {
            create: {
              name: 'Standard',
              quantity: '1',
              unit: 'item',
              sku: 'E2E-PHASE2-001',
              price: '10.00',
              stock: 1000,
              isActive: true,
              isDefault: true,
            },
          },
          imageUrl: '/api/v1/assets/product/placeholder.svg',
          altText: 'E2E test product',
          imageSource: 'automated-test-fixture',
          license: 'Internal automated test fixture',
          imageStatus: 'NEEDS_REVIEW',
        },
      });
    } else if (!existingProduct.isActive || existingProduct.stock < 1) {
      throw new Error('Existing E2E product fixture is inactive or out of stock; refusing to alter it.');
    }

    const email = process.env.E2E_STAFF_EMAIL!;
    const password = process.env.E2E_STAFF_PASSWORD!;
    const staff = await prisma.user.findUnique({ where: { email } });
    if (staff) {
      if (staff.role !== 'STAFF' || !staff.isActive || !(await bcrypt.compare(password, staff.passwordHash))) {
        throw new Error('Existing E2E staff account does not match the configured credentials; refusing to modify it.');
      }
    } else {
      await prisma.user.create({
        data: {
          name: 'E2E Staff',
          email,
          passwordHash: await bcrypt.hash(password, 12),
          role: 'STAFF',
          isActive: true,
          cart: { create: {} },
        },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

export default globalSetup;
