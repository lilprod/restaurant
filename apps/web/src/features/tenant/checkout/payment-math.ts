import type { Order, OrderItem } from "@restaurant/api-client";
import { splitEqually } from "@restaurant/utils";

/** Articles encore à régler dans un partage « par article » (quantité restante > 0). */
export function payableItems(order: Pick<Order, "items">): (OrderItem & { left: number })[] {
  return order.items
    .filter((i) => i.status !== "CANCELLED")
    .map((i) => ({ ...i, left: Math.max(0, i.quantity - i.paidQuantity) }))
    .filter((i) => i.left > 0);
}

export interface ItemSplit {
  /** Montant à encaisser (articles + part du service), plafonné au reste à payer. */
  amount: number;
  itemsAmount: number;
  serviceShare: number;
  allocations: { orderItemId: string; quantity: number }[];
}

/**
 * Partage par article : somme des articles choisis + part proportionnelle du service. Si tout ce qui reste
 * est choisi, le montant est exactement le reste à payer (aucun franc perdu à l'arrondi).
 */
export function splitByItems(order: Pick<Order, "items" | "subtotal" | "serviceCharge" | "remaining">, picked: Record<string, number>): ItemSplit {
  const items = payableItems(order);
  const allocations: ItemSplit["allocations"] = [];
  let itemsAmount = 0;
  let allPicked = items.length > 0;
  for (const i of items) {
    const q = Math.max(0, Math.min(i.left, Math.floor(picked[i.id] ?? 0)));
    if (q < i.left) allPicked = false;
    if (q > 0) {
      allocations.push({ orderItemId: i.id, quantity: q });
      itemsAmount += (i.unitPrice + i.optionsExtra) * q;
    }
  }
  if (!allocations.length) return { amount: 0, itemsAmount: 0, serviceShare: 0, allocations };
  const serviceShare = order.subtotal > 0 ? Math.round((itemsAmount * order.serviceCharge) / order.subtotal) : 0;
  const amount = allPicked ? order.remaining : Math.min(order.remaining, itemsAmount + serviceShare);
  return { amount, itemsAmount, serviceShare: allPicked ? Math.max(0, order.remaining - itemsAmount) : serviceShare, allocations };
}

/**
 * Partage égal « part par part » : le reste est redivisé entre les personnes qui n'ont pas encore payé,
 * ce qui donne les mêmes parts que `splitEqually(total, n)` sans avoir à mémoriser le total de départ.
 */
export function equalParts(remaining: number, people: number, paidParts: number): number[] {
  const left = Math.max(0, people - paidParts);
  if (left === 0 || remaining <= 0) return [];
  return splitEqually(remaining, left);
}

/** Monnaie à rendre (négatif = il manque de l'argent). */
export function changeDue(tendered: number, amount: number, tip: number): number {
  return tendered - amount - tip;
}

/**
 * Montants remis proposés pour les espèces : exact, puis arrondis supérieurs usuels (billets FCFA :
 * 500, 1 000, 2 000, 5 000, 10 000). Au plus `max` propositions, croissantes et sans doublon.
 */
export function quickTenders(due: number, max = 4): number[] {
  if (due <= 0) return [];
  const out = new Set<number>([due]);
  for (const step of [500, 1000, 2000, 5000, 10000]) {
    const v = Math.ceil(due / step) * step;
    if (v > due) out.add(v);
    if (out.size >= max) break;
  }
  return [...out].sort((a, b) => a - b).slice(0, max);
}

/** Pourboire calculé à partir d'un pourcentage (préréglages de l'exploitation), arrondi à 50 FCFA. */
export function tipFromPercent(amount: number, percent: number): number {
  return Math.round((amount * percent) / 100 / 50) * 50;
}
