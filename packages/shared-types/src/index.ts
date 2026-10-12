/** Rôles propres à un tenant (restaurant). */
export type Role = "ADMIN" | "MANAGER" | "WAITER" | "KITCHEN" | "CUSTOMER";
/** Rôles de l'espace plateforme (éditeur du SaaS). */
export type PlatformRole = "SUPER_ADMIN" | "SUPPORT";

export type OrderStatus = "PENDING" | "IN_PROGRESS" | "READY" | "DELIVERED" | "CANCELLED";
export type ReservationStatus = "PENDING" | "CONFIRMED" | "SEATED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

export type TenantStatus = "PENDING" | "TRIAL" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
export type SubscriptionStatus = "TRIALING" | "ACTIVE" | "GRACE" | "EXPIRED" | "CANCELLED";
export type BillingCycle = "MONTHLY" | "YEARLY";
/** Modes d'enregistrement des paiements de licence (V1, saisie manuelle). */
export type PlatformPaymentMethod = "CASH" | "CARD" | "FLOOZ" | "TMONEY";

/** Montants en FCFA (XOF) : entiers, sans centimes. */
export const DEFAULT_CURRENCY = "XOF";
export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 7;
