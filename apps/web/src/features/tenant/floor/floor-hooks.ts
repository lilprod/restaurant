import type { Reservation } from "@restaurant/api-client";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { tenantKeys } from "@/lib/tenant-keys";
import { useTenant } from "../hooks";
import { useReservations } from "../reservations/hooks";
import { SOON_MINUTES } from "./floor-geometry";

/** Salles du restaurant (mises à jour par `floorplan.updated`). */
export function useFloorPlans() {
  const t = useTenant();
  return useQuery({ queryKey: tenantKeys.floorPlans(t.root), queryFn: () => t.api.floorPlans.list(), staleTime: 60_000 });
}

/** Réservations à venir dans l'heure ou en retard de moins de 30 min (cache partagé avec l'accueil, mis à jour par le temps réel). */
export function useSoonReservations(): { data: Reservation[]; isLoading: boolean } {
  const [tick, setTick] = React.useState(() => Math.floor(Date.now() / 300_000));
  React.useEffect(() => { const id = setInterval(() => setTick(Math.floor(Date.now() / 300_000)), 60_000); return () => clearInterval(id); }, []);
  const q = useReservations({ from: new Date(tick * 300_000 - 30 * 60_000).toISOString(), to: new Date(tick * 300_000 + (SOON_MINUTES + 5) * 60_000).toISOString() });
  return { data: q.data ?? [], isLoading: q.isLoading };
}
