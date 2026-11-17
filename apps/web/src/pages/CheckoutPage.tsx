import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Layout } from '../components/Layout';
import { ApiError, apiPost } from '../lib/api';
import { flushPendingCartWrites } from '../lib/cartSync';
import { formatSLE, useAuthStore, useCartStore } from '../lib/store';

const checkoutSchema = z.object({
  customerName: z.string().trim().min(2, 'Enter the recipient name.').max(100),
  phone: z.string().trim().min(6, 'Enter a contact phone number.').max(30),
  email: z.union([z.string().trim().email().max(254), z.literal('')]).optional(),
  addressLine: z.string().trim().min(5, 'Enter a full delivery address.').max(300),
  area: z.string().trim().min(2, 'Enter a neighbourhood or area.').max(100),
  instructions: z.string().trim().max(500).optional(),
  paymentMethod: z.enum(['CASH_ON_DELIVERY', 'ORANGE_MONEY', 'VISA', 'MASTERCARD']),
});
type CheckoutFields = z.infer<typeof checkoutSchema>;

type CreatedOrder = {
  id: string;
  total: string;
  status: string;
  paymentStatus: string;
  payment: { id: string; status: string; provider: string; reference?: string } | null;
};

export function CheckoutPage() {
  const user = useAuthStore((state) => state.user);
  const items = useCartStore((state) => state.items);
  const clearCart = useCartStore((state) => state.clear);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [order, setOrder] = useState<CreatedOrder | null>(null);
  const idempotencyKey = useRef<string>('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<CheckoutFields>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      customerName: user?.name ?? '',
      phone: user?.phone ?? '',
      email: user?.email ?? '',
      addressLine: '',
      area: '',
      instructions: '',
      paymentMethod: 'CASH_ON_DELIVERY',
    },
  });

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const deliveryFee = items.length ? 50 : 0;

  async function placeOrder(fields: CheckoutFields) {
    setError('');
    setNotice('');
    if (!user) {
      setError('Sign in before placing your order so we can save it to your account.');
      return;
    }
    if (!items.length) {
      setError('Your basket is empty.');
      return;
    }
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();

    try {
      await flushPendingCartWrites();
      const { order: created } = await apiPost<{ order: CreatedOrder }>('/orders', {
        ...fields,
        email: fields.email || undefined,
      }, { 'Idempotency-Key': idempotencyKey.current });
      setOrder(created);
      clearCart();
      if (fields.paymentMethod === 'CASH_ON_DELIVERY') {
        setNotice('Order placed successfully. Cash is due on delivery.');
        return;
      }
      setNotice('Preparing secure payment session…');
      const { payment } = await apiPost<{
        payment: { id: string; status: string; provider: string; reference?: string; redirectUrl?: string };
      }>('/payments/initiate', { orderId: created.id });
      setOrder({ ...created, payment: { ...created.payment!, ...payment } });
      if (payment.redirectUrl) {
        window.location.assign(payment.redirectUrl);
        return;
      }
      setError('Payment gateway redirect URL was not returned. Please check your orders page.');
    } catch (issue) {
      if (issue instanceof ApiError && issue.status === 409) {
        setError(issue.message);
      } else {
        setError(issue instanceof Error ? issue.message : 'Order could not be placed.');
      }
    }
  }

  return (
    <Layout>
      <main className="container checkout-page">
        <div className="section-header"><div><p className="eyebrow">A few details, then you’re done</p><h1>Checkout</h1></div></div>
        {!user && <div className="notice notice-error">Sign in is required to place an order. <Link to="/auth">Sign in or create an account</Link>.</div>}
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        {notice && <div className="notice" role="status">{notice}</div>}
        {order ? (
          <section className="order-confirmation">
            <p className="eyebrow">Order received</p>
            <h2>Thank you. Your order is placed.</h2>
            <p>Order reference <strong>{order.id}</strong></p>
            <p>Total <strong>{formatSLE(order.total)}</strong> · Status <strong>{order.status}</strong></p>
            <p className="payment-tag">Payment status: <strong>{order.paymentStatus.toLowerCase()}</strong></p>
            <Link to="/orders" className="primary-btn">View my orders</Link>
          </section>
        ) : (
          <div className="checkout-layout">
            <form className="checkout-form" onSubmit={handleSubmit(placeOrder)} noValidate>
              <section className="form-section">
                <h2>Delivery details</h2>
                <div className="form-row">
                  <label className="field"><span>Recipient name</span><input autoComplete="name" {...register('customerName')} />{errors.customerName && <small className="field-error">{errors.customerName.message}</small>}</label>
                  <label className="field"><span>Phone number</span><input autoComplete="tel" {...register('phone')} />{errors.phone && <small className="field-error">{errors.phone.message}</small>}</label>
                </div>
                <label className="field"><span>Email <small>(optional)</small></span><input autoComplete="email" type="email" {...register('email')} />{errors.email && <small className="field-error">{errors.email.message}</small>}</label>
                <label className="field"><span>Delivery address</span><textarea autoComplete="street-address" rows={3} placeholder="Street, building or landmark" {...register('addressLine')} />{errors.addressLine && <small className="field-error">{errors.addressLine.message}</small>}</label>
                <div className="form-row">
                  <label className="field"><span>Area or neighbourhood</span><input placeholder="For example, Wilkinson Road" {...register('area')} />{errors.area && <small className="field-error">{errors.area.message}</small>}</label>
                  <label className="field"><span>Delivery instructions <small>(optional)</small></span><input placeholder="Gate code, landmarks…" {...register('instructions')} /></label>
                </div>
                <p className="address-note">Map search is optional. You can always enter your address manually.</p>
              </section>
              <section className="form-section">
                <h2>Payment method</h2>
                <label className="field">
                  <span>Choose how you would pay</span>
                  <select {...register('paymentMethod')}>
                    <option value="CASH_ON_DELIVERY">Cash on delivery</option>
                    <option value="ORANGE_MONEY">Orange-Money/Afri-Money</option>
                    <option value="VISA">Visa</option>
                    <option value="MASTERCARD">Mastercard</option>
                  </select>
                </label>
                <p className="demo-payment-note">Electronic payments are handled by Monime’s secure hosted checkout. Monoprix never stores your card or mobile money details.</p>
              </section>
              <button className="primary-btn full-width-button" disabled={isSubmitting || !items.length}>
                {isSubmitting ? 'Preparing secure checkout…' : 'Place order'}
              </button>
            </form>
            <aside className="summary-box">
              <p className="eyebrow">Your basket</p>
              <h2>Order summary</h2>
              {items.map((item) => (
                <div key={item.id} className="row-line summary-product"><span>{item.name} × {item.quantity}</span><strong>{formatSLE(item.price * item.quantity)}</strong></div>
              ))}
              <div className="row-line"><span>Subtotal estimate</span><strong>{formatSLE(subtotal)}</strong></div>
              <div className="row-line"><span>Delivery estimate</span><strong>{formatSLE(deliveryFee)}</strong></div>
              <div className="row-line total-line"><span>Estimated total</span><span>{formatSLE(subtotal + deliveryFee)}</span></div>
              <p className="summary-note">The server recalculates the total using current catalogue prices and stock.</p>
            </aside>
          </div>
        )}
      </main>
    </Layout>
  );
}
