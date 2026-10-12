import type { DiningTable, Order, Paginated } from "@restaurant/api-client";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { item, order } from "@/features/tenant/__tests__/fixtures";
import { tenantKeys } from "../../tenant-keys";
import { applyOrderEvent, kitchenView, matchesOrderQuery } from "../order-cache";

const root = ["tenant", "chez-kofi"] as const;
const page = (items: Order[], extra: Partial<Paginated<Order>> = {}): Paginated<Order> => ({ total: items.length, page: 1, pageSize: 30, items, ...extra });
const table = (p: Partial<DiningTable> = {}): DiningTable => ({ id: "table-1", tenantId: "t", label: "T1", capacity: 4, status: "FREE", isActive: true, openOrders: [], ...p });
const later = (o: Order, patch: Partial<Order>, minutes = 1): Order => ({ ...o, ...patch, updatedAt: new Date(new Date(o.updatedAt).getTime() + minutes * 60_000).toISOString() });

function setup() {
  const qc = new QueryClient();
  return qc;
}

describe("mise à jour des caches par le temps réel", () => {
  it("met à jour le détail d'une commande affichée, et ignore un événement plus ancien", () => {
    const qc = setup();
    const o = order();
    qc.setQueryData(tenantKeys.order(root, o.id), o);
    const served = later(o, { status: "READY" });
    applyOrderEvent(qc, root, served);
    expect(qc.getQueryData<Order>(tenantKeys.order(root, o.id))!.status).toBe("READY");
    applyOrderEvent(qc, root, { ...o, status: "PENDING" });   // en retard : ignoré
    expect(qc.getQueryData<Order>(tenantKeys.order(root, o.id))!.status).toBe("READY");
  });

  it("insère une nouvelle commande en tête des listes dont elle respecte les filtres", () => {
    const qc = setup();
    const old = order({ id: "old", number: 11, createdAt: "2026-10-12T11:00:00.000Z" });
    const open = tenantKeys.orderList(root, { open: true, pageSize: 30 });
    const takeaway = tenantKeys.orderList(root, { type: "TAKEAWAY" });
    const page2 = tenantKeys.orderList(root, { page: 2 });
    qc.setQueryData(open, page([old]));
    qc.setQueryData(takeaway, page([]));
    qc.setQueryData(page2, page([], { page: 2 }));
    const fresh = order({ id: "new", number: 12, createdAt: "2026-10-12T12:30:00.000Z" });
    applyOrderEvent(qc, root, fresh);
    expect(qc.getQueryData<Paginated<Order>>(open)!.items.map((o) => o.number)).toEqual([12, 11]);
    expect(qc.getQueryData<Paginated<Order>>(open)!.total).toBe(2);
    expect(qc.getQueryData<Paginated<Order>>(takeaway)!.items).toEqual([]);   // sur place : hors filtre
    expect(qc.getQueryState(page2)!.isInvalidated).toBe(true);               // page 2 : rechargée
  });

  it("retire d'une liste « en cours » une commande clôturée", () => {
    const qc = setup();
    const o = order();
    const key = tenantKeys.orderList(root, { open: true });
    qc.setQueryData(key, page([o]));
    applyOrderEvent(qc, root, later(o, { closedAt: "2026-10-12T13:00:00.000Z", status: "DELIVERED", paymentStatus: "PAID" }));
    expect(qc.getQueryData<Paginated<Order>>(key)).toMatchObject({ total: 0, items: [] });
  });

  it("écran cuisine : ajoute, trie (plus ancienne d'abord), filtre les articles et retire les commandes servies", () => {
    const qc = setup();
    const a = order({ id: "a", createdAt: "2026-10-12T12:10:00.000Z" });
    qc.setQueryData(tenantKeys.kitchen(root), [a]);
    const b = order({ id: "b", createdAt: "2026-10-12T12:05:00.000Z", items: [item({ status: "SERVED" }), item({ status: "IN_PROGRESS" })] });
    applyOrderEvent(qc, root, b);
    const board = qc.getQueryData<Order[]>(tenantKeys.kitchen(root))!;
    expect(board.map((o) => o.id)).toEqual(["b", "a"]);
    expect(board[0]!.items.map((i) => i.status)).toEqual(["IN_PROGRESS"]);
    applyOrderEvent(qc, root, later(b, { items: b.items.map((i) => ({ ...i, status: "SERVED" as const })) }));
    expect(qc.getQueryData<Order[]>(tenantKeys.kitchen(root))!.map((o) => o.id)).toEqual(["a"]);
    expect(kitchenView(order({ cancelledAt: "2026-10-12T12:00:00.000Z" }))).toBeNull();
  });

  it("tables : occupée avec la commande ouverte, libérée à la clôture", () => {
    const qc = setup();
    qc.setQueryData(tenantKeys.tables(root), [table(), table({ id: "table-2", label: "T2" })]);
    const o = order();
    applyOrderEvent(qc, root, o);
    let tables = qc.getQueryData<DiningTable[]>(tenantKeys.tables(root))!;
    expect(tables[0]).toMatchObject({ status: "OCCUPIED", openOrders: [{ id: o.id, number: 12, total: 4000 }] });
    expect(tables[1]!.status).toBe("FREE");
    applyOrderEvent(qc, root, later(o, { closedAt: "2026-10-12T13:00:00.000Z" }));
    tables = qc.getQueryData<DiningTable[]>(tenantKeys.tables(root))!;
    expect(tables[0]).toMatchObject({ status: "FREE", openOrders: [] });
  });

  it("invalide les vues agrégées (tableau de bord, caisse)", () => {
    const qc = setup();
    qc.setQueryData(tenantKeys.dashboard(root, "2026-10-12"), { revenue: 0 });
    qc.setQueryData([...tenantKeys.register(root), "current"], { open: false });
    applyOrderEvent(qc, root, order());
    expect(qc.getQueryState(tenantKeys.dashboard(root, "2026-10-12"))!.isInvalidated).toBe(true);
    expect(qc.getQueryState([...tenantKeys.register(root), "current"])!.isInvalidated).toBe(true);
  });

  it("filtre par date dans le fuseau du restaurant", () => {
    const late = order({ createdAt: "2026-10-12T23:30:00.000Z" });
    expect(matchesOrderQuery(late, { date: "2026-10-12" }, "Africa/Lome")).toBe(true);
    expect(matchesOrderQuery(late, { date: "2026-10-13" }, "Europe/Paris")).toBe(true);
    expect(matchesOrderQuery(late, { status: "READY" })).toBe(false);
  });
});
