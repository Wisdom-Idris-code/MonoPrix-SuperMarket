CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ProductVariant" (
    "id", "productId", "name", "quantity", "unit", "sku", "price", "stock",
    "isActive", "isDefault", "createdAt", "updatedAt"
)
SELECT
    'legacy-' || p."id", p."id", 'Standard', 1, 'item', p."sku", p."price", p."stock",
    p."isActive", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Product" p;

ALTER TABLE "CartItem" ADD COLUMN "variantId" TEXT;
UPDATE "CartItem" ci
SET "variantId" = 'legacy-' || ci."productId";
ALTER TABLE "CartItem" ALTER COLUMN "variantId" SET NOT NULL;
DROP INDEX "CartItem_cartId_productId_key";
CREATE UNIQUE INDEX "CartItem_cartId_variantId_key" ON "CartItem"("cartId", "variantId");

ALTER TABLE "OrderItem"
    ADD COLUMN "variantId" TEXT,
    ADD COLUMN "variantName" TEXT,
    ADD COLUMN "variantQuantity" DECIMAL(12,3),
    ADD COLUMN "variantUnit" TEXT,
    ADD COLUMN "variantSku" TEXT;

ALTER TABLE "InventoryMovement" ADD COLUMN "variantId" TEXT;

CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");
CREATE INDEX "ProductVariant_productId_isActive_idx" ON "ProductVariant"("productId", "isActive");

ALTER TABLE "ProductVariant"
    ADD CONSTRAINT "ProductVariant_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CartItem"
    ADD CONSTRAINT "CartItem_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderItem"
    ADD CONSTRAINT "OrderItem_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryMovement"
    ADD CONSTRAINT "InventoryMovement_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ProductVariant_one_default_per_product_key"
    ON "ProductVariant"("productId")
    WHERE "isDefault" = true;
