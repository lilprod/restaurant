/**
 * Calculs des commandes, partagés par l'API (source de vérité) et les interfaces (affichage en direct).
 * Tous les montants sont des FCFA entiers ; les prix du menu sont TTC (TVA incluse).
 */

export type ItemStatus = "PENDING" | "IN_PROGRESS" | "READY" | "SERVED" | "CANCELLED";
export type OrderStatus = "PENDING" | "IN_PROGRESS" | "READY" | "DELIVERED" | "CANCELLED";
export type OrderPaymentStatus = "UNPAID" | "PARTIAL" | "PAID";

/** Montant TTC d'une ligne : (prix unitaire + suppléments) × quantité. */
export function lineTotal(unitPrice: number, optionsExtra: number, quantity: number): number {
  return (unitPrice + optionsExtra) * quantity;
}

/** Part de TVA contenue dans un montant TTC (arrondie au franc). */
export function vatIncluded(amountTtc: number, ratePercent: number): number {
  if (ratePercent <= 0) return 0;
  return Math.round((amountTtc * ratePercent) / (100 + ratePercent));
}

export interface TotalsInput {
  items: { lineTotal: number; vatRate: number; status: ItemStatus }[];
  serviceChargePercent: number;
  /** Taux appliqué au service (taux par défaut du restaurant). */
  defaultVatRate: number;
}

export interface Totals {
  /** Somme TTC des lignes non annulées. */
  subtotal: number;
  serviceCharge: number;
  /** Montant dû (hors pourboire). */
  total: number;
  /** TVA contenue dans le total. */
  vat: number;
  /** Détail par taux, pour le ticket. */
  vatBreakdown: { rate: number; base: number; vat: number }[];
}

export function computeTotals({ items, serviceChargePercent, defaultVatRate }: TotalsInput): Totals {
  const live = items.filter((i) => i.status !== "CANCELLED");
  const subtotal = live.reduce((n, i) => n + i.lineTotal, 0);
  const serviceCharge = Math.round((subtotal * serviceChargePercent) / 100);

  const byRate = new Map<number, number>();
  for (const i of live) byRate.set(i.vatRate, (byRate.get(i.vatRate) ?? 0) + i.lineTotal);
  if (serviceCharge > 0) byRate.set(defaultVatRate, (byRate.get(defaultVatRate) ?? 0) + serviceCharge);

  const vatBreakdown = [...byRate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rate, ttc]) => {
      const vat = vatIncluded(ttc, rate);
      return { rate, base: ttc - vat, vat };
    });
  return { subtotal, serviceCharge, total: subtotal + serviceCharge, vat: vatBreakdown.reduce((n, r) => n + r.vat, 0), vatBreakdown };
}

/** Partage égal d'un montant entre n personnes, sans perdre de franc (les premiers paient l'arrondi). */
export function splitEqually(amount: number, people: number): number[] {
  if (people < 1) return [];
  const base = Math.floor(amount / people);
  const rest = amount - base * people;
  return Array.from({ length: people }, (_, i) => base + (i < rest ? 1 : 0));
}

/** Statut d'une commande déduit de ses articles (les articles annulés sont ignorés). */
export function deriveOrderStatus(statuses: ItemStatus[]): OrderStatus {
  const live = statuses.filter((s) => s !== "CANCELLED");
  if (live.length === 0) return statuses.length ? "CANCELLED" : "PENDING";
  if (live.every((s) => s === "SERVED")) return "DELIVERED";
  if (live.every((s) => s === "READY" || s === "SERVED")) return "READY";
  if (live.every((s) => s === "PENDING")) return "PENDING";
  return "IN_PROGRESS";
}

export function paymentStatusFor(paid: number, due: number): OrderPaymentStatus {
  if (paid <= 0) return "UNPAID";
  return paid >= due ? "PAID" : "PARTIAL";
}

/**
 * Transitions autorisées pour un article. La cuisine peut revenir d'un cran (erreur de manipulation) ;
 * l'annulation d'un article déjà lancé est réservée aux responsables (vérifié côté API).
 */
const NEXT: Record<ItemStatus, ItemStatus[]> = {
  PENDING: ["IN_PROGRESS", "READY", "CANCELLED"],
  IN_PROGRESS: ["READY", "PENDING", "CANCELLED"],
  READY: ["SERVED", "IN_PROGRESS", "CANCELLED"],
  SERVED: ["READY"],
  CANCELLED: [],
};

export function canTransition(from: ItemStatus, to: ItemStatus): boolean {
  return NEXT[from].includes(to);
}
