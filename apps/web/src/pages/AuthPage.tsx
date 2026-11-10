import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Layout } from '../components/Layout';
import { ApiError, apiPost } from '../lib/api';
import { syncGuestCart } from '../lib/cartSync';
import { useAuthStore, type AuthUser } from '../lib/store';

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(254),
  password: z.string().min(12, 'Password must be at least 12 characters.').max(128),
});
const registrationSchema = loginSchema.extend({
  name: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(30).optional(),
}).superRefine((values, context) => {
  if (!values.name || values.name.length < 2) {
    context.addIssue({ code: 'custom', path: ['name'], message: 'Enter your name.' });
  }
});
type AuthFields = {
  name?: string;
  email: string;
  password: string;
  phone?: string;
};

export function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const navigate = useNavigate();
  const setUser = useAuthStore((state) => state.setUser);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<AuthFields>({
    resolver: (values, context, options) => mode === 'login'
      ? zodResolver(loginSchema)(values, context, options)
      : zodResolver(registrationSchema)(values, context, options),
    defaultValues: { email: '', password: '', name: '', phone: '' },
  });

  async function submit(values: AuthFields) {
    setError('');
    setNotice('');
    if (mode === 'register' && !values.name?.trim()) {
      setError('Enter your name.');
      return;
    }

    try {
      const isLogin = mode === 'login';
      const endpoint = isLogin ? '/auth/login' : '/auth/register';
      const payload = isLogin
        ? { email: values.email, password: values.password }
        : { name: values.name, email: values.email, password: values.password, phone: values.phone };
      const user = await apiPost<{ user: AuthUser }>(endpoint, payload);
      setUser(user.user);
      await syncGuestCart();
      setNotice(`Signed in as ${user.user.name}. Your saved cart is ready.`);
      navigate(user.user.role === 'ADMIN' || user.user.role === 'STAFF' ? '/dashboard' : '/cart');
    } catch (issue) {
      const message = issue instanceof Error ? issue.message : 'Account access failed.';
      if (issue instanceof ApiError && issue.status === 401) {
        setError('We could not verify those details. Please check your email and password.');
      } else {
        setError(message);
      }
    }
  }

  return (
    <Layout>
      <main className="container auth-page">
        <section className="auth-box">
          <p className="eyebrow">Monoprix Online · Concept demo</p>
          <h1>{mode === 'login' ? 'Welcome back.' : 'Create your account.'}</h1>
          <p className="auth-intro">Sign in to sync your cart and follow your demonstration orders.</p>
          <div className="auth-tabs" role="tablist" aria-label="Account options">
            <button type="button" className={mode === 'login' ? 'auth-tab active' : 'auth-tab'} onClick={() => { setMode('login'); setError(''); }}>Sign in</button>
            <button type="button" className={mode === 'register' ? 'auth-tab active' : 'auth-tab'} onClick={() => { setMode('register'); setError(''); }}>Create account</button>
          </div>
          <form onSubmit={handleSubmit(submit)} className="form-grid" noValidate>
            {mode === 'register' && (
              <label className="field">
                <span>Full name</span>
                <input autoComplete="name" {...register('name')} aria-invalid={Boolean(errors.name)} />
                {errors.name && <span className="field-error">{errors.name.message}</span>}
              </label>
            )}
            <label className="field">
              <span>Email address</span>
              <input autoComplete="email" type="email" {...register('email')} aria-invalid={Boolean(errors.email)} />
              {errors.email && <span className="field-error">{errors.email.message}</span>}
            </label>
            <label className="field">
              <span>Password</span>
              <input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} type="password" {...register('password')} aria-invalid={Boolean(errors.password)} />
              {errors.password && <span className="field-error">{errors.password.message}</span>}
            </label>
            {mode === 'register' && (
              <label className="field">
                <span>Phone number <small>(optional)</small></span>
                <input autoComplete="tel" {...register('phone')} />
                {errors.phone && <span className="field-error">{errors.phone.message}</span>}
              </label>
            )}
            {error && <p className="notice notice-error" role="alert">{error}</p>}
            {notice && <p className="notice" role="status">{notice}</p>}
            <button className="primary-btn full-width-button" disabled={isSubmitting}>
              {isSubmitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
          <p className="auth-back"><Link to="/">Return to shopping</Link></p>
        </section>
      </main>
    </Layout>
  );
}
