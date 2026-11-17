import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { apiGet } from '../lib/api';

const categoryImageTransform = 'f_auto,q_auto,c_fill,w_640,h_480,dpr_auto';

function cloudinaryCategoryImage(asset: string) {
  return asset.replace('/image/upload/', `/image/upload/${categoryImageTransform}/`);
}

type Category = { id: string; name: string; slug: string };

const categoryImages: Record<string, string> = {
  'fruits-vegetables': 'https://res.cloudinary.com/ktez00jf/image/upload/Fruits_Vegetables.jpg',
  'food-groceries': 'https://res.cloudinary.com/ktez00jf/image/upload/Food_Groceries.jpg',
  beverages: 'https://res.cloudinary.com/ktez00jf/image/upload/v1794135160/Beverages.jpg',
  'snacks-confectionery': 'https://res.cloudinary.com/ktez00jf/image/upload/v1794135146/Snacks_Confectionery.jpg',
  'dairy-eggs': 'https://res.cloudinary.com/ktez00jf/image/upload/Dairy_Eggs.jpg',
  'personal-care': 'https://res.cloudinary.com/ktez00jf/image/upload/v1794135133/Personal_Care.jpg',
  'household-cleaning': 'https://res.cloudinary.com/ktez00jf/image/upload/Household_Cleaning.jpg',
  'baby-products': 'https://res.cloudinary.com/ktez00jf/image/upload/Baby_Products.jpg',
};

export function CategoryCards() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiGet<{ categories: Category[] }>('/categories')
      .then(({ categories: rows }) => setCategories(rows))
      .catch((issue: unknown) => {
        console.error('Unable to load homepage categories:', issue);
        setError('We could not load categories. Browse the catalogue for available products.');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="category-grid" aria-label="Loading categories">{Array.from({ length: 4 }, (_, index) => <div key={index} className="skeleton category-skeleton" />)}</div>;
  if (error) return <p className="notice notice-error" role="alert">{error}</p>;
  if (categories.length === 0) return <div className="empty-state"><p>No categories are available right now.</p></div>;

  return (
    <nav className="category-grid" aria-label="Shop by category">
      {categories.map((category) => (
        <Link key={category.slug} to={`/catalog?category=${category.slug}`} className="category-card">
          <img
            className="category-card-image"
            src={cloudinaryCategoryImage(categoryImages[category.slug] ?? 'https://res.cloudinary.com/ktez00jf/image/upload/Everyday_Ensentials.jpg')}
            alt={`${category.name} shopping category`}
            width="640"
            height="480"
            loading="lazy"
            decoding="async"
          />
          <h3>{category.name}</h3>
          <span className="text-link">Browse aisle <ArrowRight size={15} aria-hidden="true" /></span>
        </Link>
      ))}
    </nav>
  );
}
