import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { assertIsolatedTestDatabase } from '../../src/lib/test-database-safety.js';

const target = assertIsolatedTestDatabase();
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });

test('Supabase connection, CRUD, transaction, and inventory reservation roll back cleanly', async () => {
  const connection = await prisma.$queryRaw<Array<{ database: string; schema: string }>>`
    SELECT current_database() AS database, current_schema() AS schema
  `;
  assert.equal(connection[0].schema, target.schema);

  const suffix = randomUUID();
  const email = `integration-${suffix}@example.test`;
  const sku = `IT-${suffix}`;
  const idempotencyKey = randomUUID();
  const rollbackSignal = new Error('ROLLBACK_INTEGRATION_FIXTURE');

  try {
    await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          name: 'Integration Test User',
          email,
          passwordHash: 'non-login-integration-fixture',
          role: 'CUSTOMER',
          isActive: true,
        },
      });
      const category = await transaction.category.create({
        data: { name: `Integration ${suffix}`, slug: `integration-${suffix}` },
      });
      const product = await transaction.product.create({
        data: {
          sku,
          name: 'Integration Reservation Product',
          slug: `integration-product-${suffix}`,
          description: 'Temporary product written only inside a rolled-back test transaction.',
          categoryId: category.id,
          price: '12.50',
          stock: 5,
          imageUrl: 'https://example.test/fixture.png',
          altText: 'Integration fixture',
          imageSource: 'integration-test',
          license: 'Temporary test fixture',
        },
      });
      const variant = await transaction.productVariant.create({
        data: {
          productId: product.id,
          name: '5 kg bag',
          quantity: '5',
          unit: 'kg',
          sku: `${sku}-5KG`,
          price: '12.50',
          stock: 5,
          isDefault: true,
        },
      });
      const cart = await transaction.cart.create({ data: { userId: user.id } });
      await transaction.cartItem.create({
        data: { cartId: cart.id, productId: product.id, variantId: variant.id, quantity: 2 },
      });

      const reservation = await transaction.productVariant.updateMany({
        where: { id: variant.id, isActive: true, stock: { gte: 2 } },
        data: { stock: { decrement: 2 } },
      });
      assert.equal(reservation.count, 1);
      await transaction.inventoryMovement.create({
        data: {
          productId: product.id,
          variantId: variant.id,
          type: 'ORDER',
          quantity: -2,
          reason: 'Integration test reservation',
          reference: idempotencyKey,
        },
      });

      const order = await transaction.order.create({
        data: {
          userId: user.id,
          idempotencyKey,
          customerName: user.name,
          phone: '+232000000',
          addressLine: 'Integration test address',
          area: 'Freetown',
          paymentMethod: 'CASH_ON_DELIVERY',
          subtotal: '25.00',
          deliveryFee: '0',
          total: '25.00',
          items: {
            create: [{
              productId: product.id,
              variantId: variant.id,
              productName: product.name,
              variantName: variant.name,
              variantQuantity: variant.quantity,
              variantUnit: variant.unit,
              variantSku: variant.sku,
              unitPrice: '12.50',
              quantity: 2,
              totalPrice: '25.00',
            }],
          },
        },
      });
      const loaded = await transaction.order.findUnique({
        where: { id: order.id },
        include: { items: true, user: true },
      });
      assert.equal(loaded?.items.length, 1);
      assert.equal(loaded?.user.email, email);
      assert.equal((await transaction.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stock, 3);

      throw rollbackSignal;
    });
    assert.fail('The transaction must roll back.');
  } catch (error) {
    if (error !== rollbackSignal) throw error;
  }

  assert.equal(await prisma.user.findUnique({ where: { email } }), null);
  assert.equal(await prisma.product.findUnique({ where: { sku } }), null);
});

test.after(async () => {
  await prisma.$disconnect();
});
