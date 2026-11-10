import { Link } from 'react-router-dom';
import { Search, ShoppingCart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiPost } from '../lib/api';
import { useAuthStore, useCartStore } from '../lib/store';

export function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const cartItems = useCartStore((state) => state.items);
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const clearCart = useCartStore((state) => state.clear);
  const totalItems = cartItems.reduce((sum, item) => sum + item.quantity, 0);

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
      <header className="site-header">
        <div className="container topbar">
          <Link to="/" className="brand-logo">
            MONO<span>PRIX</span>
          </Link>
          <nav className="nav">
            <Link to="/">Home</Link>
            <Link to="/catalog">Shop</Link>
            <Link to="/orders">Orders</Link>
            {(user?.role === 'ADMIN' || user?.role === 'STAFF') && <Link to="/dashboard">Operations</Link>}
          </nav>
          <div className="header-actions">
            <form action="/catalog" className="header-search" role="search">
              <Search size={17} aria-hidden="true" />
              <input name="q" aria-label="Search groceries" placeholder="Search groceries" />
            </form>
            {user ? (
              <div className="account-actions">
                <span className="account-name">{user.name}</span>
                <button type="button" className="text-button" onClick={logout}>Sign out</button>
              </div>
            ) : <Link to="/auth" style={{ fontWeight: 700 }}>Sign in</Link>}
            <Link to="/cart" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
              <ShoppingCart size={20} aria-hidden="true" />
              Cart ({totalItems})
            </Link>
          </div>
        </div>
      </header>
      {children}
      <footer className="site-footer">
        <div className="container footer-grid">
          <div>
            <div className="brand-logo footer-logo">MONO<span>PRIX</span></div>
            <p style={{ marginTop: 16, lineHeight: 1.7 }}>Premium online grocery shopping for homes, families and professionals across Sierra Leone.</p>
          </div>
          <div>
            <h4 style={{ marginBottom: 14 }}>Browse</h4>
            <p>Fresh produce</p>
            <p>Household essentials</p>
            <p>Bakery</p>
          </div>
          <div>
            <h4 style={{ marginBottom: 14 }}>Support</h4>
            <p>Delivery info</p>
            <p>Returns</p>
            <p>Contact</p>
          </div>
          <div>
            <h4 style={{ marginBottom: 14 }}>Store details</h4>
            <p>Freetown, Sierra Leone</p>
            <p>+232 78 123 456</p>
            <p>hello@monoprix.demo</p>
          </div>
        </div>
      </footer>
    </>
  );
}
