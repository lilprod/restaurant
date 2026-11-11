import type { Ingredient, StockLight } from "@restaurant/api-client";
import { stockValue } from "@restaurant/utils";
import type { QueryClient } from "@tanstack/react-query";
import { tenantKeys } from "../tenant-keys";

type Root = readonly unknown[];

/** Charge utile de `stock.updated`. `stock.low` porte un seul `StockLight` (une fois par franchissement de seuil). */
export type StockUpdatedEvent = { ingredients: StockLight[] };

/** Reporte quantités et états reçus en temps réel dans une liste d'ingrédients (valeur recalculée au coût moyen connu). */
export function applyStockLights(list: Ingredient[], lights: StockLight[]): Ingredient[] {
  const byId = new Map(lights.map((l) => [l.id, l]));
  let changed = false;
  const next = list.map((i) => {
    const l = byId.get(i.id);
    if (!l) return i;
    changed = true;
    return { ...i, quantity: l.quantity, lowStockThreshold: l.lowStockThreshold, state: l.state, value: stockValue(l.quantity, i.avgCost) };
  });
  return changed ? next : list;
}

/** Met à jour les listes d'ingrédients en place ; alertes, mouvements et pertes sont rechargés s'ils sont affichés. */
export function applyStockEvent(qc: QueryClient, root: Root, e: StockUpdatedEvent) {
  for (const [key, data] of qc.getQueriesData<Ingredient[]>({ queryKey: tenantKeys.ingredientLists(root) })) {
    if (data) qc.setQueryData(key, applyStockLights(data, e.ingredients));
  }
  void qc.invalidateQueries({ queryKey: tenantKeys.stockAlerts(root) });
  void qc.invalidateQueries({ queryKey: [...tenantKeys.stock(root), "movements"] });
  void qc.invalidateQueries({ queryKey: [...tenantKeys.stock(root), "waste"] });
}
