import { formatFcfa } from "@restaurant/utils";

export { formatFcfa };

/** Fuseau par défaut de l'interface (Togo). Peut être surchargé par les réglages de localisation. */
export const DEFAULT_TIMEZONE = "Africa/Lome";
let currentTimezone = DEFAULT_TIMEZONE;
export function setDisplayTimezone(tz: string | null | undefined) {
  try {
    if (tz) { new Intl.DateTimeFormat("fr-FR", { timeZone: tz }); currentTimezone = tz; }
  } catch { currentTimezone = DEFAULT_TIMEZONE; }
}

const toDate = (d: string | Date | null | undefined) => (d ? (d instanceof Date ? d : new Date(d)) : null);

/** 12 oct. 2026 */
export function formatDate(d: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = {}): string {
  const date = toDate(d);
  if (!date || Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: currentTimezone, ...opts }).format(date);
}

/** 12 oct. 2026, 14:05 */
export function formatDateTime(d: string | Date | null | undefined): string {
  return formatDate(d, { hour: "2-digit", minute: "2-digit" });
}

/** 12/10/2026 */
export function formatDateShort(d: string | Date | null | undefined): string {
  return formatDate(d, { day: "2-digit", month: "2-digit", year: "numeric" });
}

const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
/** « il y a 3 minutes », « dans 5 jours » */
export function formatRelative(d: string | Date | null | undefined, now = Date.now()): string {
  const date = toDate(d);
  if (!date) return "—";
  const diff = (date.getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "à l'instant";
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["minute", 60], ["hour", 3600], ["day", 86400], ["month", 2592000], ["year", 31536000]];
  let unit: Intl.RelativeTimeFormatUnit = "minute";
  let value = diff / 60;
  for (const [u, s] of units) {
    if (abs >= s) { unit = u; value = diff / s; }
  }
  return rtf.format(Math.round(value), unit);
}

/** Jours entiers restants avant une date (négatif si passée). */
export function daysUntil(d: string | Date | null | undefined, now = Date.now()): number | null {
  const date = toDate(d);
  if (!date) return null;
  return Math.ceil((date.getTime() - now) / 86_400_000);
}

export const formatNumber = (n: number) => new Intl.NumberFormat("fr-FR").format(n);

/** Valeur `<input type="date">` (AAAA-MM-JJ) dans le fuseau d'affichage. */
export function toDateInputValue(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: currentTimezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return parts;
}

export function initials(first?: string | null, last?: string | null, fallback = "?"): string {
  const s = `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase();
  return s || fallback;
}

export function pluralize(n: number, singular: string, plural = `${singular}s`) {
  return `${formatNumber(n)} ${n > 1 ? plural : singular}`;
}
