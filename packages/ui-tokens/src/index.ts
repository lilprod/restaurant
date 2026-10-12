export const ORDER_STATUS_COLORS = { PENDING: "yellow", IN_PROGRESS: "blue", READY: "green", DELIVERED: "gray" } as const;

/** Tonalités sémantiques partagées par le web et le mobile (badges de statut). */
export type StatusTone = "blue" | "green" | "amber" | "red" | "gray";

/**
 * Couleur d'un statut de restaurant, de licence, d'inscription ou de paiement.
 * Règle unique : essai = bleu, actif = vert, grâce = ambre, expiré / suspendu / rejeté = rouge,
 * résilié / en attente / annulé = gris.
 */
export const STATUS_TONES: Record<string, StatusTone> = {
  // Tenant
  TRIAL: "blue",
  ACTIVE: "green",
  SUSPENDED: "red",
  CANCELLED: "gray",
  PENDING: "gray",
  // Licence
  TRIALING: "blue",
  GRACE: "amber",
  EXPIRED: "red",
  // Inscription
  APPROVED: "green",
  REJECTED: "red",
  // Paiement
  RECORDED: "green",
  VOIDED: "gray",
};

export const statusTone = (status: string | null | undefined): StatusTone => (status ? STATUS_TONES[status] ?? "gray" : "gray");

/**
 * Service en salle et en cuisine (phase 1). Tables distinctes de STATUS_TONES car certaines valeurs
 * (PENDING, CANCELLED…) n'ont pas la même couleur pour une commande que pour une inscription.
 * Commandes : en attente = ambre, en préparation = bleu, prête = vert, servie = gris.
 */
export const ORDER_STATUS_TONES: Record<string, StatusTone> = {
  PENDING: "amber", IN_PROGRESS: "blue", READY: "green", DELIVERED: "gray", SERVED: "gray", CANCELLED: "red",
};
/** Tables : libre = vert, occupée = bleu, à débarrasser = ambre, réservée = gris. */
export const TABLE_STATUS_TONES: Record<string, StatusTone> = { FREE: "green", OCCUPIED: "blue", CLEANING: "amber", RESERVED: "gray" };
/** Règlement d'une commande : à payer = ambre, partiel = bleu, réglée = vert ; paiement remboursé = rouge. */
export const ORDER_PAYMENT_TONES: Record<string, StatusTone> = { UNPAID: "amber", PARTIAL: "blue", PAID: "green", REFUNDED: "red" };

export const orderStatusTone = (s: string | null | undefined): StatusTone => (s ? ORDER_STATUS_TONES[s] ?? "gray" : "gray");
export const tableStatusTone = (s: string | null | undefined): StatusTone => (s ? TABLE_STATUS_TONES[s] ?? "gray" : "gray");
export const orderPaymentTone = (s: string | null | undefined): StatusTone => (s ? ORDER_PAYMENT_TONES[s] ?? "gray" : "gray");
