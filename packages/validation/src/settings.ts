import { z } from "zod";
import { HEX_COLOR } from "@restaurant/utils";

/** Schémas des réglages (plateforme et restaurants), de la sécurité et des comptes. */

const hex = z.string().regex(HEX_COLOR, "Couleur au format #RRGGBB");
const optText = (max: number) => z.string().trim().max(max).optional();
const optUrl = z.string().trim().url().max(200).optional().or(z.literal("").transform(() => undefined));
const optEmail = z.string().trim().email().max(120).optional().or(z.literal("").transform(() => undefined));
const optPhone = z.string().trim().min(6).max(25).optional().or(z.literal("").transform(() => undefined));

// ── Thème & marque ──
export const themeSchema = z.object({
  mode: z.enum(["light", "dark", "system"]),
  primary: hex,
  accent: hex,
  fontFamily: z.enum(["inter", "poppins", "roboto", "nunito", "lato", "system"]),
  radius: z.enum(["none", "sm", "md", "lg", "xl"]),
  kitchenDark: z.boolean(),
});

/** Les URL du logo et du favicon ne se saisissent pas : elles viennent des endpoints d'envoi de fichiers. */
export const brandingInputSchema = z.object({
  displayName: z.string().trim().min(2).max(60),
  tagline: optText(120),
  theme: themeSchema,
});

export const ASSET_KINDS = ["logo", "logoDark", "favicon"] as const;
export const assetKindSchema = z.enum(ASSET_KINDS);

// ── Coordonnées & identité légale ──
export const addressSchema = z.object({
  street: optText(150),
  complement: optText(100),
  city: optText(80),
  postalCode: optText(20),
  region: optText(80),
  country: optText(80),
});

export const socialSchema = z.object({
  facebook: optUrl, instagram: optUrl, tiktok: optUrl, youtube: optUrl, linkedin: optUrl, x: optUrl, whatsapp: optPhone,
});

export const companySchema = z.object({
  legalName: z.string().trim().min(2).max(120),
  tradeName: optText(120),
  legalForm: optText(40),
  description: optText(600),
  taxId: optText(40),
  registrationNumber: optText(40),
  address: addressSchema.default({}),
  phone: optPhone,
  email: optEmail,
  supportEmail: optEmail,
  supportPhone: optPhone,
  website: optUrl,
  social: socialSchema.default({}),
});

/** Informations complètes d'un restaurant. Le nom, l'email, le téléphone et l'adresse principale viennent du tenant. */
export const businessSchema = z.object({
  legalName: optText(120),
  tradeName: z.string().trim().min(2).max(80),
  description: optText(600),
  cuisineType: optText(80),
  taxId: optText(40),                 // NIF
  registrationNumber: optText(40),    // RCCM
  address: addressSchema.default({}),
  phone: optPhone,
  email: optEmail,
  website: optUrl,
  social: socialSchema.default({}),
  receipt: z.object({
    headerText: optText(200),
    footerText: optText(300),
    showLogo: z.boolean().default(true),
    showTaxId: z.boolean().default(true),
  }).default({}),
});

export const operationsSchema = z.object({
  defaultVatRate: z.number().min(0).max(30),
  serviceChargePercent: z.number().min(0).max(30),
  tipsEnabled: z.boolean(),
  tipPresets: z.array(z.number().int().min(0).max(50)).max(5),
  onlineReservations: z.boolean(),
  reservationDurationMinutes: z.number().int().min(30).max(360),
  reservationSlotMinutes: z.number().int().refine((n) => [10, 15, 20, 30, 60].includes(n), "10, 15, 20, 30 ou 60"),
  maxPartySize: z.number().int().min(1).max(100),
  takeawayEnabled: z.boolean(),
  deliveryEnabled: z.boolean(),
});

export const localizationSchema = z.object({
  locale: z.enum(["fr", "en"]),
  timezone: z.string().refine((tz) => {
    try { new Intl.DateTimeFormat("fr", { timeZone: tz }); return true; } catch { return false; }
  }, "Fuseau horaire inconnu"),
  dateFormat: z.enum(["DD/MM/YYYY", "YYYY-MM-DD", "MM/DD/YYYY"]),
  firstDayOfWeek: z.union([z.literal(0), z.literal(1), z.literal(6)]),
});

// ── Sécurité ──
export const passwordPolicySchema = z.object({
  minLength: z.number().int().min(8).max(64),
  requireUpper: z.boolean(),
  requireLower: z.boolean(),
  requireDigit: z.boolean(),
  requireSymbol: z.boolean(),
});

const securityBase = {
  passwordPolicy: passwordPolicySchema,
  maxFailedAttempts: z.number().int().min(3).max(10),
  lockoutMinutes: z.number().int().min(5).max(1440),
  sessionDays: z.number().int().min(1).max(90),
  passwordExpiryDays: z.number().int().min(0).max(365),   // 0 = jamais
};
export const tenantSecuritySchema = z.object({
  ...securityBase,
  require2faRoles: z.array(z.enum(["ADMIN", "MANAGER", "WAITER", "KITCHEN"])).default([]),
});
export const platformSecuritySchema = z.object({
  ...securityBase,
  require2fa: z.boolean(),
});

/** Comment les restaurants règlent leur licence (affiché dans leur espace). */
export const paymentInstructionsSchema = z.object({
  flooz: z.object({ number: optPhone, holder: optText(80) }).default({}),
  tmoney: z.object({ number: optPhone, holder: optText(80) }).default({}),
  bank: z.object({ bankName: optText(80), accountHolder: optText(80), accountNumber: optText(60) }).default({}),
  cashNote: optText(300),
  instructions: optText(600),
});

export const licensingSettingsSchema = z.object({
  /** Jours d'accès maintenu après l'échéance d'une licence, avant suspension. */
  graceDays: z.number().int().min(0).max(30),
});

// ── Comptes ──
export const tenantLoginSchema = z.object({
  tenantSlug: z.string().trim().toLowerCase().min(3).max(40),
  email: z.string().email(),
  password: z.string().min(1),
});
export const twoFactorVerifySchema = z.object({
  challengeToken: z.string().min(10),
  code: z.string().trim().min(6).max(20),
});
export const profileUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  phone: optPhone,
  locale: z.enum(["fr", "en"]).optional(),
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});
export const forgotPasswordSchema = z.object({
  email: z.string().email(),
  tenantSlug: z.string().trim().toLowerCase().min(3).max(40).optional(),
});
export const resetPasswordSchema = z.object({
  token: z.string().min(20),
  newPassword: z.string().min(8).max(128),
});
export const twoFactorEnableSchema = z.object({ code: z.string().trim().length(6) });
export const passwordConfirmSchema = z.object({ password: z.string().min(1), code: z.string().trim().min(6).max(20).optional() });

export type LicensingSettings = z.infer<typeof licensingSettingsSchema>;
export type BrandingInput = z.infer<typeof brandingInputSchema>;
export type CompanyInput = z.infer<typeof companySchema>;
export type BusinessInput = z.infer<typeof businessSchema>;
export type OperationsInput = z.infer<typeof operationsSchema>;
export type LocalizationInput = z.infer<typeof localizationSchema>;
export type TenantSecurityInput = z.infer<typeof tenantSecuritySchema>;
export type PlatformSecurityInput = z.infer<typeof platformSecuritySchema>;
export type PaymentInstructionsInput = z.infer<typeof paymentInstructionsSchema>;
