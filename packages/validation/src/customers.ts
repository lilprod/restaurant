import { z } from "zod";
import { normalizePhone } from "@restaurant/utils";

/** Schémas de l'espace client (P2C) : compte, préférences, vérification d'email, avis. */

const name = z.string().trim().min(1, "Indiquez ce champ").max(60);
const phone = z.string().trim().max(25).refine((v) => !!normalizePhone(v), "Numéro de téléphone invalide");
const optPhone = phone.optional().or(z.literal("").transform(() => undefined));

export const customerSignupSchema = z.object({
  firstName: name,
  lastName: name,
  email: z.string().trim().toLowerCase().email().max(120),
  phone: optPhone,
  password: z.string().min(8, "8 caractères minimum").max(128),
  /** Consentement au traitement des données (obligatoire). */
  consent: z.literal(true, { errorMap: () => ({ message: "Vous devez accepter le traitement de vos données pour créer un compte" }) }),
});
export type CustomerSignupInput = z.infer<typeof customerSignupSchema>;

export const customerProfileSchema = z.object({
  firstName: name.optional(),
  lastName: name.optional(),
  /** Chaîne vide = effacer. */
  phone: z.string().trim().max(25).optional().transform((v) => (v === "" ? null : v))
    .refine((v) => v == null || !!normalizePhone(v), "Numéro de téléphone invalide"),
}).refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Aucune modification", path: ["firstName"] });
export type CustomerProfileInput = z.infer<typeof customerProfileSchema>;

export const notificationPrefsSchema = z.object({
  /** Rappels de réservation (la veille). */
  reservationReminders: z.boolean(),
  /** SMS « commande prête » (à emporter). */
  orderReadySms: z.boolean(),
});
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { reservationReminders: true, orderReadySms: true };

export const verifyEmailSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Le code comporte 6 chiffres") });
export const deleteAccountSchema = z.object({ password: z.string().min(1, "Saisissez votre mot de passe") });
export const claimOrderSchema = z.object({ token: z.string().trim().regex(/^[A-Za-z0-9_-]{20,100}$/, "Lien de suivi invalide") });

// ── Avis ──
export const reviewInputSchema = z.object({
  rating: z.number().int().min(1, "Choisissez une note de 1 à 5").max(5, "Choisissez une note de 1 à 5"),
  comment: z.string().trim().max(1000).optional().transform((v) => (v ? v : undefined)),
  /** Sans compte : prénom affiché avec l'avis (facultatif). */
  authorName: z.string().trim().max(40).optional().transform((v) => (v ? v : undefined)),
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;

export const reviewReplySchema = z.object({ text: z.string().trim().min(2, "Écrivez votre réponse").max(600) });
export type ReviewReplyInput = z.infer<typeof reviewReplySchema>;

export const listReviewsQuerySchema = z.object({
  status: z.enum(["all", "visible", "hidden"]).default("all"),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  unanswered: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListReviewsQuery = z.infer<typeof listReviewsQuerySchema>;

export const publicReviewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(30).default(10),
});
export type PublicReviewsQuery = z.infer<typeof publicReviewsQuerySchema>;
