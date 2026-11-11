import { zonedDay } from "@restaurant/utils";
import type { LicenseTier } from "./templates/license";

const dayNumber = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;

/** Nombre de jours calendaires (fuseau du restaurant) entre `now` et l'échéance : négatif une fois échue. */
export function daysUntil(periodEnd: Date, now: Date, timeZone: string): number {
  return dayNumber(zonedDay(periodEnd, timeZone)) - dayNumber(zonedDay(now, timeZone));
}

/**
 * Palier de relance à envoyer maintenant : J-7 (de 7 à 2 jours avant), J-1 (la veille), J0 (jour de l'expiration et
 * jusqu'à 2 jours après, si le balayage n'a pas pu passer avant). Un seul palier est dû à un instant donné ;
 * la déduplication (une fois par palier et par échéance) est assurée par la clé du journal.
 */
export function dueLicenseTier(periodEnd: Date, now: Date, timeZone: string): LicenseTier | null {
  const days = daysUntil(periodEnd, now, timeZone);
  if (days > 7) return null;
  if (days >= 2) return "J7";
  if (days === 1) return "J1";
  return days >= -2 ? "J0" : null;
}
