import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { ProductCard, type StoreProduct } from '../components/ProductCard';
import { apiGet } from '../lib/api';

type Category = { id: string; name: string; slug: string };

export function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const query = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const sort = params.get('sort') ?? 'newest';
  const minPrice = params.get('minPrice') ?? '';
  const maxPrice = params.get('maxPrice') ?? '';

  useEffect(() => {
    apiGet<{ categories: Category[] }>('/categories')
      .then(({ categories: result }) => setCategories(result))
      .catch((issue: unknown) => console.error('Unable to load categories:', issue));
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const search = new URLSearchParams({ page: String(page), limit: '20', sort });
    if (query) search.set('q', query);
    if (category) search.set('category', category);
    if (minPrice) search.set('minPrice', minPrice);
    if (maxPrice) search.set('maxPrice', maxPrice);
    apiGet<{ products: CatalogProduct[]; pagination: { pages: number } }>(`/products?${search}`)
      .then((result) => {
        if (active) {
          setProducts(result.products);
          setPages(Math.max(result.pagination.pages, 1));
        }
      })
      .catch((issue: unknown) => {
        if (active) setError(issue instanceof Error ? issue.message : 'Products could not be loaded.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [category, maxPrice, minPrice, page, query, sort]);

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setPage(1);
    setParams(next);
  }

  return (
    <Layout>
      <main className="container catalog-page">
        <div className="section-header catalog-heading">
          <div><p className="eyebrow">Monoprix Online · Demonstration catalogue</p><h1>Good things for your table.</h1></div>
          <p>Sample product names and SLE prices for demonstration only.</p>
        </div>
        <div className="catalog-layout">
          <aside className="catalog-filters">
            <h2>Refine your shop</h2>
            <label className="field">
              <span>Search products</span>
              <input value={query} onChange={(event) => updateParam('q', event.target.value)} placeholder="Try rice or juice" />
            </label>
            <label className="field">
              <span>Category</span>
              <select value={category} onChange={(event) => updateParam('category', event.target.value)}>
                <option value="">All categories</option>
                {categories.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Sort by</span>
              <select value={sort} onChange={(event) => updateParam('sort', event.target.value)}>
                <option value="newest">Recently added</option>
                <option value="price-asc">Price: low to high</option>
                <option value="price-desc">Price: high to low</option>
                <option value="name">Name</option>
              </select>
            </label>
            <div className="price-filters">
              <label className="field"><span>Minimum SLE</span><input type="number" min="0" value={minPrice} onChange={(event) => updateParam('minPrice', event.target.value)} /></label>
              <label className="field"><span>Maximum SLE</span><input type="number" min="0" value={maxPrice} onChange={(event) => updateParam('maxPrice', event.target.value)} /></label>
            </div>
          </aside>
          <section className="catalog-results" aria-live="polite">
            {notice && <p className="notice" role="status">{notice}</p>}
            {loading && <div className="product-grid">{Array.from({ length: 8 }, (_, index) => <div key={index} className="skeleton product-skeleton" />)}</div>}
            {!loading && error && <div className="notice notice-error">{error}</div>}
            {!loading && !error && !products.length && <div className="empty-state"><h2>No products found</h2><p>Try a different search or remove some filters.</p></div>}
            {!loading && !error && products.length > 0 && (
              <>
                <div className="product-grid">
                  {products.map((product) => (
                    <ProductCard key={product.id} product={product} onNotice={setNotice} />
                  ))}
                </div>
                <nav className="pagination" aria-label="Product pages">
                  <button className="ghost-btn" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button>
                  <span>Page {page} of {pages}</span>
                  <button className="ghost-btn" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>Next</button>
                </nav>
              </>
            )}
          </section>
        </div>
      </main>
    </Layout>
  );
}
