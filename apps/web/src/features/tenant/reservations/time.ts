import { addDays } from "@restaurant/utils";
import type { StatusTone } from "@restaurant/ui-tokens";

export { addDays };

/** Heure locale « 19:30 » d'un instant, dans le fuseau du restaurant. */
export function fmtTime(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(iso));
}

/** Jour local AAAA-MM-JJ. */
export function dayOf(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export const todayIn = (timeZone: string) => dayOf(new Date(), timeZone);

/** Minutes écoulées depuis minuit local (jour du fuseau). */
export function minutesOfDay(iso: string | Date, timeZone: string): number {
  const [h, m] = fmtTime(iso, timeZone).split(":").map(Number);
  return (h! % 24) * 60 + m!;
}

/** « samedi 14 novembre 2026 » pour un jour AAAA-MM-JJ. */
export function fmtDay(day: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }): string {
  return new Intl.DateTimeFormat("fr-FR", { ...opts, timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}

/** Valeur d'un `<input type="datetime-local">`-like : « 19:30 » → instant, via le jour et le fuseau. */
export function toLocalInput(iso: string, timeZone: string): { day: string; time: string } {
  return { day: dayOf(iso, timeZone), time: fmtTime(iso, timeZone) };
}

/** Tons de statut des réservations (couleur + toujours un libellé texte). */
export const RESERVATION_TONES: Record<string, StatusTone> = {
  PENDING: "amber", CONFIRMED: "blue", SEATED: "green", COMPLETED: "gray", CANCELLED: "gray", NO_SHOW: "red",
};
export const reservationTone = (s: string): StatusTone => RESERVATION_TONES[s] ?? "gray";
export const WAITLIST_TONES: Record<string, StatusTone> = { WAITING: "amber", NOTIFIED: "blue", CONVERTED: "green", EXPIRED: "gray", REMOVED: "gray" };
export const waitlistTone = (s: string): StatusTone => WAITLIST_TONES[s] ?? "gray";

export const ACTIVE_STATUSES = ["PENDING", "CONFIRMED", "SEATED"] as const;
export const WEEKDAYS = [
  { v: 1, l: "Lundi" }, { v: 2, l: "Mardi" }, { v: 3, l: "Mercredi" }, { v: 4, l: "Jeudi" }, { v: 5, l: "Vendredi" }, { v: 6, l: "Samedi" }, { v: 0, l: "Dimanche" },
];
