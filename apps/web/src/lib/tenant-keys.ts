import type { OrdersQuery } from "@restaurant/api-client";

type Root = readonly unknown[];

/** Filtre d'une liste de réservations : journée de service, ou intervalle (arrivées de l'heure). */
export type ReservationListKey = { date?: string; from?: string; to?: string };

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
  floorPlans: (root: Root) => [...root, "floor-plans"] as const,
  menu: (root: Root) => [...root, "menu"] as const,
  formulas: (root: Root) => [...root, "menu", "formulas"] as const,
  promotions: (root: Root) => [...root, "menu", "promotions"] as const,
  allergens: (root: Root) => [...root, "menu", "allergens"] as const,
  staff: (root: Root) => [...root, "staff"] as const,
  register: (root: Root) => [...root, "register"] as const,
  dashboard: (root: Root, date?: string) => (date ? [...root, "dashboard", date] as const : [...root, "dashboard"] as const),
  settings: (root: Root, section: string) => [...root, "settings", section] as const,
  // ── P2A : réservations ──
  reservations: (root: Root) => [...root, "reservations"] as const,
  reservationLists: (root: Root) => [...root, "reservations", "list"] as const,
  reservationList: (root: Root, q: ReservationListKey) => [...root, "reservations", "list", q] as const,
  reservation: (root: Root, id: string) => [...root, "reservations", "detail", id] as const,
  waitlistLists: (root: Root) => [...root, "reservations", "waitlist"] as const,
  waitlist: (root: Root, q: object = {}) => [...root, "reservations", "waitlist", q] as const,
  openingHours: (root: Root) => [...root, "reservations", "hours"] as const,
  closures: (root: Root) => [...root, "reservations", "closures"] as const,
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
  // ── P4 : personnel et messagerie ──
  hr: (root: Root) => [...root, "hr"] as const,
  hrMe: (root: Root) => [...root, "hr", "me"] as const,
  hrPlanning: (root: Root, week: string, mine: boolean) => [...root, "hr", "planning", mine ? "mine" : "team", week] as const,
  hrPlannings: (root: Root) => [...root, "hr", "planning"] as const,
  hrProfiles: (root: Root) => [...root, "hr", "profiles"] as const,
  hrAttendance: (root: Root, q: object = {}) => [...root, "hr", "attendance", q] as const,
  hrPresent: (root: Root) => [...root, "hr", "present"] as const,
  hrAbsences: (root: Root, q: object = {}) => [...root, "hr", "absences", q] as const,
  hrBalance: (root: Root) => [...root, "hr", "balance"] as const,
  hrPerformance: (root: Root, q: object = {}) => [...root, "hr", "performance", q] as const,
  hrPayroll: (root: Root, q: object = {}) => [...root, "hr", "payroll", q] as const,
  hrKiosk: (root: Root) => [...root, "hr", "kiosk"] as const,
  // ── X2 : livraison ──
  deliveryAll: (root: Root) => [...root, "delivery"] as const,
  deliveryBoard: (root: Root) => [...root, "delivery", "board"] as const,
  deliveryMine: (root: Root) => [...root, "delivery", "mine"] as const,
  delivery: (root: Root, id: string) => [...root, "delivery", "detail", id] as const,
  deliveryZones: (root: Root) => [...root, "delivery", "zones"] as const,
  deliveryDrivers: (root: Root) => [...root, "delivery", "drivers"] as const,
  deliverySettlements: (root: Root) => [...root, "delivery", "settlements"] as const,
  chatChannels: (root: Root) => [...root, "chat", "channels"] as const,
  chatMessages: (root: Root, channelId: string) => [...root, "chat", "messages", channelId] as const,
  chatPeople: (root: Root) => [...root, "chat", "people"] as const,
};
