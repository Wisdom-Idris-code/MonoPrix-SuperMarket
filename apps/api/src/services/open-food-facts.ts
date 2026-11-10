import { config } from '../lib/config.js';
import { HttpError } from '../lib/errors.js';

export type OpenFoodFactsPreview = {
  barcode: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  sourcePageUrl: string;
  license: string;
  attribution: string;
  ingredients: string | null;
};

export async function previewOpenFoodFactsProduct(barcode: string): Promise<OpenFoodFactsPreview> {
  const response = await fetch(
    `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(barcode)}.json?fields=code,product_name,brands,image_url,image_front_url,ingredients_text`,
    {
      headers: { 'User-Agent': config.OPEN_FOOD_FACTS_USER_AGENT },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) {
    throw new HttpError(502, 'Open Food Facts is temporarily unavailable.', 'PRODUCT_SOURCE_UNAVAILABLE');
  }

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') {
    throw new HttpError(502, 'Open Food Facts returned an invalid response.', 'INVALID_PRODUCT_SOURCE_RESPONSE');
  }

  const data = payload as {
    status?: number;
    product?: {
      code?: string;
      product_name?: string;
      brands?: string;
      image_url?: string;
      image_front_url?: string;
      ingredients_text?: string;
    };
  };
  const product = data.product;
  if (data.status !== 1 || !product?.product_name) {
    throw new HttpError(404, 'No product with a verified name was found for this barcode.', 'PRODUCT_NOT_FOUND');
  }

  return {
    barcode: product.code ?? barcode,
    name: product.product_name,
    brand: product.brands ?? null,
    imageUrl: product.image_front_url ?? product.image_url ?? null,
    sourcePageUrl: `https://world.openfoodfacts.org/product/${encodeURIComponent(product.code ?? barcode)}`,
    license: 'Open Food Facts database: ODbL; image licensing must be verified per image (typically CC BY-SA).',
    attribution: 'Product data from Open Food Facts; verify image attribution and license before use.',
    ingredients: product.ingredients_text ?? null,
  };
}
