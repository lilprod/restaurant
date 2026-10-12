/** Journées calendaires dans le fuseau d'un restaurant (le serveur, lui, travaille en UTC). */

function offsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(at));
  const v = Object.fromEntries(parts.map((p) => [p.type, Number(p.value)]));
  const asUtc = Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** Jour (AAAA-MM-JJ) d'un instant dans un fuseau donné. */
export function zonedDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Début (inclus) et fin (exclue) d'une journée locale, en instants UTC. */
export function zonedDayRange(day: string, timeZone: string): { start: Date; end: Date } {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const start = guess - offsetMs(guess, timeZone);
  const next = Date.UTC(y, m - 1, d + 1);
  const end = next - offsetMs(next, timeZone);
  return { start: new Date(start), end: new Date(end) };
}

/** Heure locale (0–23) d'un instant. */
export function zonedHour(at: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(at));
}
