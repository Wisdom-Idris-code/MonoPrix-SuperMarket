import { memo, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { addCartProduct } from '../lib/cartSync';
import { flyProductToCart } from '../lib/cartAnimation';
import { formatSLE, useCartStore } from '../lib/store';

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

export const ProductCard = memo(function ProductCard({ product, onNotice }: Props) {
  const imageRef = useRef<HTMLImageElement>(null);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [added, setAdded] = useState(false);
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
  const cartQuantity = useCartStore((state) => state.items.find((item) => item.id === selectedVariant.id)?.quantity ?? 0);

  useEffect(() => () => {
    if (successTimer.current) clearTimeout(successTimer.current);
  }, []);

  function add() {
    const message = `${product.name} (${selectedVariant.name}) added to cart.`;
    const persistence = addCartProduct({
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
    flyProductToCart(imageRef.current, product.imageUrl);
    setAdded(true);
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => setAdded(false), 1300);
    onNotice(message);
    void persistence.catch((issue: unknown) => {
      if (successTimer.current) clearTimeout(successTimer.current);
      setAdded(false);
      onNotice(issue instanceof Error ? issue.message : 'Cart could not be saved. Please try again.');
    });
  }

  return (
    <article className="product-card">
      <Link to={`/products/${product.slug}`} className="product-image-wrap">
        <img
          ref={imageRef}
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
      <button className={added ? 'primary-btn added-btn' : 'primary-btn'} disabled={!selectedVariant.isActive || cartQuantity >= selectedVariant.stock} onClick={add}>
        {added ? 'Added ✓' : 'Add to cart'}
      </button>
    </article>
  );
});
