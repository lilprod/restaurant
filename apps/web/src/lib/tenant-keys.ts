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
  allergens: (root: Root) => [...root, "menu", "allergens"] as const,
  staff: (root: Root) => [...root, "staff"] as const,
  register: (root: Root) => [...root, "register"] as const,
  dashboard: (root: Root, date?: string) => (date ? [...root, "dashboard", date] as const : [...root, "dashboard"] as const),
  settings: (root: Root, section: string) => [...root, "settings", section] as const,
};
