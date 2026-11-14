import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiUpload } from '../lib/api';
import { formatSLE, useAuthStore } from '../lib/store';

type Summary = {
  totalOrders: number;
  totalSales: string;
  pendingOrders: number;
  completedOrders: number;
  lowStockProducts: Array<{ id: string; name: string; stock: number }>;
  recentOrders: Array<{ id: string; customer: string; total: string; status: string; createdAt: string }>;
  demoDataLabel: string;
};
type Category = { id: string; name: string; slug: string; description?: string | null; active?: boolean };
type ProductVariant = {
  id?: string;
  name: string;
  quantity: string;
  unit: string;
  sku: string;
  price: string;
  stock: number;
  isActive: boolean;
  isDefault: boolean;
};
type Product = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  price: string;
  stock: number;
  imageStatus: string;
  isActive: boolean;
  altText: string;
  category: { name: string };
  description: string;
  categoryId: string;
  variants: ProductVariant[];
};
type VariantDraft = ProductVariant & { id?: string };
type Order = {
  id: string;
  customerName: string;
  phone: string;
  total: string;
  status: string;
  paymentStatus: string;
};
type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: 'CUSTOMER' | 'ADMIN' | 'STAFF';
  phone: string | null;
  isActive: boolean;
};
type AuditEntry = {
  id: string;
  action: string;
  entity: string;
  details: string | null;
  createdAt: string;
  user: { name: string; email: string } | null;
};

const orderTransitions: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['READY_FOR_DELIVERY', 'CANCELLED'],
  READY_FOR_DELIVERY: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};
const accountRoles: ManagedUser['role'][] = ['CUSTOMER', 'STAFF', 'ADMIN'];
const emptyVariant = (): VariantDraft => ({
  name: 'Standard',
  quantity: '1',
  unit: 'item',
  sku: '',
  price: '',
  stock: 0,
  isActive: true,
  isDefault: true,
});

export function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const initialized = useAuthStore((state) => state.initialized);
  const [tab, setTab] = useState<'overview' | 'orders' | 'products' | 'categories' | 'inventory' | 'accounts' | 'audit'>('overview');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [variantDrafts, setVariantDrafts] = useState<VariantDraft[]>([emptyVariant()]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [cachedUpload, setCachedUpload] = useState<{ file: File; upload: { publicId: string; imageUrl: string; thumbnailUrl: string } } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const productFormRef = useRef<HTMLFormElement>(null);

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const loadData = useCallback(async () => {
    const [dashboard, productList, orderList, categoryList] = await Promise.all([
      apiGet<Summary>('/admin/dashboard'),
      apiGet<{ products: Product[] }>(user?.role === 'ADMIN' ? '/admin/products?active=all' : '/admin/products'),
      apiGet<{ orders: Order[] }>('/admin/orders'),
      apiGet<{ categories: Category[] }>('/admin/categories'),
    ]);
    setSummary(dashboard);
    setProducts(productList.products);
    setOrders(orderList.orders);
    setCategories(categoryList.categories);
    if (user?.role === 'ADMIN') {
      const { users: result } = await apiGet<{ users: ManagedUser[] }>('/admin/users');
      setUsers(result);
    }
  }, [user]);

  useEffect(() => {
    if (!initialized || !user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) return;
    loadData().catch((issue: unknown) => setError(issue instanceof Error ? issue.message : 'Operations data could not be loaded.'));
  }, [initialized, loadData, user]);

  async function submitProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError('');
    setNotice('');
    setFieldErrors({});

    const clientErrors: Record<string, string> = {};

    const name = String(values.get('name') || '').trim();
    if (!name) clientErrors.name = 'Please enter a product name.';
    else if (name.length < 2) clientErrors.name = 'Product name must be at least 2 characters.';

    const categoryId = String(values.get('categoryId') || '').trim();
    if (!categoryId) clientErrors.categoryId = 'Please select a product category.';

    const description = String(values.get('description') || '').trim();
    if (!description) clientErrors.description = 'Please enter a product description.';
    else if (description.length < 5) clientErrors.description = 'Product description must be at least 5 characters.';

    const altText = String(values.get('altText') || '').trim();
    if (!altText) clientErrors.altText = 'Please enter image alt text.';
    else if (altText.length < 3) clientErrors.altText = 'Image alt text must be at least 3 characters.';

    const file = values.get('image');
    const hasNewFile = file instanceof File && file.size > 0;

    if (!editingProduct && !hasNewFile && !cachedUpload) {
      clientErrors.image = 'Choose an approved product image before creating the product.';
    } else if (hasNewFile) {
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowed.includes(file.type)) {
        clientErrors.image = 'Only JPEG, PNG, and WebP images are accepted.';
      } else if (file.size > 10 * 1024 * 1024) {
        clientErrors.image = 'Image exceeds the 10 MB upload limit.';
      }
    }

    if (!editingProduct) {
      const license = String(values.get('license') || '').trim();
      if (!license) clientErrors.license = 'Please enter the image license or usage rights.';
      else if (license.length < 3) clientErrors.license = 'License must be at least 3 characters.';

      const sourcePageUrl = String(values.get('sourcePageUrl') || '').trim();
      if (sourcePageUrl) {
        try {
          new URL(sourcePageUrl);
        } catch {
          clientErrors.sourcePageUrl = 'Enter a valid URL (including http:// or https://).';
        }
      }
    }

    const activeVariants = variantDrafts.filter((v) => v.isActive);
    if (!activeVariants.length) {
      clientErrors.variants = 'Keep at least one active package size.';
    }

    const activeDefault = activeVariants.find((v) => v.isDefault);
    if (!activeDefault) {
      clientErrors.variants = 'Select exactly one active package size as the default.';
    } else if (!activeDefault.sku.trim()) {
      clientErrors.sku = 'Please enter a SKU.';
    }

    const seenSkus = new Set<string>();
    variantDrafts.forEach((variant, index) => {
      if (!variant.isActive) return;
      const vSku = variant.sku.trim();
      if (!vSku) {
        clientErrors[`variant_${index}_sku`] = 'Please enter a SKU.';
      } else if (seenSkus.has(vSku)) {
        clientErrors[`variant_${index}_sku`] = 'This SKU is already used by another package size.';
      } else {
        seenSkus.add(vSku);
      }

      const vPrice = Number(variant.price);
      if (!variant.price || isNaN(vPrice) || vPrice <= 0) {
        clientErrors[`variant_${index}_price`] = 'Enter a valid price greater than zero.';
      }

      const vQty = Number(variant.quantity);
      if (!variant.quantity || isNaN(vQty) || vQty <= 0) {
        clientErrors[`variant_${index}_quantity`] = 'Enter a valid package quantity.';
      }

      if (!variant.unit.trim()) {
        clientErrors[`variant_${index}_unit`] = 'Please enter a package unit.';
      }

      if (variant.stock < 0) {
        clientErrors[`variant_${index}_stock`] = 'Stock quantity cannot be negative.';
      }
    });

    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      setError('Please correct the highlighted fields before submitting.');
      setBusy(false);
      return;
    }

    try {
      let upload = cachedUpload?.upload;
      if (hasNewFile && (!cachedUpload || cachedUpload.file !== file)) {
        const uploadData = new FormData();
        uploadData.append('file', file);
        uploadData.append('folder', 'monoprix/products');
        try {
          const result = await apiUpload<{ upload: NonNullable<typeof upload> }>('/admin/images/upload', uploadData);
          upload = result.upload;
          setCachedUpload({ file, upload: result.upload });
        } catch (uploadIssue) {
          if (uploadIssue instanceof ApiError) {
            setFieldErrors({ image: uploadIssue.message });
            throw new Error(`Image upload failed: ${uploadIssue.message}`);
          }
          throw uploadIssue;
        }
      }

      const reviewed = values.get('reviewed') === 'on';
      const defaultVariant = activeDefault!;
      const variants = variantDrafts.map((variant) => ({
        ...variant,
        sku: variant.sku.trim(),
        price: String(variant.price),
        quantity: String(variant.quantity),
      }));

      const sourcePageVal = String(values.get('sourcePageUrl') || '').trim();
      const attributionVal = String(values.get('attribution') || '').trim();
      const brandVal = String(values.get('brand') || '').trim();

      const productInput = {
        sku: defaultVariant.sku.trim(),
        name,
        brand: brandVal || null,
        description,
        categoryId,
        price: String(defaultVariant.price),
        stock: Number(defaultVariant.stock),
        variants,
        altText,
        ...(upload ? {
          imageUrl: upload.imageUrl,
          thumbnailUrl: upload.thumbnailUrl,
          imageSource: 'admin-uploaded-cloudinary',
          cloudinaryPublicId: upload.publicId,
          reviewedAt: reviewed ? new Date().toISOString() : undefined,
          imageStatus: reviewed ? 'APPROVED' as const : 'NEEDS_REVIEW' as const,
        } : {}),
        ...(!editingProduct ? {
          imageSource: 'admin-uploaded-cloudinary',
          sourcePageUrl: sourcePageVal || undefined,
          license: String(values.get('license') || '').trim(),
          attribution: attributionVal || undefined,
          reviewedAt: reviewed ? new Date().toISOString() : undefined,
          imageStatus: reviewed ? 'APPROVED' as const : 'NEEDS_REVIEW' as const,
        } : {}),
      };

      if (editingProduct) {
        await apiPatch(`/admin/products/${editingProduct.id}`, productInput);
      } else {
        await apiPost('/admin/products', productInput);
      }

      form.reset();
      setEditingProduct(null);
      setCachedUpload(null);
      setFieldErrors({});
      setVariantDrafts([emptyVariant()]);
      setNotice(`Product ${editingProduct ? 'updated' : 'saved successfully'}. Its image is visible to customers only if approved.`);
      await loadData();
    } catch (issue) {
      if (issue instanceof ApiError) {
        if (issue.details && Array.isArray(issue.details)) {
          const backendFieldErrors: Record<string, string> = {};
          issue.details.forEach((d) => {
            if (d.path) {
              backendFieldErrors[d.path] = d.message;
              if (d.path.startsWith('variants.')) {
                const parts = d.path.split('.');
                const vIdx = parts[1];
                const vProp = parts[2];
                if (vIdx !== undefined && vProp) {
                  backendFieldErrors[`variant_${vIdx}_${vProp}`] = d.message;
                }
              }
            }
          });
          if (Object.keys(backendFieldErrors).length > 0) {
            setFieldErrors(backendFieldErrors);
          }
        }
        if (issue.code === 'CONFLICT' || issue.status === 409) {
          setFieldErrors((prev) => ({ ...prev, sku: issue.message }));
        }
        setError(issue.message);
      } else {
        setError(issue instanceof Error ? issue.message : 'Product could not be saved.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function changeOrderStatus(orderId: string, status: string) {
    setError('');
    try {
      await apiPatch(`/admin/orders/${orderId}/status`, { status });
      setNotice(`Order ${orderId} updated.`);
      await loadData();
    } catch (issue) {
      setError(issue instanceof ApiError ? issue.message : 'Order status could not be updated.');
      await loadData();
    }
  }

  async function approveImage(productId: string) {
    setError('');
    try {
      await apiPatch(`/admin/products/${productId}`, { imageStatus: 'APPROVED', reviewedAt: new Date().toISOString() });
      setNotice('Image approved and published.');
      await loadData();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Image approval failed.');
    }
  }

  function editProduct(product: Product) {
    const form = productFormRef.current;
    if (!form) return;
    setEditingProduct(product);
    setFieldErrors({});
    (form.elements.namedItem('name') as HTMLInputElement).value = product.name;
    (form.elements.namedItem('brand') as HTMLInputElement).value = product.brand ?? '';
    (form.elements.namedItem('categoryId') as HTMLSelectElement).value = product.categoryId;
    (form.elements.namedItem('description') as HTMLTextAreaElement).value = product.description;
    (form.elements.namedItem('altText') as HTMLInputElement).value = product.altText;
    setVariantDrafts(product.variants.map((variant) => ({ ...variant })));
    (form.elements.namedItem('image') as HTMLInputElement).required = false;
  }

  function resetProductForm() {
    productFormRef.current?.reset();
    const imageInput = productFormRef.current?.elements.namedItem('image');
    if (imageInput instanceof HTMLInputElement) imageInput.required = true;
    setEditingProduct(null);
    setCachedUpload(null);
    setFieldErrors({});
    setVariantDrafts([emptyVariant()]);
  }

  function updateVariant(index: number, patch: Partial<VariantDraft>) {
    setVariantDrafts((current) => current.map((variant, variantIndex) => (
      variantIndex === index ? { ...variant, ...patch } : variant
    )));
  }

  function addVariant() {
    setVariantDrafts((current) => [...current, {
      ...emptyVariant(),
      name: '',
      sku: '',
      price: '',
      isDefault: false,
    }]);
  }

  function removeVariant(index: number) {
    setVariantDrafts((current) => {
      const selected = current[index];
      let next = selected.id
        ? current.map((variant, variantIndex) => (
          variantIndex === index ? { ...variant, isActive: false, isDefault: false } : variant
        ))
        : current.filter((_, variantIndex) => variantIndex !== index);
      if (selected.isDefault) {
        const nextIndex = next.findIndex((variant) => variant.isActive);
        if (nextIndex >= 0) next = next.map((variant, variantIndex) => ({ ...variant, isDefault: variantIndex === nextIndex }));
      }
      return next.length ? next : [emptyVariant()];
    });
  }

  function selectDefaultVariant(index: number) {
    setVariantDrafts((current) => current.map((variant, variantIndex) => ({
      ...variant,
      isDefault: variantIndex === index,
    })));
  }

  async function restoreProduct(productId: string) {
    try {
      await apiPatch(`/admin/products/${productId}`, { isActive: true });
      setNotice('Product restored.');
      await loadData();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Product could not be restored.');
    }
  }

  async function changeUser(userId: string, data: Partial<Pick<ManagedUser, 'role' | 'isActive'>>) {
    try {
      await apiPatch(`/admin/users/${userId}`, data);
      setNotice('Account updated.');
      await loadData();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Account could not be updated.');
    }
  }

  async function createManagedUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await apiPost('/admin/users', {
        name: values.get('name'),
        email: values.get('email'),
        password: values.get('password'),
        role: values.get('role'),
        phone: values.get('phone') || undefined,
      });
      form.reset();
      setNotice('Account created.');
      await loadData();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Account could not be created.');
    }
  }

  async function loadAuditLogs() {
    try {
      const { logs } = await apiGet<{ logs: AuditEntry[] }>('/admin/audit-logs');
      setAuditLogs(logs);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Audit log could not be loaded.');
    }
  }

  async function authorizeRefund(orderId: string) {
    const reason = window.prompt('Reason for authorizing this refund:');
    if (!reason) return;
    try {
      const result = await apiPost<{ authorized: boolean; processed: boolean }>(
        `/admin/orders/${orderId}/refund-authorizations`,
        { reason },
      );
      setNotice(result.authorized && !result.processed
        ? 'Refund authorization recorded. No funds were transferred.'
        : 'Refund authorization could not be confirmed.');
      await loadData();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Refund authorization failed.');
    }
  }

  async function createCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await apiPost('/admin/categories', {
        name: values.get('name'),
        description: values.get('description') || undefined,
      });
      form.reset();
      setNotice('Category created.');
      await loadData();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Category could not be created.');
    }
  }

  async function editCategory(category: Category) {
    const name = window.prompt('Category name:', category.name);
    if (!name) return;
    const description = window.prompt('Category description:', category.description ?? '');
    if (description === null) return;
    try {
      await apiPatch(`/admin/categories/${category.id}`, { name, description });
      setNotice('Category updated.');
      await loadData();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Category could not be updated.');
    }
  }

  async function toggleCategory(category: Category) {
    try {
      await apiPatch(`/admin/categories/${category.id}`, { active: category.active === false });
      setNotice(`Category ${category.active === false ? 'activated' : 'deactivated'}.`);
      await loadData();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Category status could not be changed.');
    }
  }

  async function archiveProduct(productId: string) {
    if (!window.confirm('Archive this product from the customer catalogue?')) return;
    setError('');
    try {
      await apiDelete(`/admin/products/${productId}`);
      setNotice('Product archived.');
      await loadData();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Product could not be archived.');
    }
  }

  async function adjustInventory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setError('');
    try {
      await apiPost('/admin/inventory/adjustments', {
        variantId: values.get('variantId'),
        quantity: Number(values.get('quantity')),
        reason: values.get('reason'),
      });
      setNotice('Inventory adjustment recorded.');
      form.reset();
      await loadData();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Inventory adjustment failed.');
    }
  }

  if (!initialized) return <Layout><main className="container dashboard-page"><div className="skeleton orders-skeleton" /></main></Layout>;
  if (!user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
    return <Layout><main className="container dashboard-page"><div className="empty-state"><h1>Staff access required</h1><p>Sign in with an authorized operations account to continue.</p><Link className="primary-btn" to="/auth">Staff sign in</Link></div></main></Layout>;
  }

  return (
    <Layout>
      <main className="container dashboard-page">
        <div className="section-header admin-heading">
          <div><p className="eyebrow">Monoprix Online · Operations</p><h1>Store dashboard</h1><p className="dashboard-caption">{summary?.demoDataLabel ?? 'Demonstration data'}</p></div>
          <span className="staff-badge">{user.role}</span>
        </div>
        <div className="admin-tabs" role="tablist" aria-label="Operations">
          {(['overview', 'orders', 'products', 'categories', 'inventory', ...(user.role === 'ADMIN' ? ['accounts', 'audit'] as const : [])] as const).map((value) => (
            <button type="button" className={tab === value ? 'admin-tab active' : 'admin-tab'} key={value} onClick={() => {
              setTab(value);
              if (value === 'audit') void loadAuditLogs();
            }}>
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        {notice && <div className="notice" role="status">{notice}</div>}

        {tab === 'overview' && summary && (
          <>
            <section className="stats-grid admin-stats">
              <div className="stat-tile"><span>Total orders</span><strong>{summary.totalOrders}</strong></div>
              <div className="stat-tile"><span>Paid sales</span><strong>{formatSLE(summary.totalSales)}</strong></div>
              <div className="stat-tile"><span>Orders in progress</span><strong>{summary.pendingOrders}</strong></div>
              <div className="stat-tile"><span>Delivered</span><strong>{summary.completedOrders}</strong></div>
            </section>
            <div className="admin-two-column">
              <section className="summary-box">
                <div className="panel-heading"><h2>Recent orders</h2><button className="text-link" onClick={() => setTab('orders')}>View all</button></div>
                <div className="table-scroll"><table><thead><tr><th>Reference</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead><tbody>
                  {summary.recentOrders.map((order) => <tr key={order.id}><td>{order.id}</td><td>{order.customer}</td><td>{formatSLE(order.total)}</td><td>{order.status.replaceAll('_', ' ')}</td></tr>)}
                </tbody></table></div>
              </section>
              <section className="summary-box">
                <h2>Low stock watch</h2>
                {summary.lowStockProducts.length ? (
                  <ul className="stock-watch">{summary.lowStockProducts.map((item) => <li key={item.id}><span>{item.name}</span><strong>{item.stock} left</strong></li>)}</ul>
                ) : <p>No low-stock products.</p>}
              </section>
            </div>
          </>
        )}

        {tab === 'orders' && (
          <section className="summary-box">
            <div className="panel-heading"><h2>Order queue</h2><span>{orders.length} recent orders</span></div>
            <div className="table-scroll"><table><thead><tr><th>Order</th><th>Customer</th><th>Phone</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead><tbody>
              {orders.map((order) => <tr key={order.id}>
                <td>{order.id}</td><td>{order.customerName}</td><td>{order.phone}</td><td>{formatSLE(order.total)}</td><td>{order.paymentStatus}</td>
                <td>
                  <select aria-label={`Update status for order ${order.id}`} value={order.status} disabled={orderTransitions[order.status]?.length === 0} onChange={(event) => changeOrderStatus(order.id, event.target.value)}>
                    {[order.status, ...(orderTransitions[order.status] ?? []).filter((status) => (
                      status !== 'CANCELLED' || user.role === 'ADMIN' && order.paymentStatus === 'PENDING'
                    ))].map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
                  </select>
                  {user.role === 'ADMIN' && order.paymentStatus === 'PAID' && <button className="text-button" onClick={() => authorizeRefund(order.id)}>Authorize refund</button>}
                </td>
              </tr>)}
            </tbody></table></div>
          </section>
        )}

        {tab === 'products' && (
          <div className="admin-two-column product-admin-layout">
            <section className="summary-box">
              <div className="panel-heading"><h2>Catalogue management</h2><span>{products.length} items</span></div>
              <div className="table-scroll"><table><thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Image</th><th>Actions</th></tr></thead><tbody>
                {products.map((product) => <tr key={product.id}>
                  <td><strong>{product.name}</strong><small>{product.category.name}{product.brand ? ` · ${product.brand}` : ''}</small></td>
                  <td>{product.variants.filter((variant) => variant.isActive).length} package sizes</td><td>{product.variants.reduce((total, variant) => total + (variant.isActive ? variant.stock : 0), 0)} units</td><td><span className={product.imageStatus === 'APPROVED' ? 'status-approved' : 'status-review'}>{product.imageStatus.replaceAll('_', ' ')}</span></td>
                  <td className="table-actions">
                    <button className="text-button" onClick={() => editProduct(product)}>Edit</button>
                    {product.imageStatus !== 'APPROVED' && <button className="text-button" onClick={() => approveImage(product.id)}>Approve image</button>}
                    {user.role === 'ADMIN' && (product.isActive
                      ? <button className="text-button danger-text" onClick={() => archiveProduct(product.id)}>Archive</button>
                      : <button className="text-button" onClick={() => restoreProduct(product.id)}>Restore</button>)}
                  </td>
                </tr>)}
              </tbody></table></div>
            </section>
            <section className="summary-box">
              <h2>{editingProduct ? `Edit ${editingProduct.name}` : 'Add a product'}</h2>
              <form ref={productFormRef} className="form-grid admin-form" onSubmit={submitProduct} noValidate>
                <label className={`field ${fieldErrors.name ? 'has-error' : ''}`}>
                  <span>Product name</span>
                  <input name="name" maxLength={160} onChange={() => clearFieldError('name')} aria-invalid={Boolean(fieldErrors.name)} />
                  {fieldErrors.name && <span className="field-error" role="alert">{fieldErrors.name}</span>}
                </label>
                <label className={`field ${fieldErrors.brand ? 'has-error' : ''}`}>
                  <span>Brand <small>(optional)</small></span>
                  <input name="brand" maxLength={100} onChange={() => clearFieldError('brand')} aria-invalid={Boolean(fieldErrors.brand)} />
                  {fieldErrors.brand && <span className="field-error" role="alert">{fieldErrors.brand}</span>}
                </label>
                <label className={`field ${fieldErrors.categoryId ? 'has-error' : ''}`}>
                  <span>Category</span>
                  <select name="categoryId" defaultValue="" onChange={() => clearFieldError('categoryId')} aria-invalid={Boolean(fieldErrors.categoryId)}>
                    <option value="" disabled>Select category</option>
                    {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                  {fieldErrors.categoryId && <span className="field-error" role="alert">{fieldErrors.categoryId}</span>}
                </label>
                <section className="variant-editor" aria-label="Product package sizes">
                  <div className="panel-heading">
                    <h3>Package sizes and prices</h3>
                    <button type="button" className="text-button" onClick={addVariant}>Add package size</button>
                  </div>
                  {fieldErrors.variants && <p className="field-error" role="alert">{fieldErrors.variants}</p>}
                  {variantDrafts.map((variant, index) => (
                    <fieldset className={variant.isActive ? 'variant-row' : 'variant-row variant-inactive'} key={variant.id ?? `new-${index}`}>
                      <legend>{variant.name || `Package size ${index + 1}`}{variant.isActive ? '' : ' · inactive'}</legend>
                      <div className="variant-fields">
                        <label className={`field ${fieldErrors[`variant_${index}_name`] ? 'has-error' : ''}`}>
                          <span>Variant name</span>
                          <input value={variant.name} disabled={!variant.isActive} maxLength={100} onChange={(event) => { updateVariant(index, { name: event.target.value }); clearFieldError(`variant_${index}_name`); }} placeholder="Half dozen" />
                          {fieldErrors[`variant_${index}_name`] && <span className="field-error" role="alert">{fieldErrors[`variant_${index}_name`]}</span>}
                        </label>
                        <label className={`field ${fieldErrors[`variant_${index}_quantity`] ? 'has-error' : ''}`}>
                          <span>Package quantity</span>
                          <input type="number" min="0.001" step="0.001" value={variant.quantity} disabled={!variant.isActive} onChange={(event) => { updateVariant(index, { quantity: event.target.value }); clearFieldError(`variant_${index}_quantity`); }} />
                          {fieldErrors[`variant_${index}_quantity`] && <span className="field-error" role="alert">{fieldErrors[`variant_${index}_quantity`]}</span>}
                        </label>
                        <label className={`field ${fieldErrors[`variant_${index}_unit`] ? 'has-error' : ''}`}>
                          <span>Unit</span>
                          <input value={variant.unit} disabled={!variant.isActive} maxLength={40} onChange={(event) => { updateVariant(index, { unit: event.target.value }); clearFieldError(`variant_${index}_unit`); }} placeholder="pieces, kg, litre" />
                          {fieldErrors[`variant_${index}_unit`] && <span className="field-error" role="alert">{fieldErrors[`variant_${index}_unit`]}</span>}
                        </label>
                        <label className={`field ${fieldErrors[`variant_${index}_sku`] || (variant.isDefault && fieldErrors.sku) ? 'has-error' : ''}`}>
                          <span>SKU</span>
                          <input value={variant.sku} disabled={!variant.isActive} maxLength={50} onChange={(event) => { updateVariant(index, { sku: event.target.value }); clearFieldError(`variant_${index}_sku`); clearFieldError('sku'); }} />
                          {(fieldErrors[`variant_${index}_sku`] || (variant.isDefault && fieldErrors.sku)) && (
                            <span className="field-error" role="alert">{fieldErrors[`variant_${index}_sku`] || (variant.isDefault && fieldErrors.sku)}</span>
                          )}
                        </label>
                        <label className={`field ${fieldErrors[`variant_${index}_price`] || (variant.isDefault && fieldErrors.price) ? 'has-error' : ''}`}>
                          <span>Price · SLE</span>
                          <input type="number" min="0.01" step="0.01" value={variant.price} disabled={!variant.isActive} onChange={(event) => { updateVariant(index, { price: event.target.value }); clearFieldError(`variant_${index}_price`); clearFieldError('price'); }} />
                          {(fieldErrors[`variant_${index}_price`] || (variant.isDefault && fieldErrors.price)) && (
                            <span className="field-error" role="alert">{fieldErrors[`variant_${index}_price`] || (variant.isDefault && fieldErrors.price)}</span>
                          )}
                        </label>
                        <label className={`field ${fieldErrors[`variant_${index}_stock`] || (variant.isDefault && fieldErrors.stock) ? 'has-error' : ''}`}>
                          <span>Stock</span>
                          <input type="number" min="0" max="100000" step="1" value={variant.stock} disabled={!variant.isActive} onChange={(event) => { updateVariant(index, { stock: Number(event.target.value) }); clearFieldError(`variant_${index}_stock`); clearFieldError('stock'); }} />
                          {(fieldErrors[`variant_${index}_stock`] || (variant.isDefault && fieldErrors.stock)) && (
                            <span className="field-error" role="alert">{fieldErrors[`variant_${index}_stock`] || (variant.isDefault && fieldErrors.stock)}</span>
                          )}
                        </label>
                      </div>
                      <div className="variant-actions">
                        <label className="review-check"><input type="radio" name="defaultVariant" checked={variant.isDefault} disabled={!variant.isActive} onChange={() => selectDefaultVariant(index)} /> Default package</label>
                        <label className="review-check"><input type="checkbox" checked={variant.isActive} onChange={(event) => updateVariant(index, { isActive: event.target.checked, isDefault: event.target.checked && !variantDrafts.some((entry) => entry.isDefault && entry.isActive) })} /> Active</label>
                        <button type="button" className="text-button danger-text" onClick={() => removeVariant(index)}>{variant.id ? 'Deactivate' : 'Remove'}</button>
                      </div>
                    </fieldset>
                  ))}
                </section>
                <label className={`field ${fieldErrors.description ? 'has-error' : ''}`}>
                  <span>Description</span>
                  <textarea name="description" rows={3} onChange={() => clearFieldError('description')} aria-invalid={Boolean(fieldErrors.description)} />
                  {fieldErrors.description && <span className="field-error" role="alert">{fieldErrors.description}</span>}
                </label>
                <label className={`field ${fieldErrors.image ? 'has-error' : ''}`}>
                  <span>Replace product image <small>(JPEG, PNG or WebP; up to 10 MB)</small></span>
                  <input name="image" type="file" accept="image/jpeg,image/png,image/webp" onChange={() => clearFieldError('image')} aria-invalid={Boolean(fieldErrors.image)} />
                  {cachedUpload && !editingProduct && (
                    <small style={{ color: '#2d6a4f', marginTop: '4px' }}>✓ Image uploaded to Cloudinary: {cachedUpload.upload.publicId}</small>
                  )}
                  {fieldErrors.image && <span className="field-error" role="alert">{fieldErrors.image}</span>}
                </label>
                <label className={`field ${fieldErrors.altText ? 'has-error' : ''}`}>
                  <span>Image alt text</span>
                  <input name="altText" maxLength={250} onChange={() => clearFieldError('altText')} aria-invalid={Boolean(fieldErrors.altText)} />
                  {fieldErrors.altText && <span className="field-error" role="alert">{fieldErrors.altText}</span>}
                </label>
                {!editingProduct && <>
                  <label className={`field ${fieldErrors.sourcePageUrl ? 'has-error' : ''}`}>
                    <span>Source page (if applicable)</span>
                    <input name="sourcePageUrl" type="url" onChange={() => clearFieldError('sourcePageUrl')} aria-invalid={Boolean(fieldErrors.sourcePageUrl)} />
                    {fieldErrors.sourcePageUrl && <span className="field-error" role="alert">{fieldErrors.sourcePageUrl}</span>}
                  </label>
                  <label className={`field ${fieldErrors.license ? 'has-error' : ''}`}>
                    <span>Image license / usage rights</span>
                    <input name="license" maxLength={500} onChange={() => clearFieldError('license')} aria-invalid={Boolean(fieldErrors.license)} />
                    {fieldErrors.license && <span className="field-error" role="alert">{fieldErrors.license}</span>}
                  </label>
                  <label className={`field ${fieldErrors.attribution ? 'has-error' : ''}`}>
                    <span>Attribution</span>
                    <input name="attribution" maxLength={500} onChange={() => clearFieldError('attribution')} aria-invalid={Boolean(fieldErrors.attribution)} />
                    {fieldErrors.attribution && <span className="field-error" role="alert">{fieldErrors.attribution}</span>}
                  </label>
                </>}
                <label className="review-check"><input name="reviewed" type="checkbox" /> I verified this image matches this item and usage rights allow publication.</label>
                <button className="primary-btn" disabled={busy}>{busy ? 'Saving product…' : editingProduct ? 'Save product changes' : 'Upload and save product'}</button>
                {editingProduct && <button type="button" className="ghost-btn" onClick={resetProductForm}>Cancel editing</button>}
                <p className="summary-note">Images are validated by the API before being sent to Cloudinary. Unreviewed images remain hidden from customers.</p>
              </form>
            </section>
          </div>
        )}

        {tab === 'categories' && (
          <section className="summary-box">
            <h2>Categories</h2>
            {user.role === 'ADMIN' && (
              <form className="form-grid admin-form" onSubmit={createCategory}>
                <label className="field"><span>Category name</span><input name="name" minLength={2} maxLength={100} required /></label>
                <label className="field"><span>Description</span><input name="description" maxLength={500} /></label>
                <button className="primary-btn">Create category</button>
              </form>
            )}
            <div className="table-scroll"><table><thead><tr><th>Name</th><th>Status</th>{user.role === 'ADMIN' && <th>Actions</th>}</tr></thead><tbody>
              {categories.map((category) => <tr key={category.id}>
                <td>{category.name}</td><td>{category.active === false ? 'Inactive' : 'Active'}</td>
                {user.role === 'ADMIN' && <td className="table-actions">
                  <button className="text-button" onClick={() => editCategory(category)}>Edit</button>
                  <button className="text-button" onClick={() => toggleCategory(category)}>{category.active === false ? 'Activate' : 'Deactivate'}</button>
                </td>}
              </tr>)}
            </tbody></table></div>
          </section>
        )}

        {tab === 'inventory' && (
          <div className="admin-two-column">
            <section className="summary-box">
              <h2>Current inventory</h2>
              <div className="table-scroll"><table><thead><tr><th>SKU</th><th>Product / package</th><th>Category</th><th>Units</th></tr></thead><tbody>
                {products.filter((product) => product.isActive).flatMap((product) => product.variants.filter((variant) => variant.isActive).map((variant) => (
                  <tr key={variant.id ?? variant.sku}><td>{variant.sku}</td><td>{product.name} · {variant.name} ({variant.quantity} {variant.unit})</td><td>{product.category.name}</td><td>{variant.stock}</td></tr>
                )))}
              </tbody></table></div>
            </section>
            <section className="summary-box">
              <h2>Record a stock adjustment</h2>
              <form className="form-grid admin-form" onSubmit={adjustInventory}>
                <label className="field"><span>Package size</span><select name="variantId" required defaultValue=""><option value="" disabled>Select product package</option>{products.filter((product) => product.isActive).flatMap((product) => product.variants.filter((variant) => variant.isActive).map((variant) => <option key={variant.id ?? variant.sku} value={variant.id}>{product.name} · {variant.name} · {variant.stock} in stock</option>))}</select></label>
                <label className="field"><span>Quantity change</span><input name="quantity" type="number" step="1" required placeholder="Use a negative number to reduce" /></label>
                <label className="field"><span>Reason</span><textarea name="reason" minLength={3} maxLength={300} required /></label>
                <button className="primary-btn">Save audited adjustment</button>
              </form>
              <p className="summary-note">Stock adjustments are recorded with the staff account and reason. Negative stock is rejected.</p>
            </section>
          </div>
        )}

        {tab === 'accounts' && user.role === 'ADMIN' && (
          <div className="admin-two-column">
            <section className="summary-box">
              <h2>Customer and staff accounts</h2>
              <div className="table-scroll"><table><thead><tr><th>Account</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>
                {users.map((account) => <tr key={account.id}>
                  <td>{account.name}<small>{account.email}</small></td>
                  <td><select aria-label={`Role for ${account.email}`} value={account.role} disabled={account.id === user.id} onChange={(event) => changeUser(account.id, { role: event.target.value as ManagedUser['role'] })}>
                    {accountRoles.map((role) => <option key={role} value={role}>{role}</option>)}
                  </select></td>
                  <td>{account.isActive ? 'Active' : 'Inactive'}</td>
                  <td><button className="text-button" disabled={account.id === user.id} onClick={() => changeUser(account.id, { isActive: !account.isActive })}>{account.isActive ? 'Deactivate' : 'Activate'}</button></td>
                </tr>)}
              </tbody></table></div>
            </section>
            <section className="summary-box">
              <h2>Create account</h2>
              <form className="form-grid admin-form" onSubmit={createManagedUser}>
                <label className="field"><span>Name</span><input name="name" minLength={2} maxLength={100} required /></label>
                <label className="field"><span>Email</span><input name="email" type="email" maxLength={254} required /></label>
                <label className="field"><span>Temporary password</span><input name="password" type="password" minLength={12} maxLength={128} required /></label>
                <label className="field"><span>Phone</span><input name="phone" maxLength={30} /></label>
                <label className="field"><span>Role</span><select name="role" defaultValue="CUSTOMER">{accountRoles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
                <button className="primary-btn">Create account</button>
              </form>
            </section>
          </div>
        )}

        {tab === 'audit' && user.role === 'ADMIN' && (
          <section className="summary-box">
            <div className="panel-heading"><h2>Administrative audit log</h2><button className="text-button" onClick={loadAuditLogs}>Refresh</button></div>
            <div className="table-scroll"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead><tbody>
              {auditLogs.map((entry) => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString()}</td><td>{entry.user?.name ?? 'System'}</td><td>{entry.action}</td><td>{entry.details}</td></tr>)}
            </tbody></table></div>
          </section>
        )}
      </main>
    </Layout>
  );
}
