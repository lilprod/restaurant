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
export const NOTIFICATION_STATUS_LABEL: Record<string, string> = { QUEUED: "En cours", SENT: "Envoyé", FAILED: "Échec" };
export const NOTIFICATION_CHANNEL_LABEL: Record<string, string> = { EMAIL: "Email", SMS: "SMS" };
export const NOTIFICATION_TEMPLATE_LABEL: Record<string, string> = {
  "auth.password-reset": "Réinitialisation de mot de passe",
  "license.reminder": "Relance de licence",
  "registration.received": "Inscription reçue",
  "registration.approved": "Inscription validée",
  "registration.rejected": "Inscription rejetée",
  "generic.message": "Message libre",
};
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
  ACCOUNT_DISABLED: "Compte désactivé",
};
export const LOGIN_RESULT_TONE: Record<string, "green" | "red" | "amber" | "gray" | "blue"> = {
  SUCCESS: "green", BAD_PASSWORD: "red", UNKNOWN_ACCOUNT: "gray", LOCKED: "red",
  TWO_FACTOR_FAILED: "red", TWO_FACTOR_REQUIRED: "blue", LICENSE_BLOCKED: "amber", ACCOUNT_DISABLED: "gray",
};
export const FEATURE_LABEL: Record<string, string> = {
  orders: "Commandes", reservations: "Réservations", inventory: "Stock", staff: "Personnel",
  reports: "Rapports", delivery: "Livraison", kitchen: "Écran cuisine", loyalty: "Fidélité",
};
export const KNOWN_FEATURES = ["orders", "reservations", "inventory", "staff", "reports", "delivery"] as const;

// ── Phase 1 : service ──
export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: "En attente", IN_PROGRESS: "En préparation", READY: "Prête", DELIVERED: "Servie", CANCELLED: "Annulée",
};
export const ITEM_STATUS_LABEL: Record<string, string> = {
  PENDING: "En attente", IN_PROGRESS: "En préparation", READY: "Prêt", SERVED: "Servi", CANCELLED: "Annulé",
};
export const ORDER_TYPE_LABEL: Record<string, string> = { DINE_IN: "Sur place", TAKEAWAY: "À emporter", DELIVERY: "Livraison" };
export const ORDER_PAYMENT_STATUS_LABEL: Record<string, string> = { UNPAID: "À payer", PARTIAL: "Payée en partie", PAID: "Réglée" };
export const ORDER_PAYMENT_RECORD_LABEL: Record<string, string> = { PAID: "Encaissé", REFUNDED: "Remboursé" };
/** Encaissement en salle : ordre d'affichage du sélecteur. */
export const ORDER_PAYMENT_METHODS = ["CASH", "CARD", "FLOOZ", "TMONEY", "OTHER"] as const;
export const ORDER_PAYMENT_METHOD_LABEL: Record<string, string> = { ...PAYMENT_METHOD_LABEL, OTHER: "Autre" };
export const TABLE_STATUS_LABEL: Record<string, string> = { FREE: "Libre", OCCUPIED: "Occupée", CLEANING: "À débarrasser", RESERVED: "Réservée" };
export const STAFF_ROLES = ["ADMIN", "MANAGER", "WAITER", "KITCHEN"] as const;
export const STAFF_ROLE_HINT: Record<string, string> = {
  ADMIN: "Accès complet : réglages, équipe, sécurité, licence.",
  MANAGER: "Menu, tables, caisse, remboursements et annulations.",
  WAITER: "Prise de commande, service et encaissement.",
  KITCHEN: "Écran cuisine et disponibilité des plats.",
};
export const courseLabel = (n: number) => (n === 1 ? "1er envoi" : `${n}e envoi`);

// ── P3 : stock ──
export const STOCK_STATE_LABEL: Record<string, string> = { OK: "En stock", LOW: "Stock bas", OUT: "Épuisé", NEGATIVE: "Négatif" };
export const MOVEMENT_TYPE_LABEL: Record<string, string> = {
  PURCHASE: "Réception", ORDER_DEDUCTION: "Préparation", WASTE: "Perte", ADJUSTMENT: "Ajustement", RETURN: "Retour",
};
export const MOVEMENT_TYPES = ["ORDER_DEDUCTION", "RETURN", "PURCHASE", "WASTE", "ADJUSTMENT"] as const;
export const PURCHASE_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Brouillon", SENT: "Envoyée", PARTIAL: "Reçue en partie", RECEIVED: "Reçue", CANCELLED: "Annulée",
};
export const STOCK_COUNT_STATUS_LABEL: Record<string, string> = { OPEN: "En cours", VALIDATED: "Validé", CANCELLED: "Annulé" };
export const STOCK_UNIT_LABEL: Record<string, string> = { g: "g", kg: "kg", ml: "ml", cl: "cl", l: "l", piece: "pièce" };
