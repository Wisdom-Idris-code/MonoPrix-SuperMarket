import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { categories, productCatalog } from '../src/data/demo-data.js';
import { assertSafeDemoSeedTarget } from '../src/lib/demo-seed-safety.js';

async function main() {
  assertSafeDemoSeedTarget(process.env, process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash(process.env.DEMO_SEED_PASSWORD!, 12);
    await prisma.user.createMany({
      data: [
        { name: 'Demo Customer', email: 'customer@monoprix.demo', passwordHash, role: 'CUSTOMER', phone: '+232-99-123456' },
        { name: 'Demo Admin', email: 'admin@monoprix.demo', passwordHash, role: 'ADMIN', phone: '+232-99-654321' },
        { name: 'Demo Staff', email: 'staff@monoprix.demo', passwordHash, role: 'STAFF', phone: '+232-99-111111' },
      ],
      skipDuplicates: true,
    });
    const demoUsers = await prisma.user.findMany({
      where: { email: { in: ['customer@monoprix.demo', 'admin@monoprix.demo', 'staff@monoprix.demo'] } },
      select: { id: true, email: true },
    });
    await prisma.cart.createMany({
      data: demoUsers.map((user) => ({ userId: user.id })),
      skipDuplicates: true,
    });

    await prisma.category.createMany({
      data: categories.map((category) => ({
        name: category.name,
        slug: category.slug,
        description: category.description,
        active: true,
        imageUrl: category.imageUrl,
      })),
      skipDuplicates: true,
    });

    const categoryRows = await prisma.category.findMany({
      where: { slug: { in: categories.map((category) => category.slug) } },
      select: { id: true, slug: true },
    });
    const categoryMap = new Map(categoryRows.map((category) => [category.slug, category.id]));
    const customer = demoUsers.find((user) => user.email === 'customer@monoprix.demo');
    if (customer && !await prisma.address.findFirst({ where: { userId: customer.id, label: 'Home' } })) {
      await prisma.address.create({
        data: {
          userId: customer.id,
          label: 'Home',
          street: '5 Wilkinson Road',
          area: 'Central Freetown',
          city: 'Freetown',
          country: 'Sierra Leone',
          instructions: 'Call before arrival if the gate is closed',
        },
      });
    }

    for (const product of productCatalog) {
      if (await prisma.product.findUnique({ where: { sku: product.sku }, select: { id: true } })) continue;
      const categoryId = categoryMap.get(product.categorySlug);
      if (!categoryId) continue;

      await prisma.product.create({
        data: {
          sku: product.sku,
          name: product.name,
          slug: product.slug,
          description: product.description,
          categoryId,
          price: String(product.price),
          compareAtPrice: product.compareAtPrice ? String(product.compareAtPrice) : null,
          stock: product.stock,
          isActive: product.isActive,
          imageUrl: product.imageUrl,
          thumbnailUrl: product.imageUrl,
          altText: product.altText,
          imageSource: product.imageSource,
          sourcePageUrl: product.sourcePageUrl,
          license: product.license,
          attribution: product.attribution,
          cloudinaryPublicId: product.cloudinaryPublicId ?? null,
          reviewedAt: product.reviewedAt ?? new Date(),
          imageStatus: product.imageStatus,
        },
      });
    }

    if (!await prisma.auditLog.findFirst({ where: { action: 'SEED_DEMO_DATA', entity: 'SYSTEM' } })) {
      await prisma.auditLog.create({
        data: {
          action: 'SEED_DEMO_DATA',
          entity: 'SYSTEM',
          details: 'Initialized Monoprix demo catalogue and user accounts',
        },
      });
    }

    console.log('Demo data created where records did not already exist. Existing records were not updated or deleted.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Demo seed refused or failed:', error);
  process.exitCode = 1;
});
