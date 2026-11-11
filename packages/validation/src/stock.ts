import { z } from "zod";
import { STOCK_UNITS } from "@restaurant/utils";

/** Schémas du stock (P3) : ingrédients, recettes, pertes, inventaires, fournisseurs, commandes fournisseurs. */

const uuid = z.string().uuid();
const money = z.number().int().min(0).max(100_000_000);
const optText = (max: number) => z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === "" ? null : v));
const threeDecimals = (n: number) => Math.abs(Math.round(n * 1000) - n * 1000) < 1e-6;
/** Quantité de stock : 3 décimales au plus. */
const qty = z.number().min(0).max(1_000_000_000).refine(threeDecimals, "3 décimales au maximum");
const positiveQty = qty.refine((n) => n > 0, "La quantité doit être supérieure à 0");
const isoDate = z.coerce.date();

export const stockUnitSchema = z.enum(STOCK_UNITS);
export const movementTypeSchema = z.enum(["PURCHASE", "ORDER_DEDUCTION", "WASTE", "ADJUSTMENT", "RETURN"]);

// ── Ingrédients ──
export const ingredientInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  unit: stockUnitSchema,
  category: optText(40),
  lowStockThreshold: qty.default(0),
  reorderQty: qty.nullable().optional(),
  avgCost: money.default(0),
  supplierId: uuid.nullable().optional(),
  autoDisable: z.boolean().default(false),
  /** Stock de départ (mouvement ADJUSTMENT « Stock initial »). */
  initialQuantity: qty.optional(),
});
export const ingredientUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  unit: stockUnitSchema.optional(),
  category: nullableText(40),
  lowStockThreshold: qty.optional(),
  reorderQty: qty.nullable().optional(),
  avgCost: money.optional(),
  supplierId: uuid.nullable().optional(),
  autoDisable: z.boolean().optional(),
  /** Restaurer un ingrédient archivé. */
  isActive: z.boolean().optional(),
});
export const listIngredientsQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  category: z.string().trim().max(40).optional(),
  state: z.enum(["LOW", "OUT", "NEGATIVE", "OK", "ALERT"]).optional(),
  archived: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});
/** Correction ponctuelle (signée) du stock d'un ingrédient. */
export const stockAdjustSchema = z.object({
  delta: z.number().min(-1_000_000_000).max(1_000_000_000).refine(threeDecimals, "3 décimales au maximum").refine((n) => n !== 0, "La correction ne peut pas être nulle"),
  reason: z.string().trim().min(3).max(200),
});

// ── Recettes ──
export const recipeLineInputSchema = z.object({
  ingredientId: uuid,
  quantity: positiveQty,
  unit: stockUnitSchema.optional(),
});
export const recipeInputSchema = z.object({
  lines: z.array(recipeLineInputSchema).max(60).refine(
    (ls) => new Set(ls.map((l) => l.ingredientId)).size === ls.length,
    "Un ingrédient ne peut apparaître qu'une fois dans la recette",
  ),
});

// ── Mouvements et pertes ──
export const listMovementsQuerySchema = z.object({
  ingredientId: uuid.optional(),
  type: movementTypeSchema.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export const wasteInputSchema = z.object({
  ingredientId: uuid,
  quantity: positiveQty,
  unit: stockUnitSchema.optional(),
  reason: z.string().trim().min(3).max(200),
});
export const listWasteQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

// ── Inventaire physique ──
export const createStockCountSchema = z.object({
  category: optText(40),
  notes: optText(300),
});
export const stockCountLinesSchema = z.object({
  lines: z.array(z.object({ ingredientId: uuid, countedQty: qty.nullable() })).min(1).max(1000),
});

// ── Fournisseurs ──
export const supplierInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  contact: optText(80),
  email: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  phone: optText(25),
  address: optText(200),
  notes: optText(300),
});
export const supplierUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  contact: nullableText(80),
  email: z.string().trim().email().nullable().optional().or(z.literal("").transform(() => null)),
  phone: nullableText(25),
  address: nullableText(200),
  notes: nullableText(300),
  isActive: z.boolean().optional(),
});

// ── Commandes fournisseurs ──
export const purchaseStatusSchema = z.enum(["DRAFT", "SENT", "PARTIAL", "RECEIVED", "CANCELLED"]);
export const purchaseLineInputSchema = z.object({
  ingredientId: uuid,
  quantity: positiveQty,
  unitCost: money,
});
const purchaseLines = z.array(purchaseLineInputSchema).min(1, "Ajoutez au moins une ligne").max(200).refine(
  (ls) => new Set(ls.map((l) => l.ingredientId)).size === ls.length,
  "Un ingrédient ne peut apparaître qu'une fois dans la commande",
);
export const purchaseOrderInputSchema = z.object({
  supplierId: uuid,
  expectedAt: isoDate.optional(),
  notes: optText(300),
  lines: purchaseLines,
});
export const purchaseOrderUpdateSchema = z.object({
  supplierId: uuid.optional(),
  expectedAt: isoDate.nullable().optional(),
  notes: nullableText(300),
  lines: purchaseLines.optional(),
});
export const listPurchaseOrdersQuerySchema = z.object({
  status: purchaseStatusSchema.optional(),
  supplierId: uuid.optional(),
});
/** Réception (partielle ou totale) : quantités reçues maintenant, prix réel éventuellement corrigé. */
export const receivePurchaseSchema = z.object({
  lines: z.array(z.object({ lineId: uuid, quantity: qty, unitCost: money.optional() }))
    .min(1).max(200)
    .refine((ls) => ls.some((l) => l.quantity > 0), "Indiquez au moins une quantité reçue"),
});

export type IngredientInput = z.infer<typeof ingredientInputSchema>;
export type IngredientUpdate = z.infer<typeof ingredientUpdateSchema>;
export type ListIngredientsQuery = z.infer<typeof listIngredientsQuerySchema>;
export type StockAdjustInput = z.infer<typeof stockAdjustSchema>;
export type RecipeInput = z.infer<typeof recipeInputSchema>;
export type ListMovementsQuery = z.infer<typeof listMovementsQuerySchema>;
export type WasteInput = z.infer<typeof wasteInputSchema>;
export type ListWasteQuery = z.infer<typeof listWasteQuerySchema>;
export type CreateStockCountInput = z.infer<typeof createStockCountSchema>;
export type StockCountLinesInput = z.infer<typeof stockCountLinesSchema>;
export type SupplierInput = z.infer<typeof supplierInputSchema>;
export type SupplierUpdate = z.infer<typeof supplierUpdateSchema>;
export type PurchaseOrderInput = z.infer<typeof purchaseOrderInputSchema>;
export type PurchaseOrderUpdate = z.infer<typeof purchaseOrderUpdateSchema>;
export type ListPurchaseOrdersQuery = z.infer<typeof listPurchaseOrdersQuerySchema>;
export type ReceivePurchaseInput = z.infer<typeof receivePurchaseSchema>;
