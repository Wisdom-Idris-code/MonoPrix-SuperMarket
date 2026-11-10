import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { hasPermission, requireAuth, requirePermission } from '../lib/auth.js';
import { prisma } from '../lib/db.js';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { parseBody } from '../lib/validation.js';
import { updateOrderStatus } from '../services/order-service.js';
import { cloudinaryDeliveryUrls, uploadImageToCloudinary } from '../services/cloudinary.js';
import { imageUpload, validateImageSignature } from '../lib/image-upload.js';
import { previewOpenFoodFactsProduct } from '../services/open-food-facts.js';

const router = Router();
router.use(requireAuth);

function getSingleStringQuery(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0].trim() || undefined : undefined;
  }
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }
  return undefined;
}

function getBooleanQuery(value: unknown, fallback = false): boolean {
  if (typeof value === 'string') return value === 'true' ? true : value === 'false' ? false : fallback;
  return fallback;
}

function getRouteParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

router.get('/dashboard', requirePermission('dashboard:read'), asyncHandler(async (_req, res) => {
  const [totalOrders, sales, pendingOrders, completedOrders, lowStockVariants, recentOrders] = await Promise.all([
    prisma.order.count(),
    prisma.order.aggregate({ where: { paymentStatus: 'PAID' }, _sum: { total: true } }),
    prisma.order.count({ where: { status: { in: ['PENDING', 'CONFIRMED', 'PROCESSING'] } } }),
    prisma.order.count({ where: { status: 'DELIVERED' } }),
    prisma.productVariant.findMany({
      where: { isActive: true, product: { isActive: true }, stock: { lte: 10 } },
      include: { product: { select: { name: true } } },
      orderBy: { stock: 'asc' },
      take: 10,
    }),
    prisma.order.findMany({ include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: 8 }),
  ]);
  res.json({
    data: {
      totalOrders,
      totalSales: sales._sum.total?.toString() ?? '0.00',
      pendingOrders,
      completedOrders,
      lowStockProducts: lowStockVariants.map((variant) => ({
        id: variant.id,
        name: `${variant.product.name} · ${variant.name}`,
        stock: variant.stock,
      })),
      recentOrders: recentOrders.map((order) => ({
        id: order.id,
        customer: order.customerName,
        total: order.total.toString(),
        status: order.status,
        createdAt: order.createdAt,
      })),
      demoDataLabel: 'Live figures from the marketplace database',
    },
  });
}));

router.get('/products', requirePermission('catalog:read'), asyncHandler(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const active = req.query.active === 'all' ? undefined : req.query.active !== 'false';
  const products = await prisma.product.findMany({
    where: {
      ...(active !== undefined ? { isActive: active } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { brand: { contains: q } }, { sku: { contains: q } }] } : {}),
    },
    include: {
      category: { select: { id: true, name: true, slug: true } },
      variants: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  res.json({ data: { products } });
}));

router.get('/categories', requirePermission('categories:read'), asyncHandler(async (_req, res) => {
  const categories = await prisma.category.findMany({
    include: { _count: { select: { products: true } } },
    orderBy: { name: 'asc' },
  });
  res.json({ data: { categories } });
}));

const categorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  imageUrl: z.string().url().optional(),
  active: z.boolean().optional(),
});

router.post('/categories', requirePermission('categories:manage'), asyncHandler(async (req, res) => {
  const input = parseBody(categorySchema, req);
  const slugBase = productSlug(input.name);
  const category = await prisma.$transaction(async (transaction) => {
    const created = await transaction.category.create({
      data: { ...input, slug: `${slugBase}-${Math.random().toString(36).slice(2, 7)}` },
    });
    await transaction.auditLog.create({
      data: { userId: req.user!.id, action: 'CATEGORY_CREATED', entity: 'Category', details: `Created category ${created.slug}` },
    });
    return created;
  });
  res.status(201).json({ data: { category } });
}));

router.patch('/categories/:id', requirePermission('categories:manage'), asyncHandler(async (req, res) => {
  const input = parseBody(categorySchema.partial(), req);
  const categoryId = getRouteParam(req.params.id);
  const category = await prisma.$transaction(async (transaction) => {
    const updated = await transaction.category.update({
      where: { id: categoryId },
      data: input,
    }).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'P2025') {
        throw new HttpError(404, 'Category not found.', 'CATEGORY_NOT_FOUND');
      }
      throw error;
    });
    await transaction.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'CATEGORY_UPDATED',
        entity: 'Category',
        details: `Updated category ${updated.slug}; fields: ${Object.keys(input).join(', ')}`,
      },
    });
    return updated;
  });
  res.json({ data: { category } });
}));

const productVariantSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(100),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/).refine((value) => Number(value) > 0),
  unit: z.string().trim().min(1).max(40),
  sku: z.string().trim().min(2).max(50),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/),
  stock: z.number().int().min(0).max(100000),
  isActive: z.boolean(),
  isDefault: z.boolean(),
});

const productVariantsSchema = z.array(productVariantSchema).min(1).max(50).superRefine((variants, context) => {
  const activeDefaults = variants.filter((variant) => variant.isActive && variant.isDefault);
  if (activeDefaults.length !== 1) {
    context.addIssue({ code: 'custom', message: 'Exactly one active default variant is required.', path: [] });
  }
  if (new Set(variants.map((variant) => variant.sku)).size !== variants.length) {
    context.addIssue({ code: 'custom', message: 'Variant SKUs must be unique.', path: [] });
  }
  const ids = variants.flatMap((variant) => variant.id ? [variant.id] : []);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message: 'A variant may appear only once.', path: [] });
  }
});

const productSchema = z.object({
  sku: z.string().trim().min(2).max(50),
  name: z.string().trim().min(2).max(160),
  brand: z.string().trim().max(100).nullable().optional(),
  description: z.string().trim().min(5).max(3000),
  categoryId: z.string().min(1),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/),
  stock: z.number().int().min(0).max(100000),
  imageUrl: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  altText: z.string().trim().min(3).max(250),
  imageSource: z.string().trim().min(3).max(150),
  sourcePageUrl: z.string().url().optional(),
  license: z.string().trim().min(3).max(500),
  attribution: z.string().trim().max(500).optional(),
  cloudinaryPublicId: z.string().trim().max(200).optional(),
  reviewedAt: z.string().datetime().optional(),
  imageStatus: z.enum(['APPROVED', 'NEEDS_IMAGE', 'NEEDS_REVIEW']).default('NEEDS_REVIEW'),
  variants: productVariantsSchema.optional(),
});

function productSlug(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

router.post('/products', requirePermission('catalog:write'), asyncHandler(async (req, res) => {
  const input = parseBody(productSchema.superRefine((value, context) => {
    if (value.imageStatus === 'APPROVED' && value.reviewedAt === undefined) {
      context.addIssue({ code: 'custom', message: 'An approval timestamp is required when approving a product image.', path: ['reviewedAt'] });
    }
    if (value.variants?.some((variant) => variant.id)) {
      context.addIssue({ code: 'custom', message: 'New products cannot reference existing variants.', path: ['variants'] });
    }
    if (value.variants && value.variants.find((variant) => variant.isDefault)?.sku !== value.sku) {
      const defaultVariant = value.variants.find((variant) => variant.isDefault);
      if (defaultVariant?.sku !== value.sku) context.addIssue({ code: 'custom', message: 'The default variant SKU must match the product SKU.', path: ['sku'] });
    }
  }), req);
  const category = await prisma.category.findUnique({ where: { id: input.categoryId } });
  if (!category) throw new HttpError(400, 'Select an existing category.', 'INVALID_CATEGORY');
  const slugBase = productSlug(input.name);
  const slug = `${slugBase}-${Math.random().toString(36).slice(2, 7)}`;
  const imageUrls = input.cloudinaryPublicId ? cloudinaryDeliveryUrls(input.cloudinaryPublicId) : {
    imageUrl: input.imageUrl,
    thumbnailUrl: input.thumbnailUrl ?? input.imageUrl,
  };
  const { variants: inputVariants, ...productFields } = input;
  const variants = inputVariants ?? [{
    name: 'Standard',
    quantity: '1',
    unit: 'item',
    sku: input.sku,
    price: input.price,
    stock: input.stock,
    isActive: true,
    isDefault: true,
  }];
  const defaultVariant = variants.find((variant) => variant.isDefault)!;
  const product = await prisma.$transaction(async (transaction) => {
    const created = await transaction.product.create({
      data: {
        ...productFields,
        slug,
        price: new Prisma.Decimal(defaultVariant.price),
        stock: defaultVariant.stock,
        ...imageUrls,
        reviewedAt: input.reviewedAt ? new Date(input.reviewedAt) : null,
        isActive: true,
        variants: {
          create: variants.map((variant) => ({
            name: variant.name,
            quantity: new Prisma.Decimal(variant.quantity),
            unit: variant.unit,
            sku: variant.sku,
            price: new Prisma.Decimal(variant.price),
            stock: variant.stock,
            isActive: variant.isActive,
            isDefault: variant.isDefault,
          })),
        },
        include: { variants: true },
        productImages: {
          create: {
            imageUrl: imageUrls.imageUrl,
            altText: input.altText,
            isPrimary: true,
            order: 0,
          },
        },
      },
    });
    for (const variant of variants.filter((item) => item.stock > 0)) {
      await transaction.inventoryMovement.create({
        data: {
          productId: created.id,
          variantId: created.variants?.find((createdVariant: { sku: string }) => createdVariant.sku === variant.sku)?.id,
          type: 'INITIAL_STOCK',
          quantity: variant.stock,
          reason: `Opening inventory for ${variant.name}`,
        },
      });
    }
    await transaction.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'PRODUCT_CREATED',
        entity: 'Product',
        details: `Created SKU ${created.sku}; variants: ${variants.map((variant) => `${variant.sku} (${variant.stock})`).join(', ')}`,
      },
    });
    return created;
  });
  res.status(201).json({ data: { product } });
}));

router.patch('/products/:id', requirePermission('catalog:write'), asyncHandler(async (req, res) => {
  const input = parseBody(productSchema.partial().extend({ isActive: z.boolean().optional() }).superRefine((value, context) => {
    if (value.variants && value.sku) {
      const defaultVariant = value.variants.find((variant) => variant.isDefault);
      if (defaultVariant?.sku !== value.sku) {
        context.addIssue({ code: 'custom', message: 'The default variant SKU must match the product SKU.', path: ['sku'] });
      }
    }
  }), req);
  if (input.isActive !== undefined && !hasPermission(req.user!.role, 'catalog:archive')) {
    throw new HttpError(403, 'Only administrators can archive or restore products.', 'FORBIDDEN');
  }
  const productId = getRouteParam(req.params.id);
  if (input.categoryId) {
    const category = await prisma.category.findUnique({ where: { id: input.categoryId } });
    if (!category) throw new HttpError(400, 'Select an existing category.', 'INVALID_CATEGORY');
  }
  const before = await prisma.product.findUnique({ where: { id: productId }, include: { variants: true } });
  if (!before) throw new HttpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');
  const imageUpdated = input.imageUrl !== undefined || input.cloudinaryPublicId !== undefined;
  const productChanges = {
    ...input,
    ...(imageUpdated && input.imageStatus === undefined ? { imageStatus: 'NEEDS_REVIEW' as const } : {}),
  };
  if (productChanges.imageStatus === 'APPROVED' && !productChanges.reviewedAt && before.imageStatus !== 'APPROVED') {
    throw new HttpError(400, 'An approval timestamp is required when approving a product image.', 'IMAGE_REVIEW_REQUIRED');
  }
  const imageUrls = input.cloudinaryPublicId ? cloudinaryDeliveryUrls(input.cloudinaryPublicId) : null;
  const product = await prisma.$transaction(async (transaction) => {
    const { price, stock, reviewedAt, variants: requestedVariants, ...rest } = productChanges;
    const existingVariants = before.variants ?? [];
    let defaultVariant = existingVariants.find((variant: { isDefault: boolean }) => variant.isDefault);

    if (requestedVariants) {
      const existingIds = new Set(existingVariants.map((variant: { id: string }) => variant.id));
      if (requestedVariants.some((variant) => variant.id && !existingIds.has(variant.id))) {
        throw new HttpError(400, 'A variant does not belong to this product.', 'INVALID_VARIANT');
      }
      await transaction.productVariant.updateMany({
        where: { productId, isDefault: true },
        data: { isDefault: false },
      });
      const submittedIds = new Set(requestedVariants.flatMap((variant) => variant.id ? [variant.id] : []));
      for (const variant of requestedVariants) {
        const variantData = {
          name: variant.name,
          quantity: new Prisma.Decimal(variant.quantity),
          unit: variant.unit,
          sku: variant.sku,
          price: new Prisma.Decimal(variant.price),
          stock: variant.stock,
          isActive: variant.isActive,
          isDefault: variant.isDefault,
        };
        if (variant.id) {
          const previous = existingVariants.find((entry: { id: string }) => entry.id === variant.id)!;
          await transaction.productVariant.update({ where: { id: variant.id }, data: variantData });
          if (previous.stock !== variant.stock) {
            await transaction.inventoryMovement.create({
              data: {
                productId,
                variantId: variant.id,
                type: 'ADMIN_ADJUSTMENT',
                quantity: variant.stock - previous.stock,
                reason: 'Stock changed during product variant update',
                reference: 'product-edit',
              },
            });
          }
        } else {
          const createdVariant = await transaction.productVariant.create({
            data: { ...variantData, productId },
          });
          if (variant.stock > 0) {
            await transaction.inventoryMovement.create({
              data: {
                productId,
                variantId: createdVariant.id,
                type: 'INITIAL_STOCK',
                quantity: variant.stock,
                reason: `Opening inventory for ${variant.name}`,
              },
            });
          }
        }
      }
      const omittedIds = existingVariants.flatMap((variant: { id: string }) => submittedIds.has(variant.id) ? [] : [variant.id]);
      if (omittedIds.length) {
        await transaction.productVariant.updateMany({
          where: { id: { in: omittedIds }, productId },
          data: { isActive: false, isDefault: false },
        });
      }
    } else if (defaultVariant && (price !== undefined || stock !== undefined || input.sku !== undefined)) {
      const nextPrice = price !== undefined ? new Prisma.Decimal(price) : defaultVariant.price;
      const nextStock = stock !== undefined ? stock : defaultVariant.stock;
      const nextSku = input.sku ?? defaultVariant.sku;
      await transaction.productVariant.update({
        where: { id: defaultVariant.id },
        data: { price: nextPrice, stock: nextStock, sku: nextSku },
      });
      if (nextStock !== defaultVariant.stock) {
        await transaction.inventoryMovement.create({
          data: {
            productId,
            variantId: defaultVariant.id,
            type: 'ADMIN_ADJUSTMENT',
            quantity: nextStock - defaultVariant.stock,
            reason: 'Stock changed during product update',
            reference: 'product-edit',
          },
        });
      }
    }

    const defaultPrice = requestedVariants
      ? new Prisma.Decimal(requestedVariants.find((variant) => variant.isDefault)!.price)
      : price !== undefined ? new Prisma.Decimal(price) : defaultVariant?.price;
    const defaultStock = requestedVariants
      ? requestedVariants.find((variant) => variant.isDefault)!.stock
      : stock ?? defaultVariant?.stock;
    const defaultSku = requestedVariants
      ? requestedVariants.find((variant) => variant.isDefault)!.sku
      : input.sku ?? defaultVariant?.sku;
    const updated = await transaction.product.update({
      where: { id: productId },
      data: {
        ...rest,
        ...(defaultPrice !== undefined ? { price: defaultPrice } : {}),
        ...(defaultStock !== undefined ? { stock: defaultStock } : {}),
        ...(defaultSku !== undefined ? { sku: defaultSku } : {}),
        ...(reviewedAt !== undefined ? { reviewedAt: reviewedAt ? new Date(reviewedAt) : null } : {}),
        ...(imageUrls ? imageUrls : {}),
      },
      include: { variants: true },
    });
    if (imageUrls && input.altText) {
      await transaction.productImage.updateMany({
        where: { productId: updated.id, isPrimary: true },
        data: { imageUrl: imageUrls.imageUrl, altText: input.altText },
      });
    }
    const changedFields = Object.keys(productChanges);
    const action = productChanges.isActive === false && before.isActive
      ? 'PRODUCT_ARCHIVED'
      : productChanges.isActive === true && !before.isActive
        ? 'PRODUCT_RESTORED'
        : productChanges.imageStatus === 'APPROVED' && before.imageStatus !== 'APPROVED'
          ? 'PRODUCT_IMAGE_APPROVED'
          : 'PRODUCT_UPDATED';
    await transaction.auditLog.create({
      data: {
        userId: req.user!.id,
        action,
        entity: 'Product',
        details: `Updated SKU ${updated.sku}; fields: ${changedFields.join(', ')}`,
      },
    });
    return updated;
  });
  res.json({ data: { product } });
}));

router.delete('/products/:id', requirePermission('catalog:archive'), asyncHandler(async (req, res) => {
  const productId = getRouteParam(req.params.id);
  const product = await prisma.$transaction(async (transaction) => {
    const archived = await transaction.product.update({
      where: { id: productId },
      data: { isActive: false },
    }).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'P2025') {
        throw new HttpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');
      }
      throw error;
    });
    await transaction.auditLog.create({
      data: { userId: req.user!.id, action: 'PRODUCT_ARCHIVED', entity: 'Product', details: `Archived SKU ${archived.sku}` },
    });
    return archived;
  });
  res.json({ data: { archived: true } });
}));

router.get('/orders', requirePermission('orders:read'), asyncHandler(async (req, res) => {
  const status = getSingleStringQuery(req.query.status);
  const q = getSingleStringQuery(req.query.q)?.slice(0, 100) ?? '';
  const orders = await prisma.order.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(q ? { OR: [{ id: { contains: q } }, { customerName: { contains: q } }, { phone: { contains: q } }] } : {}),
    },
    include: { items: true, user: { select: { name: true, email: true, phone: true } }, delivery: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ data: { orders } });
}));

router.patch('/orders/:id/status', requirePermission('orders:update'), asyncHandler(async (req, res) => {
  const { status } = parseBody(z.object({
    status: z.enum(['PENDING', 'CONFIRMED', 'PROCESSING', 'READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']),
  }), req);
  if (status === 'CANCELLED' && !hasPermission(req.user!.role, 'orders:cancel')) {
    throw new HttpError(403, 'Only administrators can cancel orders.', 'FORBIDDEN');
  }
  const orderId = getRouteParam(req.params.id);
  const order = await updateOrderStatus(orderId, status, req.user!.id);
  res.json({ data: { order } });
}));

router.get('/inventory', requirePermission('inventory:read'), asyncHandler(async (req, res) => {
  const lowStock = getBooleanQuery(req.query.lowStock, false);
  const variants = await prisma.productVariant.findMany({
    where: {
      isActive: true,
      product: { isActive: true },
      ...(lowStock ? { stock: { lte: 10 } } : {}),
    },
    include: { product: { select: { id: true, name: true, category: { select: { name: true } } } } },
    orderBy: { stock: 'asc' },
    take: 200,
  });
  res.json({
    data: {
      products: variants.map((variant) => ({
        id: variant.id,
        variantId: variant.id,
        productId: variant.productId,
        sku: variant.sku,
        name: variant.product.name,
        variantName: variant.name,
        quantity: variant.quantity.toString(),
        unit: variant.unit,
        stock: variant.stock,
        category: variant.product.category,
      })),
    },
  });
}));

router.get('/inventory/movements', requirePermission('inventory:read'), asyncHandler(async (req, res) => {
  const productId = getSingleStringQuery(req.query.productId);
  const variantId = getSingleStringQuery(req.query.variantId);
  const movements = await prisma.inventoryMovement.findMany({
    where: { ...(productId ? { productId } : {}), ...(variantId ? { variantId } : {}) },
    include: {
      product: { select: { id: true, sku: true, name: true } },
      variant: { select: { id: true, sku: true, name: true, quantity: true, unit: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json({ data: { movements } });
}));

router.post('/inventory/adjustments', requirePermission('inventory:manage'), asyncHandler(async (req, res) => {
  const { productId, variantId, quantity, reason } = parseBody(z.object({
    productId: z.string().min(1).optional(),
    variantId: z.string().min(1).optional(),
    quantity: z.number().int().min(-100000).max(100000).refine((value) => value !== 0),
    reason: z.string().trim().min(3).max(300),
  }).refine((value) => value.productId || value.variantId, {
    message: 'Select a product variant.',
    path: ['variantId'],
  }), req);
  const result = await prisma.$transaction(async (transaction) => {
    const variant = await transaction.productVariant.findFirst({
      where: variantId
        ? { id: variantId, ...(productId ? { productId } : {}) }
        : { productId, isDefault: true },
    });
    if (!variant) throw new HttpError(404, 'Product variant not found.', 'VARIANT_NOT_FOUND');
    const changed = await transaction.productVariant.updateMany({
      where: { id: variant.id, ...(quantity < 0 ? { stock: { gte: Math.abs(quantity) } } : {}) },
      data: { stock: { increment: quantity } },
    });
    if (changed.count !== 1) {
      throw new HttpError(409, 'Adjustment would make stock negative.', 'NEGATIVE_INVENTORY');
    }
    if (variant.isDefault) {
      await transaction.product.update({
        where: { id: variant.productId },
        data: { stock: { increment: quantity } },
      });
    }
    const movement = await transaction.inventoryMovement.create({
      data: { productId: variant.productId, variantId: variant.id, type: 'MANUAL_ADJUSTMENT', quantity, reason },
    });
    const product = await transaction.product.findUniqueOrThrow({ where: { id: variant.productId } });
    await transaction.auditLog.create({
      data: { userId: req.user!.id, action: 'INVENTORY_ADJUSTED', entity: 'ProductVariant', details: `${variant.sku} (${product.name} · ${variant.name}): ${quantity} units; ${reason}` },
    });
    return { product, variant: { ...variant, stock: variant.stock + quantity }, movement };
  });
  res.status(201).json({ data: result });
}));

router.post('/images/upload', requirePermission('media:manage'), imageUpload.single('file'), asyncHandler(async (req, res) => {
  const { folder } = parseBody(z.object({
    folder: z.enum(['monoprix/products', 'monoprix/categories']),
  }), req);
  if (!req.file) throw new HttpError(400, 'Choose an image to upload.', 'IMAGE_REQUIRED');
  validateImageSignature(req.file.mimetype, req.file.buffer);
  const upload = await uploadImageToCloudinary(req.file, folder);
  await prisma.auditLog.create({
    data: {
      userId: req.user!.id,
      action: 'IMAGE_UPLOADED',
      entity: 'ProductImage',
      details: `${upload.publicId} uploaded to ${folder}`,
    },
  });
  res.status(201).json({ data: { upload } });
}));

router.post('/orders/:id/refund-authorizations', requirePermission('refunds:authorize'), asyncHandler(async (req, res) => {
  const { reason } = parseBody(z.object({ reason: z.string().trim().min(5).max(500) }), req);
  const orderId = getRouteParam(req.params.id);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payment: true },
  });
  if (!order) throw new HttpError(404, 'Order not found.', 'ORDER_NOT_FOUND');
  if (order.paymentStatus !== 'PAID' || !order.payment || order.payment.status !== 'PAID') {
    throw new HttpError(409, 'Only paid orders can be authorized for a refund.', 'REFUND_NOT_AVAILABLE');
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.paymentEvent.create({
      data: {
        paymentId: order.payment!.id,
        provider: order.payment!.provider,
        eventId: `refund-auth-${randomUUID()}`,
        eventType: 'REFUND_AUTHORIZED',
        payload: JSON.stringify({ reason, authorizedBy: req.user!.id }),
      },
    });
    await transaction.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'REFUND_AUTHORIZED',
        entity: 'Order',
        details: `${orderId}: ${reason}`,
      },
    });
  });

  res.status(201).json({
    data: {
      authorized: true,
      processed: false,
      message: 'Refund authorization was recorded. No funds were transferred.',
    },
  });
}));

router.get('/users', requirePermission('users:manage'), asyncHandler(async (req, res) => {
  const q = getSingleStringQuery(req.query.q)?.slice(0, 100);
  const role = getSingleStringQuery(req.query.role);
  if (role && !['CUSTOMER', 'ADMIN', 'STAFF'].includes(role)) {
    throw new HttpError(400, 'Invalid user role filter.', 'VALIDATION_ERROR');
  }
  const users = await prisma.user.findMany({
    where: {
      ...(role ? { role } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {}),
    },
    select: { id: true, name: true, email: true, role: true, phone: true, isActive: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ data: { users } });
}));

const managedUserSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
  role: z.enum(['CUSTOMER', 'ADMIN', 'STAFF']),
  phone: z.string().trim().max(30).optional(),
});

router.post('/users', requirePermission('users:manage'), asyncHandler(async (req, res) => {
  const input = parseBody(managedUserSchema, req);
  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    const user = await prisma.$transaction(async (transaction) => {
      const created = await transaction.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash,
          role: input.role,
          phone: input.phone,
          cart: { create: {} },
        },
        select: { id: true, name: true, email: true, role: true, phone: true, isActive: true, createdAt: true },
      });
      await transaction.auditLog.create({
        data: { userId: req.user!.id, action: 'USER_CREATED', entity: 'User', details: `Created ${created.role} account ${created.id}` },
      });
      return created;
    });
    res.status(201).json({ data: { user } });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'P2002') {
      throw new HttpError(409, 'An account with this email already exists.', 'EMAIL_ALREADY_REGISTERED');
    }
    throw error;
  }
}));

router.patch('/users/:id', requirePermission('users:manage'), asyncHandler(async (req, res) => {
  const input = parseBody(z.object({
    name: z.string().trim().min(2).max(100).optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    role: z.enum(['CUSTOMER', 'ADMIN', 'STAFF']).optional(),
    isActive: z.boolean().optional(),
  }).refine((value) => Object.keys(value).length > 0), req);
  const userId = getRouteParam(req.params.id);
  if (userId === req.user!.id && (input.role !== undefined || input.isActive === false)) {
    throw new HttpError(409, 'You cannot change your own role or deactivate your own account.', 'SELF_ACCOUNT_CHANGE');
  }
  const updated = await prisma.$transaction(async (transaction) => {
    const user = await transaction.user.update({
      where: { id: userId },
      data: input,
      select: { id: true, name: true, email: true, role: true, phone: true, isActive: true, createdAt: true },
    }).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'P2025') {
        throw new HttpError(404, 'User not found.', 'USER_NOT_FOUND');
      }
      throw error;
    });
    await transaction.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'USER_UPDATED',
        entity: 'User',
        details: `Updated account ${user.id}; fields: ${Object.keys(input).join(', ')}`,
      },
    });
    return user;
  });
  res.json({ data: { user: updated } });
}));

router.get('/audit-logs', requirePermission('audit:read'), asyncHandler(async (req, res) => {
  const logs = await prisma.auditLog.findMany({
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json({ data: { logs } });
}));

router.post('/products/open-food-facts/preview', requirePermission('catalog:read'), asyncHandler(async (req, res) => {
  const { barcode } = parseBody(z.object({ barcode: z.string().regex(/^\d{8,14}$/) }), req);
  const product = await previewOpenFoodFactsProduct(barcode);
  res.json({
    data: {
      product,
      note: 'Preview only. Review and verify every field and the image license before creating a catalogue product.',
    },
  });
}));

export default router;
