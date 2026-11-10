import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { parseQuery } from '../lib/validation.js';

const router = Router();
const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(80).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  sort: z.enum(['newest', 'price-asc', 'price-desc', 'name']).default('newest'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});

const categorySlugGroups: Record<string, string[]> = {
  'fruits-vegetables': ['fruits-vegetables', 'fresh-produce'],
  'food-groceries': ['food-groceries', 'rice-and-grains', 'cooking-oils', 'cereal', 'bakery', 'frozen-foods'],
  beverages: ['beverages'],
  'snacks-confectionery': ['snacks-confectionery', 'snacks'],
  'dairy-eggs': ['dairy-eggs', 'dairy'],
  'personal-care': ['personal-care'],
  'household-cleaning': ['household-cleaning', 'household'],
  'baby-products': ['baby-products'],
};

function productJson(product: any) {
  const imageIsApproved = product.imageStatus === 'APPROVED';
  const variants = Array.isArray(product.variants)
    ? product.variants.map((variant: any) => ({
      ...variant,
      quantity: variant.quantity.toString(),
      price: variant.price.toString(),
    }))
    : undefined;
  const defaultVariant = variants?.find((variant: any) => variant.isDefault && variant.isActive);
  return {
    ...product,
    ...(variants ? {
      variants,
      ...(defaultVariant ? {
        price: defaultVariant.price,
        stock: defaultVariant.stock,
        sku: defaultVariant.sku,
      } : {}),
    } : {}),
    ...(product.productImages ? {
      productImages: product.productImages.map((image: any) => ({
        ...image,
        imageUrl: imageIsApproved ? image.imageUrl : '/api/v1/assets/product/placeholder.svg',
        altText: imageIsApproved ? image.altText : `${product.name}; approved product image needed`,
      })),
    } : {}),
    category: product.category ?? { id: '', name: 'Uncategorized', slug: '' },
    imageUrl: imageIsApproved ? product.imageUrl : '/api/v1/assets/product/placeholder.svg',
    thumbnailUrl: imageIsApproved ? product.thumbnailUrl : '/api/v1/assets/product/placeholder.svg',
    altText: imageIsApproved ? product.altText : `${product.name}; approved product image needed`,
    price: (defaultVariant?.price ?? product.price).toString(),
    compareAtPrice: product.compareAtPrice?.toString() ?? null,
  };
}

router.get('/categories', asyncHandler(async (_req, res) => {
  const categories = await prisma.category.findMany({
    where: { active: true },
    select: { id: true, name: true, slug: true, description: true, imageUrl: true },
    orderBy: { name: 'asc' },
  });
  res.json({ data: { categories } });
}));

router.get('/products', asyncHandler(async (req, res) => {
  const query = parseQuery(listQuerySchema, req);
  const categorySlugs = query.category
    ? categorySlugGroups[query.category] ?? [query.category]
    : undefined;
  const where = {
    isActive: true,
    ...(query.q ? { OR: [{ name: { contains: query.q } }, { brand: { contains: query.q } }, { description: { contains: query.q } }, { sku: { contains: query.q } }] } : {}),
    ...(categorySlugs ? { category: { slug: { in: categorySlugs } } } : {}),
    ...(query.minPrice !== undefined || query.maxPrice !== undefined ? {
      variants: {
        some: {
          isActive: true,
          price: {
            ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
            ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
          },
        },
      },
    } : {}),
  };
  const orderBy = query.sort === 'price-asc' ? { price: 'asc' as const }
    : query.sort === 'price-desc' ? { price: 'desc' as const }
      : query.sort === 'name' ? { name: 'asc' as const }
        : { createdAt: 'desc' as const };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        category: { select: { id: true, name: true, slug: true } },
        variants: { where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
      },
      orderBy,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.product.count({ where }),
  ]);
  res.json({
    data: {
      products: products.map(productJson),
      pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) },
    },
  });
}));

router.get('/products/slug/:slug', asyncHandler(async (req, res) => {
  const slug = Array.isArray(req.params.slug) ? req.params.slug[0] ?? '' : req.params.slug ?? '';
  const product = await prisma.product.findFirst({
    where: { slug, isActive: true },
    include: {
      category: { select: { id: true, name: true, slug: true } },
      productImages: { orderBy: { order: 'asc' } },
      variants: { where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
    },
  });
  if (!product) throw new HttpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');
  res.json({ data: { product: productJson(product) } });
}));

router.get('/products/:id', asyncHandler(async (req, res) => {
  const productId = Array.isArray(req.params.id) ? req.params.id[0] ?? '' : req.params.id ?? '';
  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true },
    include: {
      category: { select: { id: true, name: true, slug: true } },
      variants: { where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
    },
  });
  if (!product) throw new HttpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');
  res.json({ data: { product: productJson(product) } });
}));

export default router;
