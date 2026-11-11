import { z } from "zod";
import { isValidTime, normalizePhone, toMinutes } from "@restaurant/utils";

/** Schémas des réservations (P2A) : horaires, fermetures, réservations, disponibilités, liste d'attente, espace public. */

const uuid = z.string().uuid();
const optText = (max: number) => z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));
/** Texte effaçable : chaîne vide = effacer (null), absent = inchangé. */
const clearableText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v === "" ? null : v));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ");
const time = z.string().refine(isValidTime, "Heure attendue au format HH:MM");
const instant = z.coerce.date();
const name = z.string().trim().min(2, "Indiquez le nom (2 caractères minimum)").max(80);
const phone = z.string().trim().max(25).refine((v) => !!normalizePhone(v), "Numéro de téléphone invalide");
const email = z.string().trim().toLowerCase().email().max(120);
const optPhone = phone.optional().or(z.literal("").transform(() => undefined));
const optEmail = email.optional().or(z.literal("").transform(() => undefined));
const partySize = z.number().int().min(1, "Au moins 1 personne").max(100);
const duration = z.number().int().min(15).max(600);

export const reservationStatusSchema = z.enum(["PENDING", "CONFIRMED", "SEATED", "COMPLETED", "CANCELLED", "NO_SHOW"]);
export const reservationSourceSchema = z.enum(["PHONE", "WALK_IN", "ONLINE"]);
export const waitlistStatusSchema = z.enum(["WAITING", "NOTIFIED", "CONVERTED", "EXPIRED", "REMOVED"]);

// ── Réglages (section `reservations`) ──
export const reservationsSettingsSchema = z.object({
  /** Réservations en ligne en attente de confirmation par la salle (sinon confirmées d'office). */
  requireConfirmation: z.boolean(),
  /** Jusqu'à combien de jours à l'avance on peut réserver en ligne. */
  bookingWindowDays: z.number().int().min(1).max(365),
  /** Délai minimal entre la réservation en ligne et le créneau. */
  minNoticeMinutes: z.number().int().min(0).max(10_080),
  /** Retard toléré avant de proposer « absent » (no-show). */
  noShowGraceMinutes: z.number().int().min(0).max(240),
  /** Tampon de remise en place entre deux réservations d'une même table. */
  bufferMinutes: z.number().int().min(0).max(120),
});
export type ReservationsSettingsInput = z.infer<typeof reservationsSettingsSchema>;

// ── Horaires d'ouverture ──
export const openingRangeSchema = z.object({
  /** 0 = dimanche … 6 = samedi. */
  weekday: z.number().int().min(0).max(6),
  opensAt: time.refine((t) => t !== "24:00", "Heure d'ouverture invalide"),
  /** Inférieure ou égale à l'ouverture = fermeture après minuit ; "24:00" accepté. */
  closesAt: time,
  /** Pas des créneaux ; par défaut le réglage `operations.reservationSlotMinutes`. */
  slotMinutes: z.number().int().refine((n) => [10, 15, 20, 30, 60].includes(n), "10, 15, 20, 30 ou 60").optional(),
}).refine((r) => r.opensAt !== r.closesAt, { message: "L'ouverture et la fermeture doivent différer", path: ["closesAt"] });

/** Longueur d'une plage en minutes (fermeture après minuit comprise). */
const span = (r: { opensAt: string; closesAt: string }) => {
  const o = toMinutes(r.opensAt), c = toMinutes(r.closesAt);
  return (c <= o ? c + 1440 : c) - o;
};

export const openingHoursSchema = z.object({ ranges: z.array(openingRangeSchema).max(28) }).superRefine((v, ctx) => {
  for (let i = 0; i < v.ranges.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = v.ranges[i], b = v.ranges[j];
      if (a.weekday !== b.weekday) continue;
      const as = toMinutes(a.opensAt), bs = toMinutes(b.opensAt);
      if (as < bs + span(b) && bs < as + span(a)) {
        ctx.addIssue({ code: "custom", path: ["ranges", i, "opensAt"], message: "Cette plage chevauche une autre plage du même jour" });
      }
    }
  }
});
export type OpeningHoursInput = z.infer<typeof openingHoursSchema>;

// ── Fermetures exceptionnelles ──
export const closureInputSchema = z.object({ date: day, reason: optText(120) });
export const listClosuresQuerySchema = z.object({ from: day.optional(), to: day.optional() });
export type ClosureInput = z.infer<typeof closureInputSchema>;
export type ListClosuresQuery = z.infer<typeof listClosuresQuerySchema>;

// ── Disponibilités ──
export const availabilityQuerySchema = z.object({
  date: day,
  partySize: z.coerce.number().int().min(1).max(100),
  /** Salle uniquement : durée particulière (minutes). */
  durationMinutes: z.coerce.number().int().min(15).max(600).optional(),
  /** Salle uniquement : réservation à ignorer (déplacement d'une réservation existante). */
  excludeReservationId: uuid.optional(),
});
export const publicAvailabilityQuerySchema = availabilityQuerySchema.pick({ date: true, partySize: true });
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
export type PublicAvailabilityQuery = z.infer<typeof publicAvailabilityQuerySchema>;

// ── Réservations (salle) ──
const forceFields = {
  /** Responsables : passer outre capacité, horaires, délai et taille maximale (jamais la double réservation). */
  force: z.boolean().optional(),
  overrideReason: optText(200),
};
const forceRefine = <T extends { force?: boolean; overrideReason?: string }>(v: T) => !v.force || !!v.overrideReason;
const forceIssue = { message: "Indiquez le motif du forçage", path: ["overrideReason"] };

export const createReservationSchema = z.object({
  guestName: name,
  guestPhone: optPhone,
  guestEmail: optEmail,
  partySize,
  /** Absent pour un client sans réservation (WALK_IN) : maintenant. */
  startsAt: instant.optional(),
  durationMinutes: duration.optional(),
  source: z.enum(["PHONE", "WALK_IN"]).default("PHONE"),
  /** Choix manuel des tables ; sinon attribution automatique. */
  tableIds: z.array(uuid).min(1).max(4).optional(),
  specialRequests: optText(500),
  notes: optText(500),
  ...forceFields,
})
  .refine((v) => v.source === "WALK_IN" || !!v.startsAt, { message: "Choisissez un créneau", path: ["startsAt"] })
  .refine(forceRefine, forceIssue);
export type CreateReservationInput = z.infer<typeof createReservationSchema>;

export const updateReservationSchema = z.object({
  guestName: name.optional(),
  /** Chaîne vide ou null = effacer. */
  guestPhone: z.union([phone, z.literal("").transform(() => null), z.null()]).optional(),
  guestEmail: z.union([email, z.literal("").transform(() => null), z.null()]).optional(),
  partySize: partySize.optional(),
  startsAt: instant.optional(),
  durationMinutes: duration.optional(),
  tableIds: z.array(uuid).min(1).max(4).optional(),
  specialRequests: clearableText(500),
  notes: clearableText(500),
  ...forceFields,
}).refine(forceRefine, forceIssue);
export type UpdateReservationInput = z.infer<typeof updateReservationSchema>;

export const cancelReservationSchema = z.object({ reason: optText(200), notifyGuest: z.boolean().default(true) });
export type CancelReservationInput = z.infer<typeof cancelReservationSchema>;

export const listReservationsQuerySchema = z.object({
  /** Journée de service (AAAA-MM-JJ, fuseau du restaurant) ; défaut : aujourd'hui. Ignoré si `from`/`to` sont fournis. */
  date: day.optional(),
  from: instant.optional(),
  to: instant.optional(),
  /** Un statut ou plusieurs séparés par des virgules (`CONFIRMED,SEATED`). */
  status: z.string().optional().transform((v) => (v ? v.split(",") : undefined)).pipe(z.array(reservationStatusSchema).optional()),
  /** Nom, téléphone ou code. */
  search: z.string().trim().max(80).optional(),
});
export type ListReservationsQuery = z.infer<typeof listReservationsQuerySchema>;

// ── Liste d'attente ──
export const waitlistInputSchema = z.object({
  guestName: name,
  guestPhone: optPhone,
  guestEmail: optEmail,
  partySize,
  desiredAt: instant,
  notes: optText(300),
});
export type WaitlistInput = z.infer<typeof waitlistInputSchema>;

export const listWaitlistQuerySchema = z.object({
  date: day.optional(),
  /** Défaut : entrées actives (WAITING, NOTIFIED). */
  status: waitlistStatusSchema.optional(),
});
export type ListWaitlistQuery = z.infer<typeof listWaitlistQuerySchema>;

export const convertWaitlistSchema = z.object({
  /** Défaut : l'heure souhaitée de l'entrée. */
  startsAt: instant.optional(),
  durationMinutes: duration.optional(),
  tableIds: z.array(uuid).min(1).max(4).optional(),
  ...forceFields,
}).refine(forceRefine, forceIssue);
export type ConvertWaitlistInput = z.infer<typeof convertWaitlistSchema>;

// ── Espace public (sans compte) ──
export const publicReservationSchema = z.object({
  guestName: name,
  guestPhone: phone,
  guestEmail: optEmail,
  partySize,
  startsAt: instant,
  specialRequests: optText(500),
});
export type PublicReservationInput = z.infer<typeof publicReservationSchema>;

export const publicUpdateReservationSchema = z.object({
  partySize: partySize.optional(),
  startsAt: instant.optional(),
  specialRequests: clearableText(500),
}).refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Aucune modification", path: ["startsAt"] });
export type PublicUpdateReservationInput = z.infer<typeof publicUpdateReservationSchema>;
