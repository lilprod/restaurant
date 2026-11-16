import { ApiError } from "@restaurant/api-client";
import { addDays, localTimeToInstant, weekStartOf, zonedDay } from "@restaurant/utils";
import { useQuery } from "@tanstack/react-query";
import { tenantKeys } from "@/lib/tenant-keys";
import { useTenant, useTimezone } from "../hooks";

const noRetryOn403 = (n: number, e: unknown) => !(e instanceof ApiError && e.status === 403) && n < 2;
export const isPlanFeatureError = (e: unknown) => e instanceof ApiError && e.code === "PLAN_FEATURE";

/** Mon état de pointage. Sert aussi de sonde du module : `moduleEnabled === false` quand le plan n'inclut pas le personnel. */
export function useMyAttendance() {
  const t = useTenant();
  const q = useQuery({ queryKey: tenantKeys.hrMe(t.root), queryFn: () => t.api.staffHr.myAttendance(), staleTime: 30_000, retry: noRetryOn403, enabled: !t.isDriver });
  return { ...q, moduleEnabled: !isPlanFeatureError(q.error) };
}

/** Semaine (premier jour) contenant `day`, dans le fuseau du restaurant. */
export function useWeekStart(param: string) {
  const tz = useTimezone();
  const today = zonedDay(new Date(), tz);
  const week = weekStartOf(param || today, 1);
  return { tz, today, week, isCurrent: week === weekStartOf(today, 1), prev: addDays(week, -7), next: addDays(week, 7) };
}

/** Instant UTC d'une heure murale du restaurant (« 2026-11-16 », « 11:30 »). */
export function instantOf(day: string, time: string, tz: string): Date {
  return localTimeToInstant(day, time, tz) ?? new Date(`${day}T${time}:00Z`);
}

export const dayOfIso = (iso: string, tz: string) => zonedDay(new Date(iso), tz);
export const timeOfIso = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

/** « lun. 16 nov. » à partir d'un jour AAAA-MM-JJ. */
export const dayLabel = (day: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) =>
  new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", ...opts }).format(new Date(`${day}T00:00:00Z`));

/** « 7 h 30 » */
export function hoursLabel(minutes: number) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/** Heures décimales pour un tableau (« 7,50 »). */
export const decimalHours = (minutes: number) => (minutes / 60).toFixed(2).replace(".", ",");
