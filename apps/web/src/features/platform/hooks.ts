import { platformSpace } from "@/app/spaces";
import { useSession } from "@/providers/session";

export const papi = platformSpace.api;

/** Clés TanStack Query de l'espace plateforme (toutes préfixées par "platform" pour être purgées à la déconnexion). */
export const pk = {
  dashboard: ["platform", "dashboard"] as const,
  tenants: (q: object) => ["platform", "tenants", q] as const,
  tenantsAll: ["platform", "tenants"] as const,
  tenant: (id: string) => ["platform", "tenant", id] as const,
  tenantSubs: (id: string) => ["platform", "tenant", id, "subscriptions"] as const,
  tenantSettings: (id: string) => ["platform", "tenant", id, "settings"] as const,
  tenantUsers: (id: string) => ["platform", "tenant", id, "users"] as const,
  tenantEvents: (id: string, r?: string) => ["platform", "tenant", id, "events", r ?? "all"] as const,
  registrations: (s?: string) => ["platform", "registrations", s ?? "all"] as const,
  plans: ["platform", "plans"] as const,
  payments: (q: object) => ["platform", "payments", q] as const,
  paymentsAll: ["platform", "payments"] as const,
  payment: (id: string) => ["platform", "payment", id] as const,
  settings: ["platform", "settings"] as const,
  users: ["platform", "users"] as const,
  events: (r?: string) => ["platform", "events", r ?? "all"] as const,
};

/** SUPPORT = lecture seule : les actions d'écriture sont masquées ou désactivées. */
export function useCanWrite() {
  return useSession().user?.role === "SUPER_ADMIN";
}

export const READ_ONLY_HINT = "Réservé au super admin";
