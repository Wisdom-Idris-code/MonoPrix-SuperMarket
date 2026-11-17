import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { removeCartProduct, updateCartProductQuantity } from '../lib/cartSync';
import { useCartStore, formatSLE } from '../lib/store';

export function CartPage() {
  const items = useCartStore((state) => state.items);
  const [notice, setNotice] = useState('');
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const deliveryFee = subtotal > 0 ? 50 : 0;
  const total = subtotal + deliveryFee;

  async function changeQuantity(itemId: string, value: number) {
    setNotice('');
    try {
      await updateCartProductQuantity(itemId, value);
    } catch (issue) {
      setNotice(issue instanceof Error ? issue.message : 'Cart could not be updated.');
    }
  }

  async function remove(itemId: string) {
    setNotice('');
    try {
      await removeCartProduct(itemId);
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
