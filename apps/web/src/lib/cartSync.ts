import { apiDelete, apiGet, apiPatch, apiPost } from './api';
import { useAuthStore, useCartStore, type CartItem } from './store';

export type ServerCart = {
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

type CartMutation =
  | { type: 'add'; item: Omit<CartItem, 'quantity' | 'serverItemId'> & { productId: string; variantId: string }; quantity: number }
  | { type: 'quantity'; id: string; quantity: number; serverItemId?: string }
  | { type: 'remove'; id: string; serverItemId?: string };

let confirmedItems: CartItem[] | null = null;
let pendingMutations: CartMutation[] = [];
let mutationQueue: Promise<void> = Promise.resolve();
let pendingWrites: Promise<void>[] = [];

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

function applyMutation(items: CartItem[], mutation: CartMutation): CartItem[] {
  if (mutation.type === 'add') {
    const item: CartItem = { ...mutation.item, quantity: mutation.quantity };
    const existing = items.find((entry) => entry.id === item.id);
    if (existing) {
      return items.map((entry) => entry.id === item.id
        ? { ...entry, quantity: Math.min(entry.stock, entry.quantity + mutation.quantity) }
        : entry);
    }
    return [...items, item];
  }
  if (mutation.type === 'remove') {
    return items.filter((item) => item.id !== mutation.id);
  }
  return items
    .map((item) => (item.id === mutation.id
      ? { ...item, quantity: Math.min(item.stock, Math.max(0, mutation.quantity)) }
      : item))
    .filter((item) => item.quantity > 0);
}

function applyPendingMutations(items: CartItem[]) {
  return pendingMutations.reduce(applyMutation, items);
}

function enqueueMutation(mutation: CartMutation, guestItems: CartItem[]) {
  const store = useCartStore.getState();
  const resolvedMutation = mutation.type === 'add'
    ? mutation
    : {
      ...mutation,
      serverItemId: store.items.find((item) => item.id === mutation.id)?.serverItemId
        ?? confirmedItems?.find((item) => item.id === mutation.id)?.serverItemId,
    };
  store.setItems(applyMutation(store.items, resolvedMutation));
  if (!useAuthStore.getState().user) return Promise.resolve();

  if (!confirmedItems) confirmedItems = guestItems;
  pendingMutations.push(resolvedMutation);

  const task = mutationQueue.then(async () => {
    try {
      let result: { cart: ServerCart };
      if (resolvedMutation.type === 'add') {
        result = await apiPost<{ cart: ServerCart }>('/cart/items', {
          productId: resolvedMutation.item.productId,
          variantId: resolvedMutation.item.variantId,
          quantity: resolvedMutation.quantity,
        });
      } else {
        const serverItemId = resolvedMutation.serverItemId
          ?? useCartStore.getState().items.find((entry) => entry.id === resolvedMutation.id)?.serverItemId
          ?? confirmedItems?.find((entry) => entry.id === resolvedMutation.id)?.serverItemId;
        if (!serverItemId) throw new Error('The saved cart item could not be found.');
        result = resolvedMutation.type === 'remove' || resolvedMutation.quantity === 0
          ? await apiDelete<{ cart: ServerCart }>(`/cart/items/${serverItemId}`)
          : await apiPatch<{ cart: ServerCart }>(`/cart/items/${serverItemId}`, { quantity: resolvedMutation.quantity });
      }

      pendingMutations = pendingMutations.filter((entry) => entry !== resolvedMutation);
      confirmedItems = mapServerCart(result.cart);
      useCartStore.getState().setItems(applyPendingMutations(confirmedItems));
    } catch (issue) {
      pendingMutations = pendingMutations.filter((entry) => entry !== resolvedMutation);
      try {
        const { cart } = await apiGet<{ cart: ServerCart }>('/cart');
        confirmedItems = mapServerCart(cart);
        useCartStore.getState().setItems(applyPendingMutations(confirmedItems));
      } catch (reconcileIssue) {
        console.error('Unable to reconcile the saved cart after a failed update:', reconcileIssue);
        useCartStore.getState().setItems(applyPendingMutations(confirmedItems ?? guestItems));
      }
      throw issue;
    }
  });
  mutationQueue = task.catch(() => undefined);
  pendingWrites.push(task);
  task.then(
    () => { pendingWrites = pendingWrites.filter((write) => write !== task); },
    () => { pendingWrites = pendingWrites.filter((write) => write !== task); },
  );
  return task;
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
  await replaceFromServerCart(payload.cart);
}

export async function addCartProduct(product: Omit<CartItem, 'quantity' | 'serverItemId'> & { productId: string; variantId: string }, quantity = 1) {
  return enqueueMutation({ type: 'add', item: product, quantity }, useCartStore.getState().items);
}

export function updateCartProductQuantity(id: string, quantity: number) {
  return enqueueMutation({ type: 'quantity', id, quantity }, useCartStore.getState().items);
}

export function removeCartProduct(id: string) {
  return enqueueMutation({ type: 'remove', id }, useCartStore.getState().items);
}

export async function flushPendingCartWrites() {
  while (pendingWrites.length) await Promise.all([...pendingWrites]);
}

export async function replaceFromServerCart(cart: ServerCart) {
  confirmedItems = mapServerCart(cart);
  useCartStore.getState().setItems(applyPendingMutations(confirmedItems));
}
