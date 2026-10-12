/** Libellés français des valeurs d'énumération de l'API. */
export const TENANT_STATUS_LABEL: Record<string, string> = {
  PENDING: "En attente", TRIAL: "Essai", ACTIVE: "Actif", SUSPENDED: "Suspendu", CANCELLED: "Résilié",
};
export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  TRIALING: "Essai", ACTIVE: "Active", GRACE: "Période de grâce", EXPIRED: "Expirée", CANCELLED: "Annulée",
};
export const REGISTRATION_STATUS_LABEL: Record<string, string> = { PENDING: "En attente", APPROVED: "Validée", REJECTED: "Rejetée" };
export const PAYMENT_STATUS_LABEL: Record<string, string> = { RECORDED: "Enregistré", VOIDED: "Annulé" };
export const PAYMENT_METHOD_LABEL: Record<string, string> = { FLOOZ: "Flooz", TMONEY: "TMoney", CARD: "Carte", CASH: "Espèces" };
export const PAYMENT_METHODS = ["FLOOZ", "TMONEY", "CARD", "CASH"] as const;
export const BILLING_CYCLE_LABEL: Record<string, string> = { MONTHLY: "Mensuel", YEARLY: "Annuel" };
export const PLATFORM_ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: "Super admin", SUPPORT: "Support" };
export const TENANT_ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrateur", MANAGER: "Gérant", WAITER: "Serveur", KITCHEN: "Cuisine", CUSTOMER: "Client",
};
export const LOGIN_RESULT_LABEL: Record<string, string> = {
  SUCCESS: "Réussie",
  BAD_PASSWORD: "Mot de passe incorrect",
  UNKNOWN_ACCOUNT: "Compte inconnu",
  LOCKED: "Compte verrouillé",
  TWO_FACTOR_FAILED: "Code 2FA incorrect",
  TWO_FACTOR_REQUIRED: "2FA demandée",
  LICENSE_BLOCKED: "Licence bloquée",
};
export const LOGIN_RESULT_TONE: Record<string, "green" | "red" | "amber" | "gray" | "blue"> = {
  SUCCESS: "green", BAD_PASSWORD: "red", UNKNOWN_ACCOUNT: "gray", LOCKED: "red",
  TWO_FACTOR_FAILED: "red", TWO_FACTOR_REQUIRED: "blue", LICENSE_BLOCKED: "amber",
};
export const FEATURE_LABEL: Record<string, string> = {
  orders: "Commandes", reservations: "Réservations", inventory: "Stock", staff: "Personnel",
  reports: "Rapports", delivery: "Livraison", kitchen: "Écran cuisine", loyalty: "Fidélité",
};
export const KNOWN_FEATURES = ["orders", "reservations", "inventory", "staff", "reports", "delivery"] as const;
