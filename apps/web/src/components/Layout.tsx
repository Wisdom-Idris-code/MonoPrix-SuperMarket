import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ShoppingCart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiPost } from '../lib/api';
import { useAuthStore, useCartStore } from '../lib/store';
import { CartDrawer } from './CartDrawer';

export function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [cartOpen, setCartOpen] = useState(false);
  const cartButtonRef = useRef<HTMLButtonElement>(null);
  const cartItems = useCartStore((state) => state.items);
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const clearCart = useCartStore((state) => state.clear);
  const totalItems = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const closeCart = useCallback(() => setCartOpen(false), []);

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new FormData(event.currentTarget).get('q')?.toString().trim() ?? '';
    navigate(query ? `/catalog?q=${encodeURIComponent(query)}` : '/catalog');
  }

  async function logout() {
    try {
      await apiPost('/auth/logout');
      setUser(null);
      clearCart();
      navigate('/');
    } catch (error) {
      console.error('Unable to log out:', error);
    }
  }

  return (
    <>
      <div className="announcement-strip">Online grocery shopping for Freetown · Current stock and final totals confirmed at checkout</div>
      <header className="site-header">
        <div className="container topbar">
          <Link to="/" className="brand-logo">
            MONO<span>PRIX</span>
          </Link>
          <nav className="nav">
            <Link to="/">Home</Link>
            <Link to="/catalog">Shop groceries</Link>
            <Link to="/orders">Orders</Link>
            {(user?.role === 'ADMIN' || user?.role === 'STAFF') && <Link to="/dashboard">Operations</Link>}
          </nav>
          <div className="header-actions">
            <form onSubmit={search} className="header-search" role="search">
              <Search size={17} aria-hidden="true" />
              <input name="q" aria-label="Search groceries" placeholder="Search groceries" />
            </form>
            {user ? (
              <div className="account-actions">
                <span className="account-name">{user.name}</span>
                <button type="button" className="text-button" onClick={logout}>Sign out</button>
              </div>
            ) : <Link to="/auth" style={{ fontWeight: 700 }}>Sign in</Link>}
            <button
              ref={cartButtonRef}
              type="button"
              className="header-cart-button"
              aria-label={`Open cart, ${totalItems} ${totalItems === 1 ? 'item' : 'items'}`}
              aria-haspopup="dialog"
              aria-expanded={cartOpen}
              onClick={() => setCartOpen(true)}
            >
              <span className="cart-icon-target" data-cart-target>
                <ShoppingCart size={20} aria-hidden="true" />
                <span className="cart-count-badge" data-cart-count>{totalItems}</span>
              </span>
              <span>Cart</span>
            </button>
          </div>
        </div>
      </header>
      {children}
      <footer className="site-footer">
        <div className="container footer-grid">
          <div>
            <div className="brand-logo footer-logo">MONO<span>PRIX</span></div>
            <p style={{ marginTop: 16, lineHeight: 1.7 }}>A considered online grocery shopping experience for Freetown.</p>
          </div>
          <div>
            <h4 style={{ marginBottom: 14 }}>Browse</h4>
            <p><Link to="/catalog">Shop all groceries</Link></p>
            <p><Link to="/catalog?sort=newest">Recently added</Link></p>
            <p><Link to="/catalog?sort=price-asc">Browse by price</Link></p>
          </div>
          <div>
            <h4 style={{ marginBottom: 14 }}>Support</h4>
            <p><Link to="/orders">Order history</Link></p>
            <p><Link to="/auth">Your account</Link></p>
            <p><Link to="/cart">Shopping cart</Link></p>
          </div>
          <div>
            <h4 style={{ marginBottom: 14 }}>Store details</h4>
            <p>Freetown, Sierra Leone</p>
            <p>Clear SLE pricing</p>
            <p>Secure hosted payment options</p>
          </div>
        </div>
      </footer>
      <CartDrawer open={cartOpen} onClose={closeCart} returnFocusRef={cartButtonRef} />
    </>
  );
}
