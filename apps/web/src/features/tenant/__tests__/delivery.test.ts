import type { Delivery, DeliveryBoard } from "@restaurant/api-client";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { applyDeliveryEvent, upsertDelivery } from "@/lib/realtime/delivery-cache";
import { tenantKeys } from "@/lib/tenant-keys";
import { cartTotals } from "../pos/cart";
import type { CartLine } from "../pos/cart";

const root = ["tenant", "demo"] as const;
function delivery(p: Partial<Delivery> = {}, order: Partial<Delivery["order"]> = {}): Delivery {
  return {
    id: "d1", status: "PENDING", phase: "preparing", zone: { id: "z", name: "Centre" }, neighborhood: "Tokoin", address: "Rue 1", landmark: "Pharmacie", phone: "+22890554433", fee: 1000,
    eta: null, driver: null, failReason: null, assignedAt: null, pickedUpAt: null, deliveredAt: null, failedAt: null, collectedPaymentId: null, settledAt: null, createdAt: "2026-11-16T10:00:00.000Z",
    order: { id: "o1", number: 5, status: "PENDING", paymentStatus: "UNPAID", customerName: "Afi", subtotal: 8000, serviceCharge: 0, deliveryFee: 1000, total: 9000, paidAmount: 0, remaining: 9000, createdAt: "2026-11-16T10:00:00.000Z", closedAt: null, cancelledAt: null, items: [], ...order },
    ...p,
  };
}
const line = (price: number, qty = 1): CartLine => ({ key: "k", menuItemId: "m", name: "Plat", unitPrice: price, vatRate: 18, options: [], quantity: qty, instructions: "", course: 1 });

describe("livraison : panier", () => {
  it("les frais entrent dans le total (TVA au taux par défaut) sauf panier vide", () => {
    const ops = { serviceChargePercent: 10, defaultVatRate: 18 };
    expect(cartTotals([line(4000, 2)], ops, 1000)).toMatchObject({ subtotal: 8000, serviceCharge: 800, deliveryFee: 1000, total: 9800 });
    expect(cartTotals([], ops, 1000).total).toBe(0);
    expect(cartTotals([line(4000)], ops).total).toBe(4400);
  });
});

describe("livraison : cache temps réel", () => {
  it("insère, remplace et retire une livraison du tableau", () => {
    const board: DeliveryBoard = { items: [], day: "2026-11-16" };
    const a = upsertDelivery(board, delivery(), true);
    expect(a.items).toHaveLength(1);
    const b = upsertDelivery(a, delivery({ status: "ASSIGNED" }), true);
    expect(b.items).toHaveLength(1);
    expect(b.items[0]!.status).toBe("ASSIGNED");
    expect(upsertDelivery(b, delivery(), false).items).toHaveLength(0);
  });

  it("« Mes livraisons » ne garde que les livraisons du livreur connecté ; une commande annulée sort du tableau", () => {
    const qc = new QueryClient();
    qc.setQueryData(tenantKeys.deliveryBoard(root), { items: [], day: "x" });
    qc.setQueryData(tenantKeys.deliveryMine(root), { items: [], day: "x" });
    const mine = delivery({ status: "ASSIGNED", driver: { id: "u1", name: "Kossi", phone: null } });
    applyDeliveryEvent(qc, root, mine, "u1");
    expect(qc.getQueryData<DeliveryBoard>(tenantKeys.deliveryBoard(root))!.items).toHaveLength(1);
    expect(qc.getQueryData<DeliveryBoard>(tenantKeys.deliveryMine(root))!.items).toHaveLength(1);
    applyDeliveryEvent(qc, root, delivery({ id: "d2", status: "ASSIGNED", driver: { id: "u2", name: "Yao", phone: null } }), "u1");
    expect(qc.getQueryData<DeliveryBoard>(tenantKeys.deliveryMine(root))!.items.map((d) => d.id)).toEqual(["d1"]);
    expect(qc.getQueryData<DeliveryBoard>(tenantKeys.deliveryBoard(root))!.items).toHaveLength(2);
    // Réattribuée à un autre livreur : disparaît de « Mes livraisons »
    applyDeliveryEvent(qc, root, { ...mine, driver: { id: "u2", name: "Yao", phone: null } }, "u1");
    expect(qc.getQueryData<DeliveryBoard>(tenantKeys.deliveryMine(root))!.items).toHaveLength(0);
    applyDeliveryEvent(qc, root, delivery({ order: { cancelledAt: "2026-11-16T11:00:00.000Z" } as never }), "u1");
    expect(qc.getQueryData<DeliveryBoard>(tenantKeys.deliveryBoard(root))!.items.map((d) => d.id)).toEqual(["d2"]);
  });
});
