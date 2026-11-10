# ADDITIONAL MASTER REQUIREMENT: PRODUCT IMAGE AND MEDIA ARCHITECTURE

You are responsible for implementing a professional image acquisition, management and delivery strategy for Monoprix Online.

Do not use random image URLs, arbitrary stock photos or generic placeholder images throughout the application.

## 1. IMAGE SOURCES

Use the following sources according to image type:

A. Product photography:
- Manufacturer and supplier product images, where permission or appropriate usage rights are available.
- Open Food Facts API, where image licensing and attribution requirements are respected.
- Curated demonstration product images with verified usage rights.
- Original product photographs where available.

B. Lifestyle photography:
- Licensed stock photography.
- Food photography.
- Supermarket and fresh-produce photography.
- Approved promotional campaign images.

C. Brand assets:
- Use only supplied authentic Monoprix brand assets or approved demonstration alternatives.
- Do not fabricate official Monoprix product packaging, promotions or endorsements.

## 2. OPEN FOOD FACTS INTEGRATION

Investigate the official Open Food Facts API v3.

Documentation:
https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/

Use it as an optional product discovery and demonstration-data source.

Requirements:
- Use a descriptive custom User-Agent.
- Avoid excessive requests.
- Do not implement search-as-you-type against its search API.
- Respect its API rate limits.
- Verify product information before adding it to the demo catalogue.
- Track image provenance and licensing.
- Attribute Open Food Facts appropriately.
- Respect CC BY-SA requirements for product photographs.
- Do not scrape images from unrelated websites.

Do not make the application dependent on Open Food Facts availability.

Create an import workflow that allows selected product information to be reviewed before saving it into our own database.

## 3. CLOUDINARY IMAGE MANAGEMENT

Use Cloudinary as the primary image delivery and management service for approved product images.

Implement:
- Secure image upload.
- Product image transformations.
- Thumbnail generation.
- Responsive image delivery.
- Image optimization.
- Appropriate image formats.
- Consistent image aspect ratios.

Use signed server-side uploads where required.

Never expose API secrets in frontend code.

Do not transfer images from a source whose API terms require hotlinking to Cloudinary. Respect each source's delivery requirements.

## 4. IMAGE DATABASE FIELDS

Extend the product image architecture to support:

- imageUrl
- thumbnailUrl
- altText
- imageSource
- sourcePageUrl
- license
- attribution
- cloudinaryPublicId
- reviewedAt

If multiple product images are supported, create a separate ProductImage model with ordering and primary-image selection.

## 5. IMAGE QUALITY

Use consistent image presentation.

Product image rules:
- Prefer square 1:1 product images.
- Use clean backgrounds for packaged goods.
- Preserve the product's actual packaging.
- Do not distort product proportions.
- Use object-fit: contain for packaged products.
- Use object-fit: cover for lifestyle photography.
- Prevent layout shifts by defining image dimensions.
- Provide a polished fallback image when an image is unavailable.

Do not use food emojis as product images.

Do not generate fictional packaging for real commercial brands.

Do not display incorrect product images under real product names.

## 6. PRODUCT IMAGE LIBRARY

Create a curated image library for the initial demonstration catalogue.

Target at least 40–60 products across:
- Rice and grains.
- Cooking oils.
- Beverages.
- Dairy.
- Snacks.
- Cereal.
- Fresh fruit.
- Vegetables.
- Meat and poultry.
- Frozen foods.
- Household products.
- Personal care.

Use realistic demonstration product names and SLE prices.

The images must match the products they represent.

If a suitable licensed image cannot be found, mark that product as needing an image rather than assigning a random photograph.

## 7. IMAGE DOCUMENTATION

Create:

docs/image-sourcing.md

Document:
- Image sources.
- API integrations.
- Attribution requirements.
- Licensing considerations.
- Upload process.
- Image optimization.
- Image replacement workflow.
- Fallback handling.

Also create a structured image manifest so that every demonstration product image can be traced to its source and usage rights.

## 8. FINAL RULE

The application must not depend on a third-party stock-image search API to render its product catalogue at runtime.

Product images must be reviewed, associated with the correct product and managed through our application database and approved image-delivery infrastructure.