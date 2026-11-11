import { ApiError, type Ingredient } from "@restaurant/api-client";
import { useQuery } from "@tanstack/react-query";
import { tenantKeys } from "@/lib/tenant-keys";
import { useTenant } from "../hooks";

export const isPlanFeatureError = (e: unknown) => e instanceof ApiError && e.code === "PLAN_FEATURE";
const noRetryOn403 = (n: number, e: unknown) => !(e instanceof ApiError && e.status === 403) && n < 2;

/**
 * Alertes de stock (cuisine + responsables). Sert aussi de sonde du module : `enabled === false` quand le plan
 * n'inclut pas le stock (403 PLAN_FEATURE) ; la navigation et les widgets se masquent alors.
 */
export function useStockAlerts() {
  const t = useTenant();
  const q = useQuery({
    queryKey: tenantKeys.stockAlerts(t.root),
    queryFn: () => t.api.inventory.alerts(),
    enabled: t.isKitchen,
    staleTime: 30_000,
    retry: noRetryOn403,
  });
  return { ...q, moduleEnabled: t.isKitchen && !isPlanFeatureError(q.error) };
}

export function useIngredients(q: { search?: string; category?: string; state?: Ingredient["state"] | "ALERT"; archived?: boolean } = {}) {
  const t = useTenant();
  return useQuery({
    queryKey: tenantKeys.ingredients(t.root, q),
    queryFn: () => t.api.inventory.ingredients(q),
    retry: noRetryOn403,
  });
}

export function useSuppliers(all = false) {
  const t = useTenant();
  return useQuery({ queryKey: [...tenantKeys.suppliers(t.root), { all }], queryFn: () => t.api.suppliers.list({ all }), retry: noRetryOn403 });
}

/** Saisie décimale française (« 1,5 ») → nombre ; vide → null. */
export function parseQty(raw: string): number | null {
  const s = raw.replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
