import { useState } from 'react';
import { Link } from 'react-router-dom';
import { addCartProduct } from '../lib/cartSync';
import { formatSLE } from '../lib/store';

export type StoreVariant = {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  sku: string;
  price: string;
  stock: number;
  isActive: boolean;
  isDefault: boolean;
};

export type StoreProduct = {
  id: string;
  name: string;
  brand: string | null;
  slug: string;
  price: string;
  stock: number;
  sku?: string;
  imageUrl: string;
  altText: string;
  imageStatus: string;
  category: { name: string; slug?: string };
  variants?: StoreVariant[];
};

type Props = {
  product: StoreProduct;
  onNotice: (message: string) => void;
};

export function ProductCard({ product, onNotice }: Props) {
  const variants = product.variants?.length
    ? product.variants
    : [{
      id: product.id,
      name: 'Standard',
      quantity: '1',
      unit: 'item',
      sku: product.sku ?? '',
      price: product.price,
      stock: product.stock,
      isActive: true,
      isDefault: true,
    }];
  const [selectedVariantId, setSelectedVariantId] = useState(
    variants.find((variant) => variant.isDefault)?.id ?? variants[0].id,
  );
  const selectedVariant = variants.find((variant) => variant.id === selectedVariantId) ?? variants[0];

  async function add() {
    try {
      await addCartProduct({
        id: selectedVariant.id,
        productId: product.id,
        variantId: selectedVariant.id,
        variantName: selectedVariant.name,
        variantQuantity: selectedVariant.quantity,
        variantUnit: selectedVariant.unit,
        slug: product.slug,
        name: product.name,
        price: Number(selectedVariant.price),
        stock: selectedVariant.stock,
        imageUrl: product.imageUrl,
        altText: product.altText,
      });
      onNotice(`${product.name} (${selectedVariant.name}) added to cart.`);
    } catch (issue) {
      onNotice(issue instanceof Error ? issue.message : 'Could not add that item.');
    }
  }

  return (
    <article className="product-card">
      <Link to={`/products/${product.slug}`} className="product-image-wrap">
        <img
          src={product.imageUrl}
          alt={product.altText}
          width="600"
          height="600"
          loading="lazy"
          onError={(event) => { event.currentTarget.src = '/api/v1/assets/product/placeholder.svg'; }}
        />
        {product.imageStatus !== 'APPROVED' && <span className="image-status">Image needed</span>}
      </Link>
      <div className="product-category">{product.category.name}</div>
      {product.brand && <div className="product-brand">{product.brand}</div>}
      <Link to={`/products/${product.slug}`} className="product-name">{product.name}</Link>
      <label className="field product-option">
        <span>Package size</span>
        <select
          aria-label={`Package size for ${product.name}`}
          value={selectedVariant.id}
          onChange={(event) => setSelectedVariantId(event.target.value)}
        >
          {variants.map((variant) => (
            <option key={variant.id} value={variant.id} disabled={!variant.isActive}>
              {variant.name} · {variant.quantity} {variant.unit} — {formatSLE(variant.price)}
            </option>
          ))}
        </select>
      </label>
      <div className="product-meta">
        <span className="product-price">{formatSLE(selectedVariant.price)}</span>
        <span className={selectedVariant.stock > 0 ? 'stock-copy' : 'stock-copy out-of-stock'}>
          {selectedVariant.stock > 0 ? `${selectedVariant.stock} available` : 'Out of stock'}
        </span>
      </div>
      <button className="primary-btn" disabled={!selectedVariant.isActive || selectedVariant.stock < 1} onClick={add}>
        Add to cart
      </button>
    </article>
  );
}
