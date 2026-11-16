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
  // Notification
  QUEUED: "blue",
  SENT: "green",
  FAILED: "red",
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

/** Livraison (X2) : à attribuer = ambre, attribuée / en route = bleu, livrée = vert, échec = rouge. */
export const DELIVERY_STATUS_TONES: Record<string, StatusTone> = { PENDING: "amber", ASSIGNED: "blue", ON_THE_WAY: "blue", DELIVERED: "green", FAILED: "red" };
export const deliveryStatusTone = (s: string | null | undefined): StatusTone => (s ? DELIVERY_STATUS_TONES[s] ?? "gray" : "gray");

/** Stock (P3) : état d'un ingrédient (bas = ambre, épuisé / négatif = rouge), commandes fournisseurs, inventaires. */
export const STOCK_STATE_TONES: Record<string, StatusTone> = { OK: "green", LOW: "amber", OUT: "red", NEGATIVE: "red" };
export const PURCHASE_STATUS_TONES: Record<string, StatusTone> = { DRAFT: "gray", SENT: "blue", PARTIAL: "amber", RECEIVED: "green", CANCELLED: "red" };
export const STOCK_COUNT_TONES: Record<string, StatusTone> = { OPEN: "blue", VALIDATED: "green", CANCELLED: "gray" };
export const stockStateTone = (s: string | null | undefined): StatusTone => (s ? STOCK_STATE_TONES[s] ?? "gray" : "gray");
export const purchaseStatusTone = (s: string | null | undefined): StatusTone => (s ? PURCHASE_STATUS_TONES[s] ?? "gray" : "gray");
export const stockCountTone = (s: string | null | undefined): StatusTone => (s ? STOCK_COUNT_TONES[s] ?? "gray" : "gray");

/** Personnel (P4) : présence (en service = vert, en pause = ambre, absent du service = gris), absences (validée = vert, refusée = rouge). */
export const PRESENCE_TONES: Record<string, StatusTone> = { CLOCKED_IN: "green", ON_BREAK: "amber", OFF: "gray" };
export const ABSENCE_STATUS_TONES: Record<string, StatusTone> = { PENDING: "amber", APPROVED: "green", REJECTED: "red" };
export const presenceTone = (s: string | null | undefined): StatusTone => (s ? PRESENCE_TONES[s] ?? "gray" : "gray");
export const absenceStatusTone = (s: string | null | undefined): StatusTone => (s ? ABSENCE_STATUS_TONES[s] ?? "gray" : "gray");
