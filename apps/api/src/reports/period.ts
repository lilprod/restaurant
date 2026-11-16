import { zonedDayRange } from "@restaurant/utils";

/** Jour (AAAA-MM-JJ) décalé de `n` jours. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const daysIn = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;

/** Période de même durée juste avant `from` (comparaison). */
export function previousPeriod(from: string, to: string) {
  const n = daysIn(from, to);
  return { from: addDays(from, -n), to: addDays(from, -1) };
}

/** Bornes UTC [start, end) d'une période de jours du restaurant — celles que le tableau de bord applique à une journée. */
export function rangeOf(p: { from: string; to: string }, tz: string) {
  return { start: zonedDayRange(p.from, tz).start, end: zonedDayRange(p.to, tz).end };
}
