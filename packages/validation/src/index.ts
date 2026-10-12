import { z } from "zod";

/** Schémas Zod partagés entre l'API, le web et le mobile. */

const slug = z
  .string()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Lettres minuscules, chiffres et tirets uniquement");

const password = z.string().min(8, "8 caractères minimum").max(128);
const phone = z.string().min(6).max(20).optional();

export const billingCycleSchema = z.enum(["MONTHLY", "YEARLY"]);
export const platformPaymentMethodSchema = z.enum(["CASH", "CARD", "FLOOZ", "TMONEY"]);

// ── Authentification plateforme ──
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export const refreshSchema = z.object({ refreshToken: z.string().min(10) });

// ── Plans ──
export const planInputSchema = z.object({
  code: z.string().min(2).max(30).regex(/^[A-Z0-9_]+$/, "Majuscules, chiffres et _"),
  name: z.string().min(2).max(60),
  description: z.string().max(500).optional(),
  priceMonthly: z.number().int().min(0),
  priceYearly: z.number().int().min(0),
  trialDays: z.number().int().min(0).max(90).default(14),
  maxUsers: z.number().int().positive().nullable().optional(),
  maxTables: z.number().int().positive().nullable().optional(),
  features: z.record(z.boolean()).default({}),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});
export const planUpdateSchema = planInputSchema.partial();

// ── Tenants ──
export const createTenantSchema = z.object({
  name: z.string().min(2).max(80),
  slug,
  email: z.string().email(),
  phone,
  address: z.string().max(200).optional(),
  planId: z.string().uuid(),
  admin: z.object({
    firstName: z.string().min(1).max(60),
    lastName: z.string().min(1).max(60),
    email: z.string().email(),
    password,
  }),
});
export const updateTenantSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  email: z.string().email().optional(),
  phone,
  address: z.string().max(200).optional(),
});
export const listTenantsQuerySchema = z.object({
  status: z.enum(["PENDING", "TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"]).optional(),
  search: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ── Inscription publique d'un restaurant ──
export const registrationInputSchema = z.object({
  restaurantName: z.string().min(2).max(80),
  slug,
  ownerFirstName: z.string().min(1).max(60),
  ownerLastName: z.string().min(1).max(60),
  email: z.string().email(),
  phone,
  password,
  planId: z.string().uuid().optional(),
});
export const rejectRegistrationSchema = z.object({ reason: z.string().min(3).max(300) });
export const listRegistrationsQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
});

// ── Paiements de licence (saisie manuelle par le SuperAdmin) ──
export const recordPaymentSchema = z.object({
  tenantId: z.string().uuid(),
  method: platformPaymentMethodSchema,
  billingCycle: billingCycleSchema,
  /** Nombre de périodes payées (ex. 3 mois). */
  periods: z.number().int().min(1).max(24).default(1),
  /** Montant en FCFA ; par défaut le prix du plan × périodes. */
  amount: z.number().int().positive().optional(),
  /** Changement de plan à l'occasion du paiement. */
  planId: z.string().uuid().optional(),
  paidAt: z.coerce.date().optional(),
  /** N° de transaction Flooz / TMoney / carte. Obligatoire hors espèces. */
  reference: z.string().min(3).max(80).optional(),
  notes: z.string().max(300).optional(),
}).refine((v) => v.method === "CASH" || !!v.reference, {
  path: ["reference"],
  message: "La référence de transaction est obligatoire pour ce mode de paiement",
});
export const voidPaymentSchema = z.object({ reason: z.string().min(3).max(300) });
export const listPaymentsQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  method: platformPaymentMethodSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type PlanInput = z.infer<typeof planInputSchema>;
export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type RegistrationInput = z.infer<typeof registrationInputSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export * from "./settings";
