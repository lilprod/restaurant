import type { OrderItem } from "@restaurant/api-client";

/** Lignes dans l'ordre d'affichage : chaque ligne « formule » est suivie de ses plats (lignes enfants à 0 FCFA). */
export function orderLines<T extends Pick<OrderItem, "id" | "parentItemId">>(items: T[]): T[] {
  const kids = new Map<string, T[]>();
  for (const i of items) if (i.parentItemId) kids.set(i.parentItemId, [...(kids.get(i.parentItemId) ?? []), i]);
  return items.filter((i) => !i.parentItemId).flatMap((i) => [i, ...(kids.get(i.id) ?? [])]);
}
