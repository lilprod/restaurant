import { addDays, localTimeToInstant, weekdayOf } from "./reservations";
import { zonedDay, zonedDayRange } from "./time";

/** Logique pure du personnel (P4) : semaines, chevauchements, heures normales / supplémentaires, brut estimé. */

/** Premier jour (AAAA-MM-JJ) de la semaine contenant `day` ; `firstDay` : 0 = dimanche, 1 = lundi (défaut), 6 = samedi. */
export function weekStartOf(day: string, firstDay = 1): string {
  return addDays(day, -((weekdayOf(day) - firstDay + 7) % 7));
}

/** Les 7 jours d'une semaine. */
export function weekDays(startDay: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(startDay, i));
}

/** Bornes d'une semaine locale : début inclus, fin exclue (instants UTC). */
export function weekBounds(startDay: string, timeZone: string): { start: Date; end: Date } {
  return { start: zonedDayRange(startDay, timeZone).start, end: zonedDayRange(addDays(startDay, 7), timeZone).start };
}

/** Deux plages se chevauchent (bornes `[début, fin[` : bout à bout n'est pas un chevauchement). */
export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** Minutes entières entre deux instants. */
export const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000);

/** Décale un instant de `days` jours locaux en gardant la même heure murale (copie de semaine, changement d'heure compris). */
export function shiftLocalDays(at: Date, days: number, timeZone: string): Date {
  const day = zonedDay(at, timeZone);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  return localTimeToInstant(addDays(day, days), time, timeZone) ?? new Date(at.getTime() + days * 86_400_000);
}

export interface WorkedSegment {
  start: Date;
  end: Date;
  /** Minutes travaillées (pause déduite). */
  minutes: number;
  /** Premier jour de la semaine qui contient le segment. */
  week: string;
}

/**
 * Découpe un pointage aux frontières de semaine (une nuit du dimanche au lundi compte pour les deux semaines).
 * La pause est répartie au prorata de la durée de chaque morceau.
 */
export function splitByWeek(clockIn: Date, clockOut: Date, breakMinutes: number, timeZone: string, firstDay = 1): WorkedSegment[] {
  const total = clockOut.getTime() - clockIn.getTime();
  if (total <= 0) return [];
  const pieces: { start: Date; end: Date; week: string }[] = [];
  let cursor = clockIn;
  while (cursor.getTime() < clockOut.getTime()) {
    const week = weekStartOf(zonedDay(cursor, timeZone), firstDay);
    const boundary = weekBounds(week, timeZone).end;
    const end = boundary.getTime() < clockOut.getTime() ? boundary : clockOut;
    pieces.push({ start: cursor, end, week });
    cursor = end;
  }
  let remaining = Math.max(0, breakMinutes);
  return pieces.map((p, i) => {
    const gross = Math.round((p.end.getTime() - p.start.getTime()) / 60_000);
    const share = i === pieces.length - 1 ? remaining : Math.round((breakMinutes * (p.end.getTime() - p.start.getTime())) / total);
    remaining -= share;
    return { ...p, minutes: Math.max(0, gross - share) };
  });
}

export interface PayrollAttendance { clockIn: Date; clockOut: Date | null; breakMinutes: number }
export interface PayrollWeek { week: string; normalMinutes: number; overtimeMinutes: number }
export interface PayrollHours { normalMinutes: number; overtimeMinutes: number; weeks: PayrollWeek[] }

/**
 * Heures normales et supplémentaires d'une personne sur `[from, to[`.
 * Le seuil est hebdomadaire : au-delà de `thresholdMinutes` dans une même semaine, les minutes (les plus récentes) sont supplémentaires.
 * Fournir aussi les pointages de la semaine qui précèdent `from` (le cumul de la semaine en dépend) ; un morceau est compté dans la période
 * où il commence. Les pointages encore ouverts sont ignorés.
 */
export function computeHours(attendances: PayrollAttendance[], period: { from: Date; to: Date }, timeZone: string, thresholdMinutes: number, firstDay = 1): PayrollHours {
  const segments = attendances
    .filter((a): a is PayrollAttendance & { clockOut: Date } => !!a.clockOut)
    .flatMap((a) => splitByWeek(a.clockIn, a.clockOut, a.breakMinutes, timeZone, firstDay))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const byWeek = new Map<string, PayrollWeek & { cumulated: number }>();
  for (const s of segments) {
    const w = byWeek.get(s.week) ?? { week: s.week, normalMinutes: 0, overtimeMinutes: 0, cumulated: 0 };
    byWeek.set(s.week, w);
    const before = w.cumulated;
    w.cumulated += s.minutes;
    if (s.start < period.from || s.start >= period.to) continue;
    const normal = Math.max(0, Math.min(w.cumulated, thresholdMinutes) - Math.min(before, thresholdMinutes));
    w.normalMinutes += normal;
    w.overtimeMinutes += s.minutes - normal;
  }
  const weeks = [...byWeek.values()].filter((w) => w.normalMinutes + w.overtimeMinutes > 0).map(({ week, normalMinutes, overtimeMinutes }) => ({ week, normalMinutes, overtimeMinutes }));
  return {
    normalMinutes: weeks.reduce((n, w) => n + w.normalMinutes, 0),
    overtimeMinutes: weeks.reduce((n, w) => n + w.overtimeMinutes, 0),
    weeks,
  };
}

/** Brut estimé en FCFA entiers : heures normales au taux horaire, heures supplémentaires majorées. */
export function grossPay(normalMinutes: number, overtimeMinutes: number, hourlyRate: number, overtimeMultiplier: number): number {
  return Math.round((normalMinutes * hourlyRate + overtimeMinutes * hourlyRate * overtimeMultiplier) / 60);
}

/** « 7 h 30 » à partir de minutes. */
export function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/** Jours calendaires (inclus) d'une absence. */
export function daysInRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
