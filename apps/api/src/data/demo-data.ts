export type CategorySeed = {
  name: string;
  slug: string;
  description: string;
  imageUrl: string;
};

export type ProductSeed = {
  sku: string;
  name: string;
  slug: string;
  description: string;
  categorySlug: string;
  price: number;
  compareAtPrice?: number;
  stock: number;
  isActive: boolean;
  imageUrl: string;
  altText: string;
  imageSource: string;
  sourcePageUrl?: string;
  license: string;
  attribution?: string;
  cloudinaryPublicId?: string;
  reviewedAt?: Date;
  imageStatus: string;
};

export const categories: CategorySeed[] = [
  { name: 'Fresh produce', slug: 'fresh-produce', description: 'Farm-fresh fruits and vegetables', imageUrl: '/api/v1/assets/category/fresh-produce.svg' },
  { name: 'Rice and grains', slug: 'rice-and-grains', description: 'Staples for everyday meals', imageUrl: '/api/v1/assets/category/rice-and-grains.svg' },
  { name: 'Cooking oils', slug: 'cooking-oils', description: 'Premium oils for home cooking', imageUrl: '/api/v1/assets/category/cooking-oils.svg' },
  { name: 'Dairy', slug: 'dairy', description: 'Milk, cheese and yoghurts', imageUrl: '/api/v1/assets/category/dairy.svg' },
  { name: 'Beverages', slug: 'beverages', description: 'Refreshing drinks and hydration', imageUrl: '/api/v1/assets/category/beverages.svg' },
  { name: 'Snacks', slug: 'snacks', description: 'Quick bites and family favourites', imageUrl: '/api/v1/assets/category/snacks.svg' },
  { name: 'Cereal', slug: 'cereal', description: 'Breakfast cereals and grains', imageUrl: '/api/v1/assets/category/cereal.svg' },
  { name: 'Bakery', slug: 'bakery', description: 'Fresh breads and pastries', imageUrl: '/api/v1/assets/category/bakery.svg' },
  { name: 'Meat and poultry', slug: 'meat-and-poultry', description: 'Fresh meat and poultry selections', imageUrl: '/api/v1/assets/category/meat-and-poultry.svg' },
  { name: 'Fish and seafood', slug: 'fish-and-seafood', description: 'Fresh and frozen fish selections', imageUrl: '/api/v1/assets/category/fish-and-seafood.svg' },
  { name: 'Household', slug: 'household', description: 'Essential homecare products', imageUrl: '/api/v1/assets/category/household.svg' },
  { name: 'Personal care', slug: 'personal-care', description: 'Everyday wellness essentials', imageUrl: '/api/v1/assets/category/personal-care.svg' },
  { name: 'Frozen foods', slug: 'frozen-foods', description: 'Convenience and freezer staples', imageUrl: '/api/v1/assets/category/frozen-foods.svg' },
];

const productBase = (slug: string, title: string, category: string, price: number, stock: number, description: string, _alt: string) => ({
  sku: `MON-${slug}`,
  name: title,
  slug,
  description,
  categorySlug: category,
  price,
  compareAtPrice: Math.round(price * 1.18),
  stock,
  isActive: true,
  imageUrl: `/api/v1/assets/product/${slug}.svg`,
  altText: `${title} placeholder; approved product image needed`,
  imageSource: 'internal-neutral-placeholder',
  license: 'Original neutral placeholder illustration; not a product photograph or commercial package.',
  attribution: 'Monoprix Online concept demonstration',
  imageStatus: 'NEEDS_IMAGE',
  cloudinaryPublicId: undefined,
  reviewedAt: new Date('2024-01-15T00:00:00.000Z'),
});

export const productCatalog: ProductSeed[] = [
  productBase('royal-rice-5kg', 'Royal Rice 5kg', 'rice-and-grains', 185000, 42, 'Premium long-grain rice for everyday family meals and traditional dishes.', 'Royal rice bag in a grocery context'),
  productBase('parboiled-rice-10kg', 'Parboiled Rice 10kg', 'rice-and-grains', 340000, 28, 'High-yield parboiled rice for large households and bulk meal prep.', 'Large bag of parboiled rice'),
  productBase('golden-cooking-oil-1l', 'Golden Cooking Oil 1L', 'cooking-oils', 56000, 50, 'Refined cooking oil crafted for flavour and consistent frying performance.', 'Bottle of golden cooking oil'),
  productBase('sunrise-olive-oil-500ml', 'Sunrise Olive Oil 500ml', 'cooking-oils', 48000, 34, 'Extra virgin olive oil for salad dressings, roasting and general cooking.', 'Olive oil bottle on a kitchen counter'),
  productBase('whole-milk-1l', 'Whole Milk 1L', 'dairy', 22000, 66, 'Fresh dairy milk with a smooth and creamy finish for tea, cereal and cooking.', 'Fresh whole milk carton'),
  productBase('yogurt-cup-450g', 'Yogurt Cup 450g', 'dairy', 18000, 58, 'Protein-rich yogurt with a mild tang and natural freshness.', 'Cup of yogurt with fruit topping'),
  productBase('fresh-apple-pack', 'Fresh Apple Pack', 'fresh-produce', 28000, 90, 'Crisp, juicy apples ideal for snacking, lunch boxes and fruit salads.', 'Fresh apple pack on display'),
  productBase('watermelon-slice', 'Watermelon Slice', 'fresh-produce', 35000, 75, 'Sweet tropical melon ideal for family servings and fruit platters.', 'Fresh sliced watermelon'),
  productBase('green-plantain', 'Green Plantain', 'fresh-produce', 24000, 80, 'Firm and versatile plantain suited to frying, boiling and stew recipes.', 'Fresh green plantains in a basket'),
  productBase('orange-juice-1l', 'Orange Juice 1L', 'beverages', 30000, 52, 'Refreshing citrus drink with a bright flavour profile and no added preservatives.', 'Orange juice carton'),
  productBase('mango-drink-600ml', 'Mango Drink 600ml', 'beverages', 22000, 62, 'Fruit-forward tropical beverage for quick refreshment on the go.', 'Mango drink bottle'),
  productBase('still-water-750ml', 'Still Water 750ml', 'beverages', 12000, 120, 'Pure drinking water for home and office hydration needs.', 'Pure water bottle'),
  productBase('plantain-chips', 'Plantain Chips', 'snacks', 16000, 88, 'Crisp savoury chips for a satisfying midday snack or party platter.', 'Bags of seasoned plantain chips'),
  productBase('peanut-butter-crackers', 'Peanut Butter Crackers', 'snacks', 19000, 68, 'Crunchy snack biscuits with a smooth peanut butter finish.', 'Crackers and peanut butter snack pack'),
  productBase('coconut-biscuits', 'Coconut Biscuits', 'snacks', 15000, 95, 'Soft-baked biscuits with a lightly sweet coconut flavour.', 'Coconut biscuits in a tin'),
  productBase('brown-bread-loaf', 'Brown Bread Loaf', 'bakery', 21000, 60, 'Soft wholemeal loaf perfect for sandwiches and breakfast toast.', 'Brown bread loaf on a board'),
  productBase('sourdough-slice', 'Sourdough Slice', 'bakery', 27000, 46, 'Artisan loaf with a rich crust and airy interior for gourmet meals.', 'Sourdough loaf with crusty texture'),
  productBase('vanilla-cake', 'Vanilla Celebration Cake', 'bakery', 48000, 22, 'Rich and buttery celebration cake for gatherings and dessert moments.', 'Vanilla cake topped with cream'),
  productBase('dishwashing-liquid', 'Dishwashing Liquid', 'household', 25000, 54, 'Degreasing detergent designed for effective kitchen cleanup and grease removal.', 'Dishwashing liquid bottle'),
  productBase('laundry-detergent', 'Laundry Detergent', 'household', 42000, 33, 'Daily household detergent with fresh fragrance and reliable stain cleaning.', 'Laundry detergent bottle'),
  productBase('hand-soap', 'Hand Soap', 'personal-care', 17000, 70, 'Gentle daily cleansing soap for refreshed hands and hygienic care.', 'Hand soap refill bottle'),
  productBase('toothpaste', 'Toothpaste', 'personal-care', 18000, 72, 'Fluoride toothpaste for daily oral hygiene and fresh breath.', 'Toothpaste tube on a white surface'),
  productBase('shampoo', 'Shampoo', 'personal-care', 26000, 48, 'Cleansing shampoo designed for volume, softness and daily shine.', 'Shampoo bottle in a bathroom setting'),
  productBase('frozen-chicken', 'Frozen Chicken Portions', 'frozen-foods', 52000, 30, 'Convenient frozen chicken cuts for safe storage and family recipes.', 'Frozen chicken portions in a freezer bag'),
  productBase('frozen-fish', 'Frozen Fish Fillets', 'frozen-foods', 61000, 26, 'Ready-to-cook fish fillets with consistent flavour and clean taste.', 'Frozen fish fillets packed neatly'),
  productBase('mixed-vegetable-blend', 'Mixed Vegetable Blend', 'frozen-foods', 33000, 40, 'Blended vegetables suited to stews, soups and quick dinners.', 'Frozen mixed vegetable blend'),
  productBase('tomato-paste', 'Tomato Paste', 'fresh-produce', 14000, 86, 'Rich and concentrated tomato paste for soups, stews, sauces and curries.', 'Tomato paste canister'),
  productBase('garlic-bulbs', 'Garlic Bulbs', 'fresh-produce', 12000, 90, 'Aromatic garlic bulbs for everyday flavouring and savoury cooking.', 'Garlic bulbs in a tray'),
  productBase('ginger-root', 'Ginger Root', 'fresh-produce', 11000, 96, 'Fresh ginger root for tea, spice blends and warming dishes.', 'Fresh ginger root'),
  productBase('mangoes', 'Fresh Mangoes', 'fresh-produce', 26000, 72, 'Sweet and fragrant seasonal mangoes for snacking and smoothies.', 'Fresh mangoes stacked in a basket'),
  productBase('bananas', 'Bananas', 'fresh-produce', 20000, 110, 'Naturally sweet banana bunches optimized for daily snacking and smoothies.', 'Bananas in a bunch'),
  productBase('cucumber', 'Cucumber', 'fresh-produce', 14000, 88, 'Fresh cucumber for salads, juices and healthy meal prep.', 'Fresh cucumber with water droplets'),
  productBase('papaya', 'Papaya', 'fresh-produce', 25000, 60, 'Juicy and fragrant papaya ideal for breakfast and fruit bowls.', 'Papaya cut in half'),
  productBase('red-onions', 'Red Onions', 'fresh-produce', 15000, 80, 'Classic onions for salads, curries and flavourful cooking.', 'Fresh red onions in mesh sack'),
  productBase('carrot-bunch', 'Carrot Bunch', 'fresh-produce', 13000, 90, 'Fresh carrots for cooking, roasting and healthy juices.', 'Carrot bunch with green tops'),
  productBase('spinach-bunch', 'Spinach Bunch', 'fresh-produce', 17000, 78, 'Tender spinach leaves for soups, salads and quick sautés.', 'Fresh spinach leaves'),
  productBase('cabbage-head', 'Cabbage Head', 'fresh-produce', 22000, 64, 'Versatile cabbage for slaws, soups and stir-fries.', 'Cabbage head with fresh leaves'),
  productBase('sweet-potatoes', 'Sweet Potatoes', 'fresh-produce', 20000, 70, 'Naturally sweet roots perfect for roasting, boiling and hearty stews.', 'Sweet potatoes in a basket'),
  productBase('coffee-beans', 'Ground Coffee Beans', 'beverages', 46000, 40, 'Rich coffee grounds for afternoon brews and morning rituals.', 'Coffee beans in a bag'),
  productBase('tea-bags', 'Herbal Tea Bags', 'beverages', 24000, 58, 'Comforting tea blend for calm evenings and warming routines.', 'Tea bags in a box'),
  productBase('coconut-water', 'Coconut Water', 'beverages', 19000, 70, 'Hydrating coconut water with a naturally refreshing tropical taste.', 'Coconut water canister'),
  productBase('soda-pack', 'Sparkling Soda Pack', 'beverages', 26000, 64, 'Classic festive soda for gatherings, parties and casual refreshment.', 'Soda pack in a chilled display'),
  productBase('pepsi-soda', 'Pepsi Soda', 'beverages', 22000, 55, 'Carbonated beverage for refreshment and social moments.', 'Plastic soda bottle with red branding'),
  productBase('milk-cereal', 'Breakfast Cereal', 'snacks', 28000, 52, 'Crunchy breakfast cereal with wholesome grains and a sweet finish.', 'Breakfast cereal in a box'),
  productBase('granola-bar', 'Granola Bar', 'snacks', 12000, 85, 'On-the-go energy snack for busy mornings and lunch breaks.', 'Granola bar snack pack'),
  productBase('rolled-oats', 'Rolled Oats 1kg', 'cereal', 36000, 43, 'Whole-grain oats for breakfast porridge, baking and home-made granola.', 'Bag of rolled oats'),
  productBase('corn-flakes', 'Corn Flakes 500g', 'cereal', 32000, 50, 'Crisp corn cereal to serve with milk or yoghurt for breakfast.', 'Box of corn flakes'),
  productBase('chicken-breast', 'Chicken Breast Portions 1kg', 'meat-and-poultry', 78000, 26, 'Fresh chicken breast portions suitable for grilling, stews and everyday meals.', 'Fresh chicken breast portions'),
  productBase('beef-stew-cuts', 'Beef Stew Cuts 1kg', 'meat-and-poultry', 96000, 18, 'Stew-ready beef cuts for soups, sauces and family meals.', 'Beef stew cuts'),
  productBase('whole-chicken', 'Whole Chicken 1.5kg', 'meat-and-poultry', 112000, 20, 'Whole chicken suitable for roasting or portioning for several meals.', 'Whole chicken'),
  productBase('fresh-tilapia', 'Fresh Tilapia', 'fish-and-seafood', 68000, 24, 'Fresh tilapia for grilling, frying or traditional fish stews.', 'Fresh tilapia fish'),
  productBase('smoked-herring', 'Smoked Herring Pack', 'fish-and-seafood', 42000, 32, 'Smoked herring for sauces, soups and flavourful traditional dishes.', 'Smoked herring pieces'),
  productBase('frozen-prawns', 'Frozen Prawns 500g', 'fish-and-seafood', 88000, 16, 'Frozen prawns for rice dishes, soups and quick seafood meals.', 'Frozen prawns'),
];
