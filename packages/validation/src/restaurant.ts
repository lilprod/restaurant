import { z } from "zod";

/** Schémas de la phase 1 : équipe, tables, menu, commandes, encaissement, caisse. */

const uuid = z.string().uuid();
const money = z.number().int().min(0).max(100_000_000);
const optText = (max: number) => z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));

// ── Équipe du restaurant ──
export const staffRoleSchema = z.enum(["ADMIN", "MANAGER", "WAITER", "KITCHEN"]);
export const createStaffSchema = z.object({
  email: z.string().trim().email(),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  phone: optText(25),
  role: staffRoleSchema,
});
export const updateStaffSchema = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  phone: optText(25),
  role: staffRoleSchema.optional(),
});

// ── Tables ──
export const tableStatusSchema = z.enum(["FREE", "RESERVED", "OCCUPIED", "CLEANING"]);
export const tableInputSchema = z.object({
  label: z.string().trim().min(1).max(20),
  capacity: z.number().int().min(1).max(50),
  isActive: z.boolean().default(true),
});
export const tableUpdateSchema = tableInputSchema.partial().extend({ status: tableStatusSchema.optional() });

// ── Menu ──
export const categoryInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: optText(200),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  isActive: z.boolean().default(true),
});
export const categoryUpdateSchema = categoryInputSchema.partial();
export const reorderSchema = z.object({ ids: z.array(uuid).min(1).max(500) });

export const optionGroupInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    minChoices: z.number().int().min(0).max(20).default(0),
    maxChoices: z.number().int().min(1).max(20).default(1),
    options: z.array(z.object({ name: z.string().trim().min(1).max(60), extra: money.default(0) })).min(1).max(30),
  })
  .refine((g) => g.minChoices <= g.maxChoices, { message: "Le minimum dépasse le maximum", path: ["minChoices"] })
  .refine((g) => g.minChoices <= g.options.length, { message: "Pas assez d'options pour le minimum demandé", path: ["minChoices"] });

export const menuItemInputSchema = z.object({
  categoryId: uuid,
  name: z.string().trim().min(1).max(80),
  description: optText(400),
  price: money,
  /** Taux de TVA en % ; par défaut celui du restaurant (paramètres « exploitation »). */
  vatRate: z.number().min(0).max(30).optional(),
  prepMinutes: z.number().int().min(0).max(240).default(10),
  isAvailable: z.boolean().default(true),
  isDishOfDay: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  allergenCodes: z.array(z.string().min(2).max(20)).max(14).default([]),
  /** Les groupes d'options sont remplacés en bloc à chaque enregistrement. */
  optionGroups: z.array(optionGroupInputSchema).max(10).default([]),
});
export const menuItemUpdateSchema = menuItemInputSchema.partial();
export const availabilitySchema = z.object({ isAvailable: z.boolean() });

// ── Commandes ──
export const orderTypeSchema = z.enum(["DINE_IN", "TAKEAWAY"]);
export const orderItemInputSchema = z.object({
  menuItemId: uuid,
  quantity: z.number().int().min(1).max(99),
  optionIds: z.array(uuid).max(30).default([]),
  instructions: optText(200),
  course: z.number().int().min(1).max(5).default(1),
});
export const createOrderSchema = z
  .object({
    type: orderTypeSchema,
    tableId: uuid.optional(),
    customerName: optText(60),
    notes: optText(300),
    items: z.array(orderItemInputSchema).min(1).max(100),
  })
  .refine((o) => o.type !== "DINE_IN" || !!o.tableId, { message: "Choisissez une table", path: ["tableId"] });
export const addItemsSchema = z.object({ items: z.array(orderItemInputSchema).min(1).max(100) });
export const updateOrderItemSchema = z.object({
  quantity: z.number().int().min(1).max(99).optional(),
  instructions: optText(200),
});
export const itemStatusSchema = z.object({ status: z.enum(["PENDING", "IN_PROGRESS", "READY", "SERVED"]) });
export const reasonSchema = z.object({ reason: z.string().trim().min(3).max(200) });
export const listOrdersQuerySchema = z.object({
  status: z.enum(["PENDING", "IN_PROGRESS", "READY", "DELIVERED", "CANCELLED"]).optional(),
  paymentStatus: z.enum(["UNPAID", "PARTIAL", "PAID"]).optional(),
  type: orderTypeSchema.optional(),
  tableId: uuid.optional(),
  /** Commandes non clôturées (en cours de service). */
  open: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  /** Jour (AAAA-MM-JJ) dans le fuseau du restaurant. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

// ── Encaissement ──
export const orderPaymentMethodSchema = z.enum(["CASH", "CARD", "FLOOZ", "TMONEY", "OTHER"]);
export const orderPaymentSchema = z
  .object({
    method: orderPaymentMethodSchema,
    /** Montant affecté à l'addition (hors pourboire). */
    amount: z.number().int().min(1).max(100_000_000),
    tip: money.default(0),
    /** Espèces : somme remise par le client (pour calculer la monnaie). */
    tendered: money.optional(),
    reference: optText(80),
    /** Partage par article : quantités payées par ligne. */
    allocations: z.array(z.object({ orderItemId: uuid, quantity: z.number().int().min(1).max(99) })).max(100).optional(),
  })
  .refine((p) => !["FLOOZ", "TMONEY"].includes(p.method) || !!p.reference, {
    message: "La référence de transaction est obligatoire", path: ["reference"],
  })
  .refine((p) => p.method !== "CASH" || p.tendered === undefined || p.tendered >= p.amount + p.tip, {
    message: "La somme remise est inférieure au montant", path: ["tendered"],
  });

// ── Caisse ──
export const openRegisterSchema = z.object({ opening: money });
export const closeRegisterSchema = z.object({ counted: money, notes: optText(300) });

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type TableInput = z.infer<typeof tableInputSchema>;
export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type MenuItemInput = z.infer<typeof menuItemInputSchema>;
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type OrderPaymentInput = z.infer<typeof orderPaymentSchema>;
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
