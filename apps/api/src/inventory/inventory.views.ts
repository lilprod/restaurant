import { Prisma } from "@prisma/client";
import { roundQty, stockState, stockValue } from "@restaurant/utils";

export const ingredientInclude = { supplier: { select: { id: true, name: true } } } satisfies Prisma.IngredientInclude;
type IngredientRow = Prisma.IngredientGetPayload<{ include: typeof ingredientInclude }>;

const num = (d: Prisma.Decimal | null | undefined) => (d == null ? null : Number(d));

/** Forme publique d'un ingrédient (API). */
export function ingredientView(i: IngredientRow) {
  const quantity = Number(i.quantity);
  const threshold = Number(i.lowStockThreshold);
  return {
    id: i.id, name: i.name, unit: i.unit, category: i.category, quantity, lowStockThreshold: threshold,
    reorderQty: num(i.reorderQty), avgCost: i.avgCost, value: stockValue(quantity, i.avgCost), state: stockState(quantity, threshold),
    autoDisable: i.autoDisable, isActive: i.isActive, supplier: i.supplier, lowAlertedAt: i.lowAlertedAt, updatedAt: i.updatedAt,
  };
}
export type IngredientView = ReturnType<typeof ingredientView>;

/** Quantité suggérée à commander : quantité de réapprovisionnement, sinon de quoi revenir à deux fois le seuil. */
export function suggestedQty(i: IngredientView): number | null {
  if (i.reorderQty) return i.reorderQty;
  return i.lowStockThreshold > 0 ? roundQty(2 * i.lowStockThreshold - i.quantity) : null;
}

export type UserNames = Map<string, { id: string; firstName: string; lastName: string }>;
