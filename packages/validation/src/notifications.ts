import { z } from "zod";

/** Réglages « notifications » d'un restaurant (section `notifications`). */
export const notificationsSettingsSchema = z.object({
  channels: z.object({ email: z.boolean(), sms: z.boolean(), /** X5B : notifications push de l'équipe (absent = activé). */ push: z.boolean().optional() }),
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
  { key: "staffPlanning", label: "Planning du personnel", description: "Message au personnel quand son planning est publié." },
  { key: "dailyReport", label: "Rapport quotidien", description: "Récapitulatif des ventes de la veille envoyé aux responsables (activé dans la page Rapports)." },
  { key: "orderReady", label: "Commande prête (à emporter)", description: "SMS au client quand sa commande à emporter est prête." },
  { key: "deliveryUpdates", label: "Livraison", description: "SMS au client quand sa commande part en livraison (avec le numéro du livreur) puis quand elle est livrée." },
  { key: "pushDelivery", label: "Alertes livreur (push)", description: "Notification sur le téléphone du livreur : livraison attribuée ou retirée, commande prête à récupérer." },
  { key: "pushWaiter", label: "Alertes serveur (push)", description: "Notification au serveur quand les plats de ses commandes sont prêts." },
  { key: "pushKitchen", label: "Alertes cuisine (push)", description: "Notification à la cuisine : nouvelle commande ou articles ajoutés." },
  { key: "waitlist", label: "Liste d'attente", description: "Message au client quand une place se libère." },
] as const;

export const notificationChannelSchema = z.enum(["EMAIL", "SMS", "PUSH"]);
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

// ── X5B : notifications push web (abonnements des appareils du personnel) ──

/** Services de push des navigateurs (Chrome/Edge/Opera : FCM ; Firefox ; Safari ; Windows). Un autre hôte est refusé : l'API appelle l'adresse reçue (anti-SSRF). */
export const PUSH_SERVICE_HOSTS = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"] as const;

export const isPushServiceUrl = (value: string): boolean => {
  // Pas de `URL` ici (paquet sans types DOM / Node) : https, nom d'hôte seul (ni identifiants, ni IP, ni port autre que 443).
  const m = /^https:\/\/([a-z0-9][a-z0-9.-]*)(?::443)?(?:[/?#].*)?$/i.exec(value);
  if (!m) return false;
  const host = m[1]!.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
};

const pushEndpoint = z.string().trim().url("Adresse d'abonnement invalide").max(2048)
  .refine(isPushServiceUrl, "Ce service de notification n'est pas pris en charge");

/** Corps de `POST /tenant/push/subscriptions` : `PushSubscription.toJSON()` du navigateur. */
export const pushSubscriptionSchema = z.object({
  endpoint: pushEndpoint,
  keys: z.object({ p256dh: z.string().trim().min(16).max(256), auth: z.string().trim().min(8).max(128) }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

/** Corps de `DELETE /tenant/push/subscriptions`. */
export const pushUnsubscribeSchema = z.object({ endpoint: z.string().trim().min(1).max(2048) });
export type PushUnsubscribeInput = z.infer<typeof pushUnsubscribeSchema>;

/** Corps de `POST /tenant/push/test` : un appareil précis (le courant) ou, sans `endpoint`, tous les appareils du compte. */
export const pushTestSchema = z.object({ endpoint: z.string().trim().min(1).max(2048).optional() });
export type PushTestInput = z.infer<typeof pushTestSchema>;
