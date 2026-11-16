import type { Reservation, ReservationsQuery, WaitlistEntry } from "@restaurant/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toastError } from "@/lib/errors";
import { applyReservationEvent } from "@/lib/realtime/reservation-cache";
import { tenantKeys } from "@/lib/tenant-keys";
import { useTenant, useTimezone } from "../hooks";

/** Réservations d'une journée de service (cache mis à jour en place par le temps réel). */
export function useReservations(q: { date?: string; from?: string; to?: string }, enabled = true) {
  const t = useTenant();
  const query: ReservationsQuery = q;
  return useQuery({ queryKey: tenantKeys.reservationList(t.root, q), queryFn: () => t.api.reservations.list(query), enabled, refetchInterval: 120_000 });
}

export function useWaitlist(q: { date?: string } = {}) {
  const t = useTenant();
  return useQuery({ queryKey: tenantKeys.waitlist(t.root, q), queryFn: () => t.api.waitlist.list(q), refetchInterval: 120_000 });
}

export function useOpeningHours() {
  const t = useTenant();
  return useQuery({ queryKey: tenantKeys.openingHours(t.root), queryFn: () => t.api.openingHours.get(), staleTime: 5 * 60_000 });
}

/** Reporte tout de suite la réservation renvoyée par une action (sans attendre la socket). */
export function useApplyReservation() {
  const qc = useQueryClient();
  const t = useTenant();
  const tz = useTimezone();
  return React.useCallback((r: Reservation) => applyReservationEvent(qc, t.root, r, { timeZone: tz }), [qc, t.root, tz]);
}

export type ReservationAction = "confirm" | "seat" | "complete" | "no-show";

/** Actions de statut d'une réservation (confirmer, installer, terminer, absent). */
export function useReservationAction(onDone?: (action: ReservationAction, r: Reservation) => void) {
  const t = useTenant();
  const apply = useApplyReservation();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: ReservationAction }) =>
      action === "confirm" ? t.api.reservations.confirm(id)
        : action === "seat" ? t.api.reservations.seat(id)
        : action === "complete" ? t.api.reservations.complete(id)
        : t.api.reservations.noShow(id),
    onSuccess: (r, v) => {
      apply(r);
      if (v.action === "seat" || v.action === "complete") void qc.invalidateQueries({ queryKey: tenantKeys.tables(t.root) });
      onDone?.(v.action, r);
    },
    onError: (e) => toastError(e),
  });
}

export const waitlistKey = (root: readonly unknown[]) => tenantKeys.waitlistLists(root);
export type { WaitlistEntry };
