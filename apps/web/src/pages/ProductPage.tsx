import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import type { StoreVariant } from '../components/ProductCard';
import { addCartProduct } from '../lib/cartSync';
import { apiGet } from '../lib/api';
import { formatSLE } from '../lib/store';

type ProductDetail = {
  id: string;
  name: string;
  brand: string | null;
  slug: string;
  sku?: string;
  description: string;
  price: string;
  stock: number;
  imageUrl: string;
  altText: string;
  imageStatus: string;
  category: { name: string };
  variants?: StoreVariant[];
  productImages?: Array<{ id: string; imageUrl: string; altText: string; isPrimary: boolean; order: number }>;
};

export function ProductPage() {
  const { slug } = useParams();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [selectedImage, setSelectedImage] = useState('');
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    if (!slug) return;
    setLoading(true);
    apiGet<{ product: ProductDetail }>(`/products/slug/${encodeURIComponent(slug)}`)
      .then(({ product: result }) => {
        if (active) {
          setProduct(result);
          setSelectedImage(result.imageUrl);
          setSelectedVariantId(
            result.variants?.find((variant) => variant.isDefault)?.id ?? result.variants?.[0]?.id ?? result.id,
          );
          setQuantity(1);
        }
      })
      .catch((issue: unknown) => setError(issue instanceof Error ? issue.message : 'Product could not be loaded.'))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  const variants = product?.variants?.length
    ? product.variants
    : product ? [{
      id: product.id,
      name: 'Standard',
      quantity: '1',
      unit: 'item',
      sku: product.sku ?? '',
      price: product.price,
      stock: product.stock,
      isActive: true,
      isDefault: true,
    }] : [];
  const selectedVariant = variants.find((variant) => variant.id === selectedVariantId) ?? variants[0];

  async function add() {
    if (!product || !selectedVariant) return;
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
      }, quantity);
      setNotice(`${quantity} × ${product.name} (${selectedVariant.name}) added to your cart.`);
    } catch (issue) {
      setNotice(issue instanceof Error ? issue.message : 'Could not add that item.');
    }
  }

  return (
    <Layout>
      <main className="container product-detail-page">
        {loading && <div className="product-detail-skeleton skeleton" />}
        {!loading && error && <div className="empty-state"><h1>Product unavailable</h1><p>{error}</p><Link className="text-link" to="/catalog">Return to catalogue</Link></div>}
        {!loading && product && (
          <>
            <nav className="breadcrumbs" aria-label="Breadcrumb"><Link to="/">Home</Link><span>/</span><Link to="/catalog">Catalogue</Link><span>/</span><span>{product.name}</span></nav>
            <div className="product-detail-grid">
              <section className="product-gallery">
                <div className="product-detail-image">
                  <img
                    src={selectedImage || product.imageUrl}
                    alt={product.altText}
                    width="900"
                    height="900"
                    onError={(event) => { event.currentTarget.src = '/api/v1/assets/product/placeholder.svg'; }}
                  />
                  {product.imageStatus !== 'APPROVED' && <span className="image-status">Approved product image needed</span>}
                </div>
                {(product.productImages?.length ?? 0) > 1 && (
                  <div className="thumbnail-row">
                    {product.productImages!.map((image) => (
                      <button key={image.id} type="button" className={selectedImage === image.imageUrl ? 'thumbnail selected' : 'thumbnail'} onClick={() => setSelectedImage(image.imageUrl)}>
                        <img src={image.imageUrl} alt={image.altText} loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
              </section>
              <section className="product-detail-info">
                <p className="eyebrow">{product.category.name}</p>
                {product.brand && <p className="product-brand detail-brand">{product.brand}</p>}
                <h1>{product.name}</h1>
                <div className="detail-price">{formatSLE(selectedVariant?.price ?? product.price)}</div>
                <p className="detail-description">{product.description}</p>
                {variants.length > 1 && (
                  <label className="field product-detail-option">
                    <span>Package size</span>
                    <select
                      aria-label={`Package size for ${product.name}`}
                      value={selectedVariant?.id}
                      onChange={(event) => {
                        setSelectedVariantId(event.target.value);
                        setQuantity(1);
                      }}
                    >
                      {variants.map((variant) => (
                        <option key={variant.id} value={variant.id} disabled={!variant.isActive}>
                          {variant.name} · {variant.quantity} {variant.unit} — {formatSLE(variant.price)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {variants.length === 1 && <p className="cart-variant-copy">{selectedVariant?.name} · {selectedVariant?.quantity} {selectedVariant?.unit}</p>}
                <p className={selectedVariant?.stock ? 'stock-copy' : 'stock-copy out-of-stock'}>
                  {selectedVariant?.stock ? `${selectedVariant.stock} in stock` : 'Currently unavailable'}
                </p>
                <div className="purchase-row">
                  <div className="quantity-picker" aria-label="Quantity">
                    <button type="button" aria-label="Decrease quantity" disabled={quantity <= 1} onClick={() => setQuantity((value) => value - 1)}>−</button>
                    <span>{quantity}</span>
                    <button type="button" aria-label="Increase quantity" disabled={quantity >= (selectedVariant?.stock ?? 0)} onClick={() => setQuantity((value) => Math.min(selectedVariant?.stock ?? 0, value + 1))}>+</button>
                  </div>
                  <button className="primary-btn" disabled={!selectedVariant?.isActive || (selectedVariant?.stock ?? 0) < 1} onClick={add}>Add to cart</button>
                </div>
                {notice && <p className="notice" role="status">{notice}</p>}
                <div className="demo-product-note">Demonstration product and price. Product photography is awaiting review.</div>
              </section>
            </div>
          </>
        )}
      </main>
    </Layout>
  );
}
