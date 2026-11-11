import { z } from "zod";

/** Réglages « notifications » d'un restaurant (section `notifications`). */
export const notificationsSettingsSchema = z.object({
  channels: z.object({ email: z.boolean(), sms: z.boolean() }),
  /** Nom affiché comme expéditeur des emails (par défaut : le nom du restaurant). */
  senderName: z.string().trim().max(60).optional(),
  /** Signature ajoutée en bas des messages. */
  signature: z.string().trim().max(300).optional(),
  /** Préférences par événement non critique (clé = identifiant de l'événement, ex. `licenseReminders`). */
  events: z.record(z.string().max(60), z.boolean()),
});
export type NotificationsSettingsInput = z.infer<typeof notificationsSettingsSchema>;

/** Événements dont l'envoi peut être désactivé par le restaurant (libellés pour l'écran de réglages). */
export const NOTIFICATION_EVENTS = [
  { key: "licenseReminders", label: "Relances de licence", description: "Rappels 7 jours et 1 jour avant l'échéance, puis le jour de l'expiration." },
  { key: "reservations", label: "Réservations", description: "Confirmation, modification et annulation envoyées au client." },
  { key: "reservationReminders", label: "Rappels de réservation", description: "Rappel envoyé au client la veille à 18 h." },
  { key: "waitlist", label: "Liste d'attente", description: "Message au client quand une place se libère." },
] as const;

export const notificationChannelSchema = z.enum(["EMAIL", "SMS"]);
export const notificationStatusSchema = z.enum(["QUEUED", "SENT", "FAILED"]);

export const listNotificationsQuerySchema = z.object({
  channel: notificationChannelSchema.optional(),
  status: notificationStatusSchema.optional(),
  template: z.string().max(80).optional(),
  /** Plateforme uniquement : `none` = messages de la plateforme, sinon identifiant d'un restaurant. */
  tenantId: z.union([z.literal("none"), z.string().uuid()]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
