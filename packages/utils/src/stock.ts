import { vatIncluded } from "./orders";

/**
 * Stock : unités et conversions, état d'un ingrédient, coût matière et marge d'un plat, coût moyen pondéré.
 * Fonctions pures partagées par l'API, le web (coût en direct dans l'éditeur de plat) et les rapports (P5).
 * Les quantités sont gardées à 3 décimales (colonnes Decimal(12, 3)) ; les montants sont des entiers FCFA.
 */

export const STOCK_UNITS = ["g", "kg", "ml", "cl", "l", "piece"] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];

type Dimension = "mass" | "volume" | "count";
const UNIT_DEF: Record<StockUnit, { dim: Dimension; base: number; label: string }> = {
  g: { dim: "mass", base: 1, label: "g" },
  kg: { dim: "mass", base: 1000, label: "kg" },
  ml: { dim: "volume", base: 1, label: "ml" },
  cl: { dim: "volume", base: 10, label: "cl" },
  l: { dim: "volume", base: 1000, label: "l" },
  piece: { dim: "count", base: 1, label: "pièce" },
};

export const isStockUnit = (u: string): u is StockUnit => (STOCK_UNITS as readonly string[]).includes(u);
export const unitLabel = (u: string) => (isStockUnit(u) ? UNIT_DEF[u].label : u);

/** Unités dans lesquelles on peut saisir une recette pour un ingrédient stocké en `unit` (même dimension). */
export function compatibleUnits(unit: string): StockUnit[] {
  if (!isStockUnit(unit)) return [];
  return STOCK_UNITS.filter((u) => UNIT_DEF[u].dim === UNIT_DEF[unit].dim);
}

export function canConvert(from: string, to: string): boolean {
  return isStockUnit(from) && isStockUnit(to) && UNIT_DEF[from].dim === UNIT_DEF[to].dim;
}

/** Facteur multiplicatif `from → to` (ex. g → kg : 0.001). Lève une erreur si les unités sont incompatibles. */
export function unitFactor(from: string, to: string): number {
  if (!canConvert(from, to)) throw new Error(`Unités incompatibles : ${from} → ${to}`);
  return UNIT_DEF[from as StockUnit].base / UNIT_DEF[to as StockUnit].base;
}

/** Arrondi à 3 décimales (précision des colonnes de stock). */
export const roundQty = (n: number) => Math.round(n * 1000) / 1000;

export function convertQty(qty: number, from: string, to: string): number {
  return roundQty(qty * unitFactor(from, to));
}

export type StockState = "NEGATIVE" | "OUT" | "LOW" | "OK";

/** Stock bas = au plus le seuil (ou épuisé). Négatif : le service n'est jamais bloqué, mais c'est signalé. */
export function stockState(quantity: number, threshold: number): StockState {
  if (quantity < 0) return "NEGATIVE";
  if (quantity === 0) return "OUT";
  if (quantity <= threshold) return "LOW";
  return "OK";
}
export const isLowStock = (quantity: number, threshold: number) => stockState(quantity, threshold) !== "OK";

/** Valeur du stock (FCFA) : un stock négatif vaut 0. */
export const stockValue = (quantity: number, avgCost: number) => Math.round(Math.max(quantity, 0) * avgCost);

export interface CostLine {
  quantity: number;
  /** Unité de saisie ; absente = unité de l'ingrédient. */
  unit?: string | null;
  ingredient: { unit: string; avgCost: number };
}

/** Coût d'une ligne (non arrondi) : quantité convertie dans l'unité de stock × coût moyen. */
export function lineCostExact(l: CostLine): number {
  const qty = l.unit && l.unit !== l.ingredient.unit ? l.quantity * unitFactor(l.unit, l.ingredient.unit) : l.quantity;
  return qty * l.ingredient.avgCost;
}

/** Coût matière (FCFA, arrondi une seule fois) = Σ(quantité × coût moyen). */
export function recipeCost(lines: CostLine[]): number {
  return Math.round(lines.reduce((s, l) => s + lineCostExact(l), 0));
}

/** Marge d'un plat : prix TTC hors TVA − coût matière ; taux = marge / prix HT (null si prix nul). */
export function dishMargin(price: number, vatRate: number, cost: number) {
  const net = price - vatIncluded(price, vatRate);
  const margin = net - cost;
  return { net, cost, margin, marginRate: net > 0 ? Math.round((margin / net) * 1000) / 10 : null };
}

/**
 * Coût moyen pondéré après une réception : (stock × coût moyen + reçu × prix) / (stock + reçu).
 * Un stock négatif compte pour zéro (on ne valorise pas une dette de stock).
 */
export function weightedAvgCost(stockQty: number, avgCost: number, receivedQty: number, unitCost: number): number {
  const q = Math.max(stockQty, 0);
  if (receivedQty <= 0) return avgCost;
  if (q + receivedQty <= 0) return unitCost;
  return Math.round((q * avgCost + receivedQty * unitCost) / (q + receivedQty));
}

/** Montant d'une ligne de commande fournisseur (FCFA). */
export const purchaseLineTotal = (quantity: number, unitCost: number) => Math.round(quantity * unitCost);
