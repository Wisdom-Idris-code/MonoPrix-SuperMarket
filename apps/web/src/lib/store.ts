import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CartItem = {
  id: string;
  productId?: string;
  variantId?: string;
  variantName?: string;
  variantQuantity?: string;
  variantUnit?: string;
  slug: string;
  serverItemId?: string;
  name: string;
  price: number;
  quantity: number;
  stock: number;
  imageUrl: string;
  altText: string;
};

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: 'CUSTOMER' | 'ADMIN' | 'STAFF';
  phone: string | null;
};

type CartState = {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  setItems: (items: CartItem[]) => void;
  clear: () => void;
};

type AuthState = {
  user: AuthUser | null;
  initialized: boolean;
  setUser: (user: AuthUser | null) => void;
  setInitialized: (initialized: boolean) => void;
};

export const useCartStore = create<CartState>()(persist((set) => ({
  items: [],
  addItem: (item) =>
    set((state) => {
      const existing = state.items.find((entry) => entry.id === item.id);
      if (existing) {
        return {
          items: state.items.map((entry) =>
            entry.id === item.id ? { ...entry, quantity: Math.min(entry.stock, entry.quantity + item.quantity) } : entry,
          ),
        };
      }
      return { items: [...state.items, item] };
    }),
  removeItem: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
  updateQuantity: (id, quantity) =>
    set((state) => ({
      items: state.items
        .map((item) => (item.id === id ? { ...item, quantity: Math.min(item.stock, Math.max(0, quantity)) } : item))
        .filter((item) => item.quantity > 0),
    })),
  setItems: (items) => set({ items }),
  clear: () => set({ items: [] }),
}), { name: 'monoprix-guest-cart', partialize: (state) => ({ items: state.items }) }));

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  initialized: false,
  setUser: (user) => set({ user }),
  setInitialized: (initialized) => set({ initialized }),
}));

export function formatSLE(amount: number | string) {
  return `NLe ${Number(amount).toLocaleString('en-SL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
