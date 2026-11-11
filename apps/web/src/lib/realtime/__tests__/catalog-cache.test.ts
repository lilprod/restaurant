import type { DiningTable, MenuCategory, MenuItem } from "@restaurant/api-client";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { tenantKeys } from "../../tenant-keys";
import { applyMenuEvent, applyTableEvent } from "../catalog-cache";

const root = ["tenant", "chez-kofi"] as const;
const dish = (p: Partial<MenuItem> = {}): MenuItem => ({
  id: "i1", categoryId: "c1", name: "Poulet braisé", description: null, price: 3500, vatRate: 18, imageUrl: null, prepMinutes: 15,
  isAvailable: true, availableFrom: null, availableTo: null, isDishOfDay: false, sortOrder: 0, archived: false, allergens: [], optionGroups: [], ...p,
});
const cat = (id: string, items: MenuItem[]): MenuCategory => ({ id, name: id, description: null, sortOrder: 0, isActive: true, items });
const table = (p: Partial<DiningTable> = {}): DiningTable => ({ id: "t1", tenantId: "t", label: "T1", capacity: 4, status: "FREE", isActive: true, openOrders: [], ...p });

describe("menu.updated", () => {
  const setup = () => {
    const qc = new QueryClient();
    qc.setQueryData(tenantKeys.menu(root), [cat("c1", [dish(), dish({ id: "i2", name: "Fufu", sortOrder: 1 })]), cat("c2", [])]);
    return qc;
  };
  const items = (qc: QueryClient, c = 0) => qc.getQueryData<MenuCategory[]>(tenantKeys.menu(root))![c]!.items;

  it("grise un plat épuisé sans toucher aux autres", () => {
    const qc = setup();
    applyMenuEvent(qc, root, dish({ isAvailable: false }));
    expect(items(qc).map((i) => [i.id, i.isAvailable])).toEqual([["i1", false], ["i2", true]]);
  });

  it("insère un nouveau plat, déplace un plat changé de catégorie, retire un plat archivé ou supprimé", () => {
    const qc = setup();
    applyMenuEvent(qc, root, dish({ id: "i3", name: "Alloco", sortOrder: 2 }));
    expect(items(qc).map((i) => i.id)).toEqual(["i1", "i2", "i3"]);
    applyMenuEvent(qc, root, dish({ categoryId: "c2" }));
    expect(items(qc, 0).map((i) => i.id)).toEqual(["i2", "i3"]);
    expect(items(qc, 1).map((i) => i.id)).toEqual(["i1"]);
    applyMenuEvent(qc, root, dish({ id: "i2", archived: true }));
    applyMenuEvent(qc, root, { id: "i3", deleted: true });
    expect(items(qc, 0)).toEqual([]);
  });

  it("recharge la carte quand la catégorie du plat est inconnue, et ignore une carte non chargée", () => {
    const qc = setup();
    applyMenuEvent(qc, root, dish({ id: "i9", categoryId: "nouvelle" }));
    expect(qc.getQueryState(tenantKeys.menu(root))!.isInvalidated).toBe(true);
    const empty = new QueryClient();
    applyMenuEvent(empty, root, dish());
    expect(empty.getQueryData(tenantKeys.menu(root))).toBeUndefined();
  });
});

describe("table.updated", () => {
  it("remplace, insère dans l'ordre des libellés et retire une table supprimée", () => {
    const qc = new QueryClient();
    qc.setQueryData(tenantKeys.tables(root), [table(), table({ id: "t10", label: "T10" })]);
    applyTableEvent(qc, root, table({ status: "OCCUPIED" }));
    applyTableEvent(qc, root, table({ id: "t2", label: "T2" }));
    expect(qc.getQueryData<DiningTable[]>(tenantKeys.tables(root))!.map((t) => [t.label, t.status])).toEqual([["T1", "OCCUPIED"], ["T2", "FREE"], ["T10", "FREE"]]);
    applyTableEvent(qc, root, { id: "t10", deleted: true });
    expect(qc.getQueryData<DiningTable[]>(tenantKeys.tables(root))!).toHaveLength(2);
  });

  it("laisse l'API trancher pour une table désactivée", () => {
    const qc = new QueryClient();
    qc.setQueryData(tenantKeys.tables(root), [table()]);
    applyTableEvent(qc, root, table({ isActive: false }));
    expect(qc.getQueryState(tenantKeys.tables(root))!.isInvalidated).toBe(true);
  });
});
