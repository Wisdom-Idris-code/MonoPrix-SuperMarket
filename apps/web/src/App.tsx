import { Route, Routes } from 'react-router-dom';
import { useEffect } from 'react';
import { HomePage } from './pages/HomePage';
import { CatalogPage } from './pages/CatalogPage';
import { ProductPage } from './pages/ProductPage';
import { CartPage } from './pages/CartPage';
import { AuthPage } from './pages/AuthPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { DashboardPage } from './pages/DashboardPage';
import { OrdersPage } from './pages/OrdersPage';
import { ScrollToTop } from './components/ScrollToTop';
import { apiGet } from './lib/api';
import { useAuthStore, type AuthUser } from './lib/store';
import { replaceFromServerCart } from './lib/cartSync';

export default function App() {
  const setUser = useAuthStore((state) => state.setUser);
  const setInitialized = useAuthStore((state) => state.setInitialized);

  useEffect(() => {
    let active = true;
    apiGet<{ user: AuthUser | null }>('/auth/me')
      .then(async ({ user }) => {
        if (!active || !user) return;
        setUser(user);
        const { cart } = await apiGet<{ cart: { items: Array<{
          id: string; productId: string; name: string; slug: string; price: string; quantity: number;
          stock: number; imageUrl: string; altText: string;
        }> } }>('/cart');
        if (active) await replaceFromServerCart(cart);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && !('status' in error && error.status === 401)) {
          console.error('Unable to restore the customer session:', error);
        }
      })
      .finally(() => { if (active) setInitialized(true); });
    return () => { active = false; };
  }, [setInitialized, setUser]);

  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/products/:slug" element={<ProductPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/orders" element={<OrdersPage />} />
      </Routes>
    </>
  );
}
