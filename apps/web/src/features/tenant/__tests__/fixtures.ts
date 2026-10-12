import type { MenuItem, Order, OrderItem } from "@restaurant/api-client";

/** Identifiants d'options (UUID, comme ceux de l'API). */
export const O = {
  att: "a0000000-0000-4000-8000-000000000001",
  fri: "a0000000-0000-4000-8000-000000000002",
  all: "a0000000-0000-4000-8000-000000000003",
  pim: "a0000000-0000-4000-8000-000000000004",
  moy: "a0000000-0000-4000-8000-000000000005",
  ara: "a0000000-0000-4000-8000-000000000006",
};

export const poulet: MenuItem = {
  id: "11111111-1111-4111-8111-111111111111", categoryId: "c1", name: "Poulet braisé", description: null, price: 4000, vatRate: 18,
  imageUrl: null, prepMinutes: 25, isAvailable: true, isDishOfDay: true, sortOrder: 0, archived: false, allergens: [],
  optionGroups: [
    { id: "g-acc", name: "Accompagnement", minChoices: 1, maxChoices: 1, options: [
      { id: O.att, name: "Attiéké", extra: 0 }, { id: O.fri, name: "Frites", extra: 300 }, { id: O.all, name: "Alloco", extra: 500 },
    ] },
    { id: "g-sau", name: "Sauces", minChoices: 0, maxChoices: 2, options: [
      { id: O.pim, name: "Piment", extra: 0 }, { id: O.moy, name: "Moyo", extra: 200 }, { id: O.ara, name: "Arachide", extra: 200 },
    ] },
  ],
};
export const bissap: MenuItem = { ...poulet, id: "22222222-2222-4222-8222-222222222222", name: "Bissap", price: 700, vatRate: 10, prepMinutes: 1, isDishOfDay: false, optionGroups: [] };

let seq = 0;
export function item(p: Partial<OrderItem> = {}): OrderItem {
  seq += 1;
  return {
    id: `item-${seq}`, menuItemId: poulet.id, name: "Poulet braisé", quantity: 1, unitPrice: 4000, optionsExtra: 0, lineTotal: 4000, vatRate: 18,
    status: "PENDING", instructions: null, course: 1, options: [], prepMinutes: 25, imageUrl: null, createdAt: "2026-10-12T12:00:00.000Z",
    startedAt: null, readyAt: null, servedAt: null, cancelReason: null, paidQuantity: 0, ...p,
  };
}

export function order(p: Partial<Order> = {}): Order {
  const items = p.items ?? [item()];
  const subtotal = items.filter((i) => i.status !== "CANCELLED").reduce((n, i) => n + i.lineTotal, 0);
  return {
    id: "order-1", number: 12, type: "DINE_IN", status: "PENDING", paymentStatus: "UNPAID", table: { id: "table-1", label: "T1" },
    customerName: null, notes: null, waiter: { id: "w1", firstName: "Awa", lastName: "K." }, subtotal, serviceCharge: 0, vat: 0, total: subtotal,
    tip: 0, paidAmount: 0, remaining: subtotal, createdAt: "2026-10-12T12:00:00.000Z", updatedAt: "2026-10-12T12:00:00.000Z",
    closedAt: null, cancelledAt: null, cancelReason: null, items, payments: [], ...p,
  };
}
