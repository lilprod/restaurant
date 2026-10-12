import type { Order } from "@restaurant/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { getTenantSpace } from "@/app/spaces";
import { applyOrderEvent } from "@/lib/realtime/order-cache";
import { tenantKeys } from "@/lib/tenant-keys";
import { useSession } from "@/providers/session";

/** Groupes de rôles (miroir de apps/api/src/restaurant/common.ts). */
export const ROLE_GROUPS = {
  staff: ["ADMIN", "MANAGER", "WAITER", "KITCHEN"],
  floor: ["ADMIN", "MANAGER", "WAITER"],
  kitchen: ["ADMIN", "MANAGER", "KITCHEN"],
  managers: ["ADMIN", "MANAGER"],
} as const;

/** API du restaurant courant + clés de requête préfixées par ["tenant", slug] + droits du rôle. */
export function useTenant() {
  const session = useSession();
  const space = getTenantSpace(session.slug!);
  const role = session.user?.role ?? "";
  const root = session.queryKey;
  const has = (g: keyof typeof ROLE_GROUPS) => (ROLE_GROUPS[g] as readonly string[]).includes(role);
  return {
    api: space.api,
    slug: session.slug!,
    root,
    key: (...parts: unknown[]) => [...root, ...parts] as const,
    role,
    isAdmin: role === "ADMIN",
    isManager: has("managers"),
    isFloor: has("floor"),
    isKitchen: has("kitchen"),
    canSeeLicense: role === "ADMIN" || role === "MANAGER",
  };
}

/** Sections de réglages lisibles par rôle (miroir du tableau READ de l'API). */
export const SETTINGS_READ: Record<string, string[]> = {
  business: ["ADMIN", "MANAGER"],
  branding: ["ADMIN", "MANAGER"],
  operations: ["ADMIN", "MANAGER", "WAITER", "KITCHEN"],
  localization: ["ADMIN", "MANAGER", "WAITER", "KITCHEN"],
  security: ["ADMIN"],
};

const DEFAULT_OPS = { serviceChargePercent: 0, defaultVatRate: 18, tipsEnabled: true, tipPresets: [5, 10, 15], takeawayEnabled: true };

/** Réglages d'exploitation (TVA, service, pourboires, vente à emporter), lisibles par tout le personnel. */
export function useOperations() {
  const t = useTenant();
  const q = useQuery({ queryKey: tenantKeys.settings(t.root, "operations"), queryFn: () => t.api.settings.get("operations"), staleTime: 5 * 60_000 });
  return { ...DEFAULT_OPS, ...(q.data ?? {}), isLoading: q.isLoading };
}

/** Fuseau du restaurant (localisation), Africa/Lome par défaut. */
export function useTimezone() {
  const t = useTenant();
  const q = useQuery({ queryKey: tenantKeys.settings(t.root, "localization"), queryFn: () => t.api.settings.get("localization"), staleTime: 5 * 60_000 });
  return q.data?.timezone ?? "Africa/Lome";
}

/** Reporte immédiatement la commande renvoyée par une action dans tous les caches (sans attendre la socket). */
export function useApplyOrder() {
  const qc = useQueryClient();
  const t = useTenant();
  const tz = useTimezone();
  return React.useCallback((o: Order) => {
    qc.setQueryData(tenantKeys.order(t.root, o.id), o);
    applyOrderEvent(qc, t.root, o, { timeZone: tz });
  }, [qc, t.root, tz]);
}

/** Horloge partagée pour les durées écoulées (une seule minuterie par écran). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** « 12 min », « 1 h 05 » — durée depuis une date. */
export function elapsedLabel(from: string | Date, now: number): string {
  const min = Math.max(0, Math.floor((now - new Date(from).getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}
