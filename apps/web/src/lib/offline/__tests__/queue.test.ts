import { ApiError, type Order } from "@restaurant/api-client";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { isPersistableKey, restoreSnapshot, snapshotOf } from "../persist";
import { flushQueue, localRefOf, type QueuedRequest, type QueueStore } from "../queue";

const memStore = (rows: QueuedRequest[]): QueueStore & { rows: Map<string, QueuedRequest> } => {
  const m = new Map(rows.map((r) => [r.id, r]));
  return { rows: m, list: async () => [...m.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), put: async (r) => { m.set(r.id, r); }, remove: async (id) => { m.delete(id); } };
};
const req = (id: string, extra: Partial<QueuedRequest> = {}): QueuedRequest => ({
  id, kind: "order", userId: "u1", createdAt: `2026-11-17T10:00:0${id.slice(-1)}Z`, localRef: localRefOf(id), label: id, status: "pending", attempts: 0,
  order: { type: "TAKEAWAY", items: [{ menuItemId: "m", quantity: 1 }] } as never, ...extra,
});
const order = (n: number) => ({ id: `o${n}`, number: n }) as unknown as Order;

describe("file hors ligne : envoi", () => {
  it("envoie dans l'ordre de saisie avec la clé d'idempotence de chaque requête", async () => {
    const store = memStore([req("key-bbbbbb2"), req("key-aaaaaa1")]);
    const sent: string[] = [];
    const res = await flushQueue({ store, userId: "u1", send: async (r) => { sent.push(r.id); return order(sent.length); } });
    expect(sent).toEqual(["key-aaaaaa1", "key-bbbbbb2"]);
    expect(res.sent).toHaveLength(2);
    expect(store.rows.size).toBe(0);
  });

  it("réseau coupé : on s'arrête, tout reste en file (aucune perte), au bon ordre", async () => {
    const store = memStore([req("key-aaaaaa1"), req("key-bbbbbb2")]);
    const res = await flushQueue({ store, userId: "u1", send: async () => { throw ApiError.network(); } });
    expect(res.stoppedBy).toBe("offline");
    expect([...store.rows.values()].map((r) => [r.id, r.status, r.attempts])).toEqual([["key-aaaaaa1", "pending", 1], ["key-bbbbbb2", "pending", 0]]);
  });

  it("serveur en erreur (5xx), requête déjà en cours (409), session à renouveler (401) : conservée pour plus tard", async () => {
    for (const err of [new ApiError({ status: 503, message: "x" }), new ApiError({ status: 409, message: "Cette requête est déjà en cours de traitement : réessayez dans un instant" }), new ApiError({ status: 401, message: "x" })]) {
      const store = memStore([req("key-aaaaaa1")]);
      const res = await flushQueue({ store, userId: "u1", send: async () => { throw err; } });
      expect(res.stoppedBy).toBe("retry");
      expect(store.rows.get("key-aaaaaa1")?.status).toBe("pending");
    }
  });

  it("refus métier (plat épuisé…) : marquée « à vérifier », jamais renvoyée seule, les suivantes partent", async () => {
    const store = memStore([req("key-aaaaaa1"), req("key-bbbbbb2")]);
    const calls: string[] = [];
    const res = await flushQueue({
      store, userId: "u1",
      send: async (r) => { calls.push(r.id); if (r.id === "key-aaaaaa1") throw new ApiError({ status: 409, message: "« Fufu » n'est plus disponible" }); return order(7); },
    });
    expect(res.failed.map((f) => f.error)).toEqual(["« Fufu » n'est plus disponible"]);
    expect(res.sent).toHaveLength(1);
    expect(store.rows.get("key-aaaaaa1")?.status).toBe("failed");
    // un second passage ne retente pas la commande refusée
    await flushQueue({ store, userId: "u1", send: async (r) => { calls.push(r.id); return order(8); } });
    expect(calls).toEqual(["key-aaaaaa1", "key-bbbbbb2"]);
  });

  it("ne rejoue jamais la requête d'un autre utilisateur de l'appareil", async () => {
    const store = memStore([req("key-aaaaaa1", { userId: "autre" })]);
    const res = await flushQueue({ store, userId: "u1", send: async () => { throw new Error("ne doit pas être appelé"); } });
    expect(res.sent).toHaveLength(0);
    expect(store.rows.size).toBe(1);
  });
});

describe("conservation de la carte et des tables", () => {
  const root = ["tenant", "demo"] as const;
  it("ne retient que la carte, les tables et deux réglages", () => {
    const ok = [["menu"], ["menu", "formulas"], ["menu", "promotions"], ["tables"], ["settings", "operations"], ["settings", "localization"]];
    const ko = [["orders", "list", {}], ["orders", "detail", "x"], ["kitchen"], ["register"], ["settings", "security"], ["reports"], ["staff"], ["hr", "me"], ["delivery", "board"], ["chat", "messages", "c"]];
    for (const k of ok) expect(isPersistableKey([...root, ...k], root), k.join("/")).toBe(true);
    for (const k of ko) expect(isPersistableKey([...root, ...k], root), k.join("/")).toBe(false);
    expect(isPersistableKey(["tenant", "autre", "menu"], root)).toBe(false);      // jamais un autre restaurant
    expect(isPersistableKey(["platform", "menu"], root)).toBe(false);
  });

  it("instantané : exclut les commandes, refuse un autre utilisateur ou un instantané trop ancien", () => {
    const qc = new QueryClient();
    qc.setQueryData([...root, "menu"], [{ id: "c1" }]);
    qc.setQueryData([...root, "tables"], [{ id: "t1", openOrders: [{ id: "o9", total: 7777, paidAmount: 100 }] }]);
    qc.setQueryData([...root, "orders", "detail", "o1"], { id: "o1", total: 5000 });
    const snap = snapshotOf(qc, root, "u1");
    expect(snap.entries.map((e) => e.key.join("/")).sort()).toEqual(["tenant/demo/menu", "tenant/demo/tables"]);
    expect(JSON.stringify(snap)).not.toMatch(/5000|7777|paidAmount/);

    const other = new QueryClient();
    expect(restoreSnapshot(other, root, snap, "u2")).toBe(0);                                  // autre compte
    expect(restoreSnapshot(other, root, snap, "u1", Date.now() + 15 * 24 * 3_600_000)).toBe(0); // périmé (14 jours)
    expect(restoreSnapshot(other, root, snap, "u1")).toBe(2);
    expect(other.getQueryData([...root, "tables"])).toEqual([{ id: "t1", openOrders: [] }]);
    expect(restoreSnapshot(new QueryClient(), ["tenant", "autre"], snap, "u1")).toBe(0);       // pas de fuite vers un autre restaurant
  });
});
