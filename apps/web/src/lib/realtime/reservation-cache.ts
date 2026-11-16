import type { Reservation, WaitlistEntry } from "@restaurant/api-client";
import type { QueryClient } from "@tanstack/react-query";
import { tenantKeys, type ReservationListKey } from "../tenant-keys";

type Root = readonly unknown[];

/** Jour local AAAA-MM-JJ d'un instant dans un fuseau. */
export function localDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** Une réservation appartient-elle à la liste décrite par `q` ? (journée du restaurant ou intervalle) */
export function reservationInList(r: Reservation, q: ReservationListKey, timeZone: string): boolean {
  if (q.from || q.to) {
    const t = +new Date(r.startsAt);
    return (!q.from || t >= +new Date(q.from)) && (!q.to || t < +new Date(q.to));
  }
  return !q.date || localDay(r.startsAt, timeZone) === q.date;
}

const byStart = (a: Reservation, b: Reservation) => +new Date(a.startsAt) - +new Date(b.startsAt) || a.code.localeCompare(b.code);

/** Remplace, insère ou retire une réservation d'une liste (selon le filtre de la liste), triée par heure. */
export function applyReservationToList(list: Reservation[], r: Reservation, q: ReservationListKey, timeZone: string): Reservation[] {
  const has = list.some((x) => x.id === r.id);
  const belongs = reservationInList(r, q, timeZone);
  if (has && belongs) return list.map((x) => (x.id === r.id ? r : x));
  if (has) return list.filter((x) => x.id !== r.id);
  return belongs ? [...list, r].sort(byStart) : list;
}

/** `reservation.created|updated` : met à jour en place le détail et toutes les listes en cache. */
export function applyReservationEvent(qc: QueryClient, root: Root, r: Reservation, opts: { timeZone?: string } = {}) {
  const tz = opts.timeZone ?? "Africa/Lome";
  qc.setQueryData(tenantKeys.reservation(root, r.id), r);
  for (const [key, data] of qc.getQueriesData<Reservation[]>({ queryKey: tenantKeys.reservationLists(root) })) {
    if (!data) continue;
    const q = (key[key.length - 1] ?? {}) as ReservationListKey;
    const next = applyReservationToList(data, r, q, tz);
    if (next !== data) qc.setQueryData(key, next);
  }
  // Les disponibilités changent avec chaque réservation.
  void qc.invalidateQueries({ queryKey: [...tenantKeys.reservations(root), "availability"] });
}

const ACTIVE = ["WAITING", "NOTIFIED"];

/** `waitlist.updated` : met à jour les listes d'attente (entrée active : remplacée ou ajoutée ; close : retirée). */
export function applyWaitlistToList(list: WaitlistEntry[], w: WaitlistEntry): WaitlistEntry[] {
  const has = list.some((x) => x.id === w.id);
  const active = ACTIVE.includes(w.status);
  if (has) return active ? list.map((x) => (x.id === w.id ? w : x)) : list.filter((x) => x.id !== w.id);
  return active ? [...list, w].sort((a, b) => +new Date(a.desiredAt) - +new Date(b.desiredAt)) : list;
}

export function applyWaitlistEvent(qc: QueryClient, root: Root, w: WaitlistEntry) {
  for (const [key, data] of qc.getQueriesData<WaitlistEntry[]>({ queryKey: tenantKeys.waitlistLists(root) })) {
    if (data) qc.setQueryData(key, applyWaitlistToList(data, w));
  }
}
