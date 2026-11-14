import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { apiGet } from '../lib/api';
import { formatSLE, useAuthStore } from '../lib/store';

type Order = {
  id: string;
  status: string;
  subtotal: string;
  deliveryFee: string;
  total: string;
  paymentMethod: string;
  paymentStatus: string;
  createdAt: string;
  items: Array<{
    id: string;
    productName: string;
    variantName: string | null;
    variantQuantity: string | null;
    variantUnit: string | null;
    unitPrice: string;
    quantity: number;
    totalPrice: string;
  }>;
  delivery: { status: string; trackingCode: string | null } | null;
};

const stages = ['PENDING', 'CONFIRMED', 'PROCESSING', 'READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const stageLabels: Record<string, string> = {
  PENDING: 'Received',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Being prepared',
  READY_FOR_DELIVERY: 'Ready for delivery',
  OUT_FOR_DELIVERY: 'On the way',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

export function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const user = useAuthStore((state) => state.user);
  const initialized = useAuthStore((state) => state.initialized);
  const [searchParams] = useSearchParams();
  const paymentReturn = searchParams.get('payment');
  const isStaff = user?.role === 'ADMIN' || user?.role === 'STAFF';

  useEffect(() => {
    let active = true;
    if (!initialized || !user) {
      setLoading(false);
      return () => { active = false; };
    }
    const url = isStaff ? '/admin/orders' : '/orders';
    const fetchOrders = () => (
      apiGet<{ orders: Order[] }>(url)
        .then(({ orders: result }) => { if (active) setOrders(result); })
        .catch((issue: unknown) => { if (active) setError(issue instanceof Error ? issue.message : 'Order history is unavailable.'); })
        .finally(() => { if (active) setLoading(false); })
    );

    fetchOrders();

    if (paymentReturn === 'returned') {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts += 1;
        if (attempts >= 6 || !active) {
          clearInterval(interval);
          return;
        }
        fetchOrders();
      }, 2500);
      return () => {
        active = false;
        clearInterval(interval);
      };
    }

    return () => { active = false; };
  }, [initialized, isStaff, user, paymentReturn]);

  return (
    <Layout>
      <main className="container orders-page">
        <div className="section-header"><div><p className="eyebrow">{isStaff ? 'Store operations' : 'Your shopping history'}</p><h1>{isStaff ? 'Orders' : 'Your orders'}</h1></div></div>
        {paymentReturn === 'cancelled' && <div className="notice" role="status">Checkout was cancelled. No order is confirmed until payment succeeds.</div>}
        {paymentReturn === 'returned' && <div className="notice" role="status">Checkout returned to Monoprix. Your order will update after payment verification.</div>}
        {!user && <div className="empty-state"><h2>Sign in to see your orders</h2><Link to="/auth" className="primary-btn">Sign in</Link></div>}
        {loading && user && <div className="skeleton orders-skeleton" />}
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        {!loading && !error && user && orders.length === 0 && (
          <div className="empty-state"><h2>No orders yet</h2><p>Your completed checkouts will appear here.</p><Link to="/catalog" className="primary-btn">Start shopping</Link></div>
        )}
        <div className="order-list">
          {orders.map((order) => {
            const stageIndex = stages.indexOf(order.status);
            return (
              <article key={order.id} className="order-card">
                <header className="order-card-header">
                  <div><p className="eyebrow">Order reference</p><h2>{order.id}</h2></div>
                  <div className="order-card-status"><span>{stageLabels[order.status] ?? order.status.replaceAll('_', ' ')}</span><small>{new Date(order.createdAt).toLocaleDateString()}</small></div>
                </header>
                {order.status === 'CANCELLED' ? (
                  <p className="order-cancelled">This order was cancelled.</p>
                ) : (
                  <ol className="order-progress" aria-label="Order progress">
                    {stages.map((stage, index) => (
                      <li key={stage} className={index <= stageIndex ? 'complete' : ''}>
                        <span className="progress-dot" />
                        <small>{stageLabels[stage]}</small>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="order-items">
                  {order.items.map((item) => (
                    <div className="row-line" key={item.id}>
                      <span>
                        {item.productName}
                        {item.variantName && <small> · {item.variantName}{item.variantQuantity && item.variantUnit ? ` (${item.variantQuantity} ${item.variantUnit})` : ''}</small>}
                        <small> × {item.quantity}</small>
                      </span>
                      <strong>{formatSLE(item.totalPrice)}</strong>
                    </div>
                  ))}
                </div>
                <footer className="order-card-footer">
                  <span>Payment: {order.paymentStatus.toLowerCase()} <small>({order.paymentMethod.replaceAll('_', ' ').toLowerCase()})</small></span>
                  <strong>Total {formatSLE(order.total)}</strong>
                </footer>
              </article>
            );
          })}
        </div>
      </main>
    </Layout>
  );
}
