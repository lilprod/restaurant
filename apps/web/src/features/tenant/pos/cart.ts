import type { MenuItem, MenuOptionGroup } from "@restaurant/api-client";
import { computeTotals, lineTotal, type Totals } from "@restaurant/utils";
import type { OrderItemInput } from "@restaurant/validation";

/** Ligne du panier de prise de commande (avant envoi en cuisine). */
export interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  unitPrice: number;
  vatRate: number;
  options: { id: string; name: string; extra: number }[];
  quantity: number;
  instructions: string;
  course: number;
}

export type CartAction =
  | { type: "add"; item: Pick<MenuItem, "id" | "name" | "price" | "vatRate" | "optionGroups">; optionIds?: string[]; quantity?: number; instructions?: string; course?: number }
  | { type: "quantity"; key: string; quantity: number }
  | { type: "update"; key: string; patch: Partial<Pick<CartLine, "instructions" | "course">> }
  | { type: "remove"; key: string }
  | { type: "clear" };

export const MAX_QUANTITY = 99;

/** Signature d'une ligne : deux ajouts identiques (plat, options, consigne, envoi) se cumulent. */
export function lineSignature(menuItemId: string, optionIds: string[], instructions = "", course = 1): string {
  return [menuItemId, [...optionIds].sort().join("+"), instructions.trim().toLowerCase(), course].join("|");
}

export function optionsExtra(line: Pick<CartLine, "options">): number {
  return line.options.reduce((n, o) => n + o.extra, 0);
}

export function cartLineTotal(line: CartLine): number {
  return lineTotal(line.unitPrice, optionsExtra(line), line.quantity);
}

export function cartReducer(lines: CartLine[], action: CartAction): CartLine[] {
  switch (action.type) {
    case "add": {
      const optionIds = action.optionIds ?? [];
      const instructions = (action.instructions ?? "").trim();
      const course = action.course ?? 1;
      const key = lineSignature(action.item.id, optionIds, instructions, course);
      const qty = action.quantity ?? 1;
      const existing = lines.find((l) => l.key === key);
      if (existing) {
        return lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(MAX_QUANTITY, l.quantity + qty) } : l));
      }
      const options = action.item.optionGroups.flatMap((g) => g.options).filter((o) => optionIds.includes(o.id));
      return [...lines, {
        key, menuItemId: action.item.id, name: action.item.name, unitPrice: action.item.price, vatRate: action.item.vatRate,
        options: options.map((o) => ({ id: o.id, name: o.name, extra: o.extra })), quantity: Math.min(MAX_QUANTITY, qty), instructions, course,
      }];
    }
    case "quantity":
      if (action.quantity <= 0) return lines.filter((l) => l.key !== action.key);
      return lines.map((l) => (l.key === action.key ? { ...l, quantity: Math.min(MAX_QUANTITY, action.quantity) } : l));
    case "update": {
      const target = lines.find((l) => l.key === action.key);
      if (!target) return lines;
      const next = { ...target, ...action.patch };
      next.instructions = next.instructions.slice(0, 200);
      const key = lineSignature(next.menuItemId, next.options.map((o) => o.id), next.instructions, next.course);
      // La nouvelle consigne rend la ligne identique à une autre : on fusionne.
      const twin = lines.find((l) => l.key === key && l.key !== action.key);
      if (twin) {
        return lines.filter((l) => l.key !== action.key).map((l) => (l.key === key ? { ...l, quantity: Math.min(MAX_QUANTITY, l.quantity + target.quantity) } : l));
      }
      return lines.map((l) => (l.key === action.key ? { ...next, key } : l));
    }
    case "remove":
      return lines.filter((l) => l.key !== action.key);
    case "clear":
      return [];
  }
}

/** Totaux affichés en direct : même calcul que l'API (prix TTC, service, TVA incluse par taux). */
export function cartTotals(lines: CartLine[], ops: { serviceChargePercent: number; defaultVatRate: number }): Totals {
  return computeTotals({
    items: lines.map((l) => ({ lineTotal: cartLineTotal(l), vatRate: l.vatRate, status: "PENDING" as const })),
    serviceChargePercent: ops.serviceChargePercent,
    defaultVatRate: ops.defaultVatRate,
  });
}

export const cartCount = (lines: CartLine[]) => lines.reduce((n, l) => n + l.quantity, 0);

/** Corps de la requête (POST /tenant/orders ou /:id/items). */
export function toOrderItems(lines: CartLine[]): OrderItemInput[] {
  return lines.map((l) => ({
    menuItemId: l.menuItemId,
    quantity: l.quantity,
    optionIds: l.options.map((o) => o.id),
    instructions: l.instructions.trim() || undefined,
    course: l.course,
  }));
}

// ── Options d'un plat ──

export interface GroupCheck { groupId: string; count: number; ok: boolean; message: string | null; full: boolean }

/** Règle min/max de chaque groupe (miroir de la vérification de l'API). */
export function checkSelection(groups: MenuOptionGroup[], selected: string[]): GroupCheck[] {
  return groups.map((g) => {
    const count = g.options.filter((o) => selected.includes(o.id)).length;
    let message: string | null = null;
    if (count < g.minChoices) message = g.minChoices === 1 ? "Choisissez une option" : `Choisissez au moins ${g.minChoices} options`;
    else if (count > g.maxChoices) message = `${g.maxChoices} choix maximum`;
    return { groupId: g.id, count, ok: message === null, message, full: count >= g.maxChoices };
  });
}

/**
 * Bascule une option. Groupe à choix unique : remplace le choix précédent (comportement d'un bouton radio).
 * Groupe à choix multiples : ajoute tant que le maximum n'est pas atteint.
 */
export function toggleOption(groups: MenuOptionGroup[], selected: string[], optionId: string): string[] {
  const group = groups.find((g) => g.options.some((o) => o.id === optionId));
  if (!group) return selected;
  if (selected.includes(optionId)) return selected.filter((id) => id !== optionId);
  const inGroup = group.options.map((o) => o.id);
  if (group.maxChoices === 1) return [...selected.filter((id) => !inGroup.includes(id)), optionId];
  const count = selected.filter((id) => inGroup.includes(id)).length;
  if (count >= group.maxChoices) return selected;
  return [...selected, optionId];
}

/** Présélection : un groupe obligatoire à une seule option est coché d'office. */
export function defaultSelection(groups: MenuOptionGroup[]): string[] {
  return groups.filter((g) => g.minChoices >= 1 && g.options.length === g.minChoices).flatMap((g) => g.options.map((o) => o.id));
}

export function selectionExtra(groups: MenuOptionGroup[], selected: string[]): number {
  return groups.flatMap((g) => g.options).filter((o) => selected.includes(o.id)).reduce((n, o) => n + o.extra, 0);
}

/** Libellé court des règles d'un groupe : « Obligatoire », « Facultatif · 2 max »… */
export function groupRuleLabel(g: Pick<MenuOptionGroup, "minChoices" | "maxChoices">): string {
  if (g.minChoices === 0) return g.maxChoices === 1 ? "Facultatif" : `Facultatif · ${g.maxChoices} max`;
  if (g.minChoices === g.maxChoices) return g.minChoices === 1 ? "Obligatoire" : `${g.minChoices} choix obligatoires`;
  return `${g.minChoices} à ${g.maxChoices} choix`;
}
