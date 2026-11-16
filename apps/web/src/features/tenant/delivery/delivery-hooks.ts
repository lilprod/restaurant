import type { Delivery } from "@restaurant/api-client";
import { ApiError } from "@restaurant/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { applyDeliveryEvent } from "@/lib/realtime/delivery-cache";
import { tenantKeys } from "@/lib/tenant-keys";
import { useSession } from "@/providers/session";
import { useOperations, useTenant } from "../hooks";

/** Zones de livraison (salle et responsables). Désactivé tant que le réglage `deliveryEnabled` est coupé. */
export function useDeliveryZones(enabled = true) {
  const t = useTenant();
  const ops = useOperations();
  return useQuery({
    queryKey: tenantKeys.deliveryZones(t.root), queryFn: t.api.delivery.zones, staleTime: 60_000,
    enabled: enabled && t.isFloor && ops.deliveryEnabled, retry: (n, e) => !(e instanceof ApiError && e.status === 403) && n < 2,
  });
}

/** La livraison est-elle utilisable ici ? (réglage activé ET plan avec le module : 403 PLAN_FEATURE sinon). */
export function useDeliveryAvailable() {
  const ops = useOperations();
  const zones = useDeliveryZones();
  const planBlocked = zones.error instanceof ApiError && zones.error.status === 403;
  return { enabled: ops.deliveryEnabled && !planBlocked, planBlocked, zones };
}

export function useDeliveryBoard() {
  const t = useTenant();
  return useQuery({ queryKey: tenantKeys.deliveryBoard(t.root), queryFn: () => t.api.delivery.board(), enabled: t.isFloor });
}

export function useMyDeliveries() {
  const t = useTenant();
  return useQuery({ queryKey: tenantKeys.deliveryMine(t.root), queryFn: t.api.delivery.mine, enabled: t.role === "DRIVER" });
}

/** Reporte la livraison renvoyée par une action dans les caches (sans attendre la socket). */
export function useApplyDelivery() {
  const qc = useQueryClient();
  const t = useTenant();
  const { user } = useSession();
  return React.useCallback((d: Delivery) => applyDeliveryEvent(qc, t.root, d, user?.id), [qc, t.root, user?.id]);
}

/** Lien d'itinéraire (carte) vers l'adresse de livraison : ouvre l'application de cartes du téléphone. */
export function mapsLink(d: Pick<Delivery, "address" | "neighborhood" | "landmark">): string {
  const q = [d.address, d.landmark, d.neighborhood, "Lomé, Togo"].filter(Boolean).join(", ");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}

export const telLink = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
