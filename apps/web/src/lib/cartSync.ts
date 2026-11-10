import { apiPost } from './api';
import { useAuthStore, useCartStore, type CartItem } from './store';

type ServerCart = {
  items: Array<{
    id: string;
    productId: string;
    variantId: string;
    name: string;
    slug: string;
    variantName: string;
    variantQuantity: string;
    variantUnit: string;
    price: string;
    quantity: number;
    stock: number;
    imageUrl: string;
    altText: string;
  }>;
};

function mapServerCart(cart: ServerCart): CartItem[] {
  return cart.items.map((item) => ({
    id: item.variantId,
    productId: item.productId,
    variantId: item.variantId,
    variantName: item.variantName,
    variantQuantity: item.variantQuantity,
    variantUnit: item.variantUnit,
    slug: item.slug,
    serverItemId: item.id,
    name: item.name,
    price: Number(item.price),
    quantity: item.quantity,
    stock: item.stock,
    imageUrl: item.imageUrl,
    altText: item.altText,
  }));
}

export async function syncGuestCart() {
  const items = useCartStore.getState().items;
  const payload = await apiPost<{ cart: ServerCart }>('/cart/merge', {
    items: items.map((item) => ({
      productId: item.productId ?? item.id,
      ...(item.variantId ? { variantId: item.variantId } : {}),
      quantity: item.quantity,
    })),
  });
  useCartStore.getState().setItems(mapServerCart(payload.cart));
}

export async function addCartProduct(product: Omit<CartItem, 'quantity' | 'serverItemId'> & { productId: string; variantId: string }, quantity = 1) {
  if (!useAuthStore.getState().user) {
    useCartStore.getState().addItem({ ...product, quantity });
    return;
  }
  const payload = await apiPost<{ cart: ServerCart }>('/cart/items', {
    productId: product.productId,
    variantId: product.variantId,
    quantity,
  });
  useCartStore.getState().setItems(mapServerCart(payload.cart));
}

export async function replaceFromServerCart(cart: ServerCart) {
  useCartStore.getState().setItems(mapServerCart(cart));
}
