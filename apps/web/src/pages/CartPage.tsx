import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { apiDelete, apiPatch } from '../lib/api';
import { useAuthStore, useCartStore, formatSLE } from '../lib/store';
import { replaceFromServerCart } from '../lib/cartSync';

type ServerCart = {
  items: Array<{
    id: string;
    productId: string;
    variantId: string;
    name: string;
    slug: string;
    variantName: string;
    variantQuantity: string;
    variantUnit: string;
    price: string;
    quantity: number;
    stock: number;
    imageUrl: string;
    altText: string;
  }>;
};

export function CartPage() {
  const items = useCartStore((state) => state.items);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const setItems = useCartStore((state) => state.setItems);
  const user = useAuthStore((state) => state.user);
  const [notice, setNotice] = useState('');
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const deliveryFee = subtotal > 0 ? 50 : 0;
  const total = subtotal + deliveryFee;

  async function changeQuantity(itemId: string, value: number) {
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return;
    const quantity = Math.min(item.stock, Math.max(0, value));
    try {
      if (user && item.serverItemId) {
        const { cart } = await apiPatch<{ cart: ServerCart }>(`/cart/items/${item.serverItemId}`, { quantity });
        await replaceFromServerCart(cart);
      } else {
        updateQuantity(itemId, quantity);
      }
      setNotice('');
    } catch (issue) {
      setNotice(issue instanceof Error ? issue.message : 'Cart could not be updated.');
    }
  }

  async function remove(itemId: string) {
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return;
    try {
      if (user && item.serverItemId) {
        const { cart } = await apiDelete<{ cart: ServerCart }>(`/cart/items/${item.serverItemId}`);
        await replaceFromServerCart(cart);
      } else {
        removeItem(itemId);
      }
      setNotice('');
    } catch (issue) {
      setNotice(issue instanceof Error ? issue.message : 'Cart item could not be removed.');
    }
  }

  return (
    <Layout>
      <main className="container cart-page">
        <div className="section-header">
          <div><p className="eyebrow">Your selection</p><h1>Your basket</h1></div>
          <Link to="/catalog" className="text-link">Continue shopping</Link>
        </div>
        {notice && <p className="notice notice-error" role="alert">{notice}</p>}
        <div className="cart-layout">
          <section className="cart-items" aria-label="Cart items">
            {items.length === 0 ? (
              <div className="empty-state">
                <h2>Your basket is empty</h2>
                <p>Find fresh produce, pantry staples and household essentials.</p>
                <Link to="/catalog" className="primary-btn">Browse the catalogue</Link>
              </div>
            ) : items.map((item) => (
              <article key={item.id} className="item-row">
                <img
                  src={item.imageUrl}
                  alt={item.altText}
                  width="160"
                  height="160"
                  loading="lazy"
                  onError={(event) => { event.currentTarget.src = '/api/v1/assets/product/placeholder.svg'; }}
                />
                <div className="cart-item-detail">
                  <Link to={`/products/${item.slug}`} className="product-name">{item.name}</Link>
                  <div className="cart-variant-copy">{item.variantName} · {item.variantQuantity} {item.variantUnit}</div>
                  <div className="stock-copy">{formatSLE(item.price)} · {item.stock} available</div>
                  <div className="quantity-picker compact-picker">
                    <button aria-label={`Decrease ${item.name}`} disabled={item.quantity <= 1} onClick={() => changeQuantity(item.id, item.quantity - 1)}>−</button>
                    <span>{item.quantity}</span>
                    <button aria-label={`Increase ${item.name}`} disabled={item.quantity >= item.stock} onClick={() => changeQuantity(item.id, item.quantity + 1)}>+</button>
                  </div>
                </div>
                <div className="cart-item-total">
                  <strong>{formatSLE(item.price * item.quantity)}</strong>
                  <button className="text-button remove-button" onClick={() => remove(item.id)}>Remove</button>
                </div>
              </article>
            ))}
          </section>
          <aside className="summary-box">
            <p className="eyebrow">Order summary</p>
            <h2>At a glance</h2>
            <div className="row-line"><span>Subtotal</span><strong>{formatSLE(subtotal)}</strong></div>
            <div className="row-line"><span>Delivery estimate</span><strong>{formatSLE(deliveryFee)}</strong></div>
            <div className="row-line total-line"><span>Estimated total</span><span>{formatSLE(total)}</span></div>
            <p className="summary-note">Final prices and stock are confirmed by the server at checkout.</p>
            {items.length > 0 && (
              <Link to="/checkout" className="primary-btn full-width-button">Continue to checkout</Link>
            )}
          </aside>
        </div>
      </main>
    </Layout>
  );
}
