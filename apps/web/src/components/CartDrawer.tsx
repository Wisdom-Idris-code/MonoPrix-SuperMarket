import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Minus, Plus, ShoppingBag, X } from 'lucide-react';
import { removeCartProduct, updateCartProductQuantity } from '../lib/cartSync';
import { formatSLE, useCartStore, type CartItem } from '../lib/store';

type Props = {
  open: boolean;
  onClose: () => void;
  returnFocusRef: React.RefObject<HTMLButtonElement>;
};

export function CartDrawer({ open, onClose, returnFocusRef }: Props) {
  const items = useCartStore((state) => state.items);
  const [mounted, setMounted] = useState(open);
  const [error, setError] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  useEffect(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (open) setMounted(true);
    else if (mounted) closeTimer.current = setTimeout(() => setMounted(false), 220);
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const drawer = document.querySelector<HTMLElement>('.cart-drawer-panel');
      const focusable = drawer?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    panelRef.current?.toggleAttribute('inert', !open);
    if (open && mounted) closeRef.current?.focus();
    if (!open && mounted) returnFocusRef.current?.focus();
  }, [mounted, open, returnFocusRef]);

  async function changeQuantity(item: CartItem, quantity: number) {
    setError('');
    try {
      await updateCartProductQuantity(item.id, quantity);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Cart could not be updated.');
    }
  }

  async function removeItem(item: CartItem) {
    setError('');
    try {
      await removeCartProduct(item.id);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Cart item could not be removed.');
    }
  }

  if (!mounted) return null;

  return (
    <div className={open ? 'cart-drawer-layer is-open' : 'cart-drawer-layer'} aria-hidden={!open}>
      <button className="cart-drawer-backdrop" type="button" aria-label="Close shopping cart" tabIndex={open ? 0 : -1} onClick={onClose} />
      <section
        ref={panelRef}
        className="cart-drawer-panel"
        role="dialog"
        aria-modal={open ? 'true' : undefined}
        aria-label="Shopping cart"
        aria-hidden={!open}
      >
        <div className="cart-drawer-header">
          <div>
            <p className="eyebrow">Your selection</p>
            <h2>Shopping cart <span>({items.reduce((sum, item) => sum + item.quantity, 0)})</span></h2>
          </div>
          <button ref={closeRef} type="button" className="icon-button" aria-label="Close shopping cart" onClick={onClose}>
            <X size={21} aria-hidden="true" />
          </button>
        </div>
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        {items.length === 0 ? (
          <div className="cart-drawer-empty">
            <ShoppingBag size={34} aria-hidden="true" />
            <h3>Your cart is empty</h3>
            <p>Browse the catalogue to find something for your next shop.</p>
            <Link to="/catalog" className="primary-btn" onClick={onClose}>Browse products</Link>
          </div>
        ) : (
          <>
            <div className="cart-drawer-items">
              {items.map((item) => (
                <article className="cart-drawer-item" key={item.id}>
                  <img
                    src={item.imageUrl}
                    alt={item.altText}
                    width="88"
                    height="88"
                    loading="lazy"
                    onError={(event) => { event.currentTarget.src = '/api/v1/assets/product/placeholder.svg'; }}
                  />
                  <div className="cart-drawer-item-detail">
                    <Link to={`/products/${item.slug}`} className="product-name" onClick={onClose}>{item.name}</Link>
                    <span className="cart-variant-copy">{item.variantName} · {formatSLE(item.price)}</span>
                    <div className="quantity-picker compact-picker" aria-label={`${item.name} quantity`}>
                      <button type="button" aria-label={`Decrease ${item.name}`} disabled={item.quantity <= 1} onClick={() => void changeQuantity(item, item.quantity - 1)}>
                        <Minus size={14} aria-hidden="true" />
                      </button>
                      <span>{item.quantity}</span>
                      <button type="button" aria-label={`Increase ${item.name}`} disabled={item.quantity >= item.stock} onClick={() => void changeQuantity(item, item.quantity + 1)}>
                        <Plus size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <div className="cart-drawer-item-total">
                    <strong>{formatSLE(item.price * item.quantity)}</strong>
                    <button type="button" className="text-button remove-button" onClick={() => void removeItem(item)}>Remove</button>
                  </div>
                </article>
              ))}
            </div>
            <div className="cart-drawer-footer">
              <div className="row-line"><span>Subtotal</span><strong>{formatSLE(subtotal)}</strong></div>
              <p className="summary-note">Delivery and final stock are confirmed at checkout.</p>
              <Link to="/checkout" className="primary-btn full-width-button" onClick={onClose}>Proceed to checkout</Link>
              <Link to="/cart" className="cart-view-link" onClick={onClose}>View full cart</Link>
              <button type="button" className="text-button cart-continue" onClick={onClose}>Continue shopping</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
