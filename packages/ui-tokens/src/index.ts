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
