import type { OrdersQuery } from "@restaurant/api-client";

type Root = readonly unknown[];

/**
 * Clés TanStack Query de l'espace restaurant, sous la racine de session `["tenant", slug]`.
 * Centralisées ici : le temps réel met à jour ces caches au lieu de tout recharger.
 */
export const tenantKeys = {
  orders: (root: Root) => [...root, "orders"] as const,
  orderLists: (root: Root) => [...root, "orders", "list"] as const,
  orderList: (root: Root, q: OrdersQuery) => [...root, "orders", "list", q] as const,
  order: (root: Root, id: string) => [...root, "orders", "detail", id] as const,
  receipt: (root: Root, id: string) => [...root, "orders", "receipt", id] as const,
  kitchen: (root: Root) => [...root, "kitchen"] as const,
  tables: (root: Root) => [...root, "tables"] as const,
  menu: (root: Root) => [...root, "menu"] as const,
  formulas: (root: Root) => [...root, "menu", "formulas"] as const,
  promotions: (root: Root) => [...root, "menu", "promotions"] as const,
  allergens: (root: Root) => [...root, "menu", "allergens"] as const,
  staff: (root: Root) => [...root, "staff"] as const,
  register: (root: Root) => [...root, "register"] as const,
  dashboard: (root: Root, date?: string) => (date ? [...root, "dashboard", date] as const : [...root, "dashboard"] as const),
  settings: (root: Root, section: string) => [...root, "settings", section] as const,
  // ── P3 : stock ──
  stock: (root: Root) => [...root, "stock"] as const,
  ingredients: (root: Root, q: object = {}) => [...root, "stock", "ingredients", q] as const,
  ingredientLists: (root: Root) => [...root, "stock", "ingredients"] as const,
  stockAlerts: (root: Root) => [...root, "stock", "alerts"] as const,
  movements: (root: Root, q: object = {}) => [...root, "stock", "movements", q] as const,
  waste: (root: Root, q: object = {}) => [...root, "stock", "waste", q] as const,
  counts: (root: Root) => [...root, "stock", "counts"] as const,
  count: (root: Root, id: string) => [...root, "stock", "counts", id] as const,
  recipe: (root: Root, menuItemId: string) => [...root, "stock", "recipe", menuItemId] as const,
  suppliers: (root: Root) => [...root, "stock", "suppliers"] as const,
  purchaseOrders: (root: Root) => [...root, "stock", "purchase-orders"] as const,
};
