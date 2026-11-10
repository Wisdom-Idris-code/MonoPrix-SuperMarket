export type Role = 'CUSTOMER' | 'ADMIN' | 'STAFF';
export type ProductSummary = {
    id: string;
    name: string;
    slug: string;
    category: string;
    price: string;
    stock: number;
    imageUrl: string;
    rating?: number;
    isFeatured?: boolean;
};
export type AuthUser = {
    id: string;
    name: string;
    email: string;
    role: Role;
};
