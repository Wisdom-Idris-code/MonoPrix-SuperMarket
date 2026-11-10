import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const categoryImageTransform = 'f_auto,q_auto,c_fill,w_640,h_480,dpr_auto';

function cloudinaryCategoryImage(asset: string) {
  return asset.replace('/image/upload/', `/image/upload/${categoryImageTransform}/`);
}

const categories = [
  {
    name: 'Fruits & Vegetables',
    slug: 'fruits-vegetables',
    image: 'https://res.cloudinary.com/ktez00jf/image/upload/Fruits_Vegetables.jpg',
    alt: 'Fresh fruits and vegetables for everyday meals',
  },
  {
    name: 'Food & Groceries',
    slug: 'food-groceries',
    image: 'https://res.cloudinary.com/ktez00jf/image/upload/Food_Groceries.jpg',
    alt: 'Rice, grains and grocery staples',
  },
  {
    name: 'Beverages',
    slug: 'beverages',
    image: 'https://res.cloudinary.com/ktez00jf/image/upload/v1794135160/Beverages.jpg',
    alt: 'A selection of cold drinks and beverages',
  },
  {
    name: 'Snacks & Confectionery',
    slug: 'snacks-confectionery',
    image: 'https://res.cloudinary.com/ktez00jf/image/upload/v1794135146/Snacks_Confectionery.jpg',
    alt: 'Biscuits, sweets and snack foods',
  },
  {
    name: 'Dairy & Eggs',
    slug: 'dairy-eggs',
    image: 'https://res.cloudinary.com/ktez00jf/image/upload/Dairy_Eggs.jpg',
    alt: 'Milk, dairy products and eggs',
  },
  {
    name: 'Personal Care',
    slug: 'personal-care',
    image: 'https://res.cloudinary.com/ktez00jf/image/upload/v1794135133/Personal_Care.jpg',
    alt: 'Personal care and hygiene products',
  },
  {
    name: 'Household & Cleaning',
    slug: 'household-cleaning',
    image: 'https://res.cloudinary.com/ktez00jf/image/upload/Household_Cleaning.jpg',
    alt: 'Household cleaning products and supplies',
  },
  {
    name: 'Baby Products',
    slug: 'baby-products',
    image: 'https://res.cloudinary.com/ktez00jf/image/upload/Baby_Products.jpg',
    alt: 'Baby care products and essentials',
  },
];

export function CategoryCards() {
  return (
    <nav className="category-grid" aria-label="Shop by category">
      {categories.map((category) => (
        <Link key={category.slug} to={`/catalog?category=${category.slug}`} className="category-card">
          <img
            className="category-card-image"
            src={cloudinaryCategoryImage(category.image)}
            alt={category.alt}
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
