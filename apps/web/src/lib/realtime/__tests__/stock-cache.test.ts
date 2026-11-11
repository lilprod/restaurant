import type { Ingredient } from "@restaurant/api-client";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { tenantKeys } from "../../tenant-keys";
import { applyStockEvent, applyStockLights } from "../stock-cache";

const root = ["tenant", "chez-kofi"] as const;
const ing = (p: Partial<Ingredient> = {}): Ingredient => ({
  id: "a", name: "Riz", unit: "kg", category: null, quantity: 10, lowStockThreshold: 2, reorderQty: null, avgCost: 800, value: 8000,
  state: "OK", autoDisable: false, isActive: true, supplier: null, lowAlertedAt: null, updatedAt: "2026-11-11T10:00:00Z", ...p,
});

describe("stock.updated", () => {
  it("reporte quantité, état et valeur sans toucher aux autres ingrédients", () => {
    const list = [ing(), ing({ id: "b", name: "Huile" })];
    const next = applyStockLights(list, [{ id: "a", name: "Riz", unit: "kg", quantity: 1.5, lowStockThreshold: 2, state: "LOW" }]);
    expect(next[0]).toMatchObject({ quantity: 1.5, state: "LOW", value: 1200 });
    expect(next[1]).toBe(list[1]);
    expect(applyStockLights(list, [{ id: "zz", name: "x", unit: "g", quantity: 0, lowStockThreshold: 0, state: "OUT" }])).toBe(list);
  });

  it("met à jour toutes les listes filtrées en cache ; valeur nulle si le stock est négatif", () => {
    const qc = new QueryClient();
    qc.setQueryData(tenantKeys.ingredients(root, {}), [ing()]);
    qc.setQueryData(tenantKeys.ingredients(root, { state: "ALERT" }), [ing()]);
    applyStockEvent(qc, root, { ingredients: [{ id: "a", name: "Riz", unit: "kg", quantity: -1, lowStockThreshold: 2, state: "NEGATIVE" }] });
    for (const q of [{}, { state: "ALERT" }]) {
      expect(qc.getQueryData<Ingredient[]>(tenantKeys.ingredients(root, q))![0]).toMatchObject({ quantity: -1, state: "NEGATIVE", value: 0 });
    }
  });
});
