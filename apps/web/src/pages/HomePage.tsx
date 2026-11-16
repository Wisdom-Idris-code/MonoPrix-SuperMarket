import { useEffect, useState } from 'react';
import { ArrowRight, ShieldCheck, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { CategoryCards } from '../components/CategoryCards';
import { ProductCard, type StoreProduct } from '../components/ProductCard';
import { apiGet } from '../lib/api';

export function HomePage() {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    apiGet<{ products: StoreProduct[] }>('/products?limit=4&sort=newest')
      .then(({ products: rows }) => setProducts(rows))
      .catch(() => setError('We could not load featured products. Please try the catalogue.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Layout>
      <div className="demo-banner">Independent online shopping · Monoprix Supermarket catalogue and prices</div>
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="promo-chip">Freetown grocery delivery</span>
            <h1>Better groceries for every day.</h1>
            <p>Discover pantry staples, fresh produce and home essentials in one considered shopping experience, built for Sierra Leone.</p>
            <div className="hero-actions">
              <Link to="/catalog" className="primary-btn">Explore the catalogue <ArrowRight size={16} aria-hidden="true" /></Link>
              <Link to="/auth" className="secondary-btn">Your account</Link>
            </div>
            <div className="hero-perks">
              <span><Truck size={17} aria-hidden="true" /> Delivery across Freetown</span>
              <span><ShieldCheck size={17} aria-hidden="true" /> Clear demo checkout</span>
            </div>
          </div>
          <div className="hero-panel hero-image-panel">
            <img
              className="hero-main-image"
              src="https://res.cloudinary.com/ktez00jf/image/upload/f_auto,q_auto,w_1200,dpr_auto/v1794149273/Everyday_Ensentials.jpg"
              alt="A shopper choosing fresh produce in a supermarket"
              width="1200"
              height="1200"
              loading="eager"
              decoding="async"
            />
            <div className="hero-card">
              <span className="promo-chip">The weekly shop</span>
              <h2>Everyday essentials, made easy.</h2>
              <p>Browse a curated selection with transparent pricing and real stock checks.</p>
              <Link className="text-link" to="/catalog">Shop all groceries <ArrowRight size={16} /></Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section container">
        <div className="section-header">
          <div><p className="eyebrow">Explore the aisles</p><h2>Shop by category</h2></div>
          <Link to="/catalog" className="text-link">View all products <ArrowRight size={16} /></Link>
        </div>
        <CategoryCards />
      </section>

      <section className="section container">
        <div className="section-header">
          <div><p className="eyebrow">Selected for your pantry</p><h2>Popular this week</h2></div>
          <Link to="/catalog" className="text-link">Browse catalogue <ArrowRight size={16} /></Link>
        </div>
        {loading && <div className="product-grid">{Array.from({ length: 4 }, (_, index) => <div key={index} className="skeleton product-skeleton" />)}</div>}
        {!loading && error && <div className="notice notice-error">{error}</div>}
        {!loading && !error && (
          <div className="product-grid">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} onNotice={setNotice} />
            ))}
          </div>
        )}
        {notice && <p className="notice" role="status">{notice}</p>}
      </section>

      <section className="weekly-offer">
        <div className="container offer-content">
          <div>
            <p className="eyebrow">Good food, thoughtful value</p>
            <h2>A better way to stock up.</h2>
            <p>Explore weekly picks across fresh, pantry and household essentials.</p>
          </div>
          <Link to="/catalog?sort=price-asc" className="secondary-btn">See weekly picks <ArrowRight size={16} /></Link>
        </div>
      </section>
    </Layout>
  );
}
