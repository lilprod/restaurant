import type { Formula, MenuItem, Promotion } from "@restaurant/api-client";
import { availabilityAt, bestPromotion, hoursLabel, type AppliedPromotion } from "@restaurant/utils";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { tenantKeys } from "@/lib/tenant-keys";
import { useNow, useTenant, useTimezone } from "../hooks";

export function useFormulas() {
  const t = useTenant();
  return useQuery({ queryKey: tenantKeys.formulas(t.root), queryFn: t.api.menu.formulas, staleTime: 60_000 });
}

export function usePromotions() {
  const t = useTenant();
  return useQuery({ queryKey: tenantKeys.promotions(t.root), queryFn: t.api.menu.promotions, staleTime: 60_000 });
}

export interface DishRules {
  /** Plat hors de sa plage horaire (ou épuisé) à cet instant. */
  state: (item: Pick<MenuItem, "isAvailable" | "availableFrom" | "availableTo">) => { available: boolean; reason: "UNAVAILABLE" | "OUT_OF_HOURS" | null; hours: string | null };
  formulaOpen: (f: Pick<Formula, "availableFrom" | "availableTo">) => boolean;
  promoFor: (item: Pick<MenuItem, "id" | "categoryId" | "price">) => AppliedPromotion | null;
}

/** Règles horaires et promotions appliquées à l'heure du restaurant (mêmes fonctions que l'API ; l'API reste l'arbitre). */
export function useDishRules(promotions: Promotion[] | undefined): DishRules {
  const tz = useTimezone();
  const now = useNow(30_000);
  return React.useMemo(() => {
    const at = new Date(now);
    return {
      state: (item) => {
        const a = availabilityAt(item, at, tz);
        return { ...a, hours: hoursLabel(item.availableFrom, item.availableTo) };
      },
      formulaOpen: (f) => availabilityAt(f, at, tz).available,
      promoFor: (item) => bestPromotion(item.price, item, promotions ?? [], at, tz),
    };
  }, [now, tz, promotions]);
}
