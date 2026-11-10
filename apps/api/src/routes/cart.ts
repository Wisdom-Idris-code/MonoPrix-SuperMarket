import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { parseBody } from '../lib/validation.js';

const router = Router();
router.use(requireAuth);

function getRouteParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

async function getOrCreateCart(userId: string) {
  return prisma.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
    include: {
      items: {
        include: {
          product: { include: { category: true } },
          variant: true,
        },
      },
    },
  });
}

function cartResponse(cart: Awaited<ReturnType<typeof getOrCreateCart>>) {
  const items = cart.items.map((item) => ({
    id: item.id,
    productId: item.productId,
    variantId: item.variantId,
    name: item.product.name,
    slug: item.product.slug,
    variantName: item.variant.name,
    variantQuantity: item.variant.quantity.toString(),
    variantUnit: item.variant.unit,
    sku: item.variant.sku,
    price: item.variant.price.toString(),
    quantity: item.quantity,
    stock: item.variant.stock,
    imageUrl: item.product.imageStatus === 'APPROVED'
      ? item.product.imageUrl
      : '/api/v1/assets/product/placeholder.svg',
    altText: item.product.imageStatus === 'APPROVED'
      ? item.product.altText
      : `${item.product.name}; approved product image needed`,
    category: item.product.category?.name ?? 'Uncategorized',
  }));
  return {
    items,
    subtotal: items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0).toFixed(2),
  };
}

router.get('/', asyncHandler(async (req, res) => {
  res.json({ data: { cart: cartResponse(await getOrCreateCart(req.user!.id)) } });
}));

router.post('/items', asyncHandler(async (req, res) => {
  const input = parseBody(z.object({
    productId: z.string().min(1),
    variantId: z.string().min(1).optional(),
    quantity: z.number().int().positive().max(100),
  }), req);
  const product = await prisma.product.findFirst({ where: { id: input.productId, isActive: true } });
  if (!product) throw new HttpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');
  const variant = await prisma.productVariant.findFirst({
    where: {
      productId: product.id,
      isActive: true,
      ...(input.variantId ? { id: input.variantId } : { isDefault: true }),
    },
  });
  if (!variant) throw new HttpError(404, 'Product package is no longer available.', 'VARIANT_NOT_FOUND');
  const cart = await getOrCreateCart(req.user!.id);
  const existing = cart.items.find((item) => item.variantId === variant.id);
  const totalQuantity = (existing?.quantity ?? 0) + input.quantity;
  if (totalQuantity > variant.stock) {
    throw new HttpError(409, `Only ${variant.stock} ${product.name} (${variant.name}) available.`, 'INSUFFICIENT_STOCK');
  }
  await prisma.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
    create: { cartId: cart.id, productId: product.id, variantId: variant.id, quantity: input.quantity },
    update: { quantity: totalQuantity },
  });
  res.status(201).json({ data: { cart: cartResponse(await getOrCreateCart(req.user!.id)) } });
}));

router.patch('/items/:itemId', asyncHandler(async (req, res) => {
  const { quantity } = parseBody(z.object({ quantity: z.number().int().min(0).max(100) }), req);
  const itemId = getRouteParam(req.params.itemId);
  const item = await prisma.cartItem.findFirst({
    where: { id: itemId, cart: { userId: req.user!.id } },
    include: { variant: true, product: true },
  });
  if (!item) throw new HttpError(404, 'Cart item not found.', 'CART_ITEM_NOT_FOUND');
  if (quantity > item.variant.stock) {
    throw new HttpError(409, `Only ${item.variant.stock} ${item.product.name} (${item.variant.name}) available.`, 'INSUFFICIENT_STOCK');
  }
  if (quantity === 0) await prisma.cartItem.delete({ where: { id: item.id } });
  else await prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
  res.json({ data: { cart: cartResponse(await getOrCreateCart(req.user!.id)) } });
}));

router.delete('/items/:itemId', asyncHandler(async (req, res) => {
  const itemId = getRouteParam(req.params.itemId);
  const deleted = await prisma.cartItem.deleteMany({
    where: { id: itemId, cart: { userId: req.user!.id } },
  });
  if (!deleted.count) throw new HttpError(404, 'Cart item not found.', 'CART_ITEM_NOT_FOUND');
  res.json({ data: { cart: cartResponse(await getOrCreateCart(req.user!.id)) } });
}));

router.post('/merge', asyncHandler(async (req, res) => {
  const { items } = parseBody(z.object({
    items: z.array(z.object({
      productId: z.string().min(1),
      variantId: z.string().min(1).optional(),
      quantity: z.number().int().positive().max(100),
    })).max(60),
  }), req);
  const cart = await getOrCreateCart(req.user!.id);
  await prisma.$transaction(async (transaction) => {
    for (const guestItem of items) {
      const product = await transaction.product.findFirst({
        where: { id: guestItem.productId, isActive: true },
        include: { variants: { where: { isActive: true, ...(guestItem.variantId ? { id: guestItem.variantId } : { isDefault: true }) } } },
      });
      if (!product) continue;
      const variant = product.variants[0];
      if (!variant) continue;
      const existing = await transaction.cartItem.findUnique({ where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } } });
      const quantity = (existing?.quantity ?? 0) + guestItem.quantity;
      if (quantity > variant.stock) {
        throw new HttpError(409, `Only ${variant.stock} ${product.name} (${variant.name}) available.`, 'INSUFFICIENT_STOCK');
      }
      await transaction.cartItem.upsert({
        where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
        create: { cartId: cart.id, productId: product.id, variantId: variant.id, quantity: guestItem.quantity },
        update: { quantity },
      });
    }
  });
  res.json({ data: { cart: cartResponse(await getOrCreateCart(req.user!.id)) } });
}));

export default router;
