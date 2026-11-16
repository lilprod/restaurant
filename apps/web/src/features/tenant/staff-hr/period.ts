import { addDays, weekStartOf } from "@restaurant/utils";

export type PeriodKey = "today" | "week" | "last-week" | "30d" | "month";

export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: "today", label: "Aujourd'hui" },
  { value: "week", label: "Cette semaine" },
  { value: "last-week", label: "Semaine dernière" },
  { value: "30d", label: "30 jours" },
  { value: "month", label: "Ce mois" },
];

/** Bornes (jours AAAA-MM-JJ du restaurant, fin incluse) d'une période prédéfinie. */
export function periodRange(key: PeriodKey, today: string): { from: string; to: string } {
  const ws = weekStartOf(today, 1);
  switch (key) {
    case "today": return { from: today, to: today };
    case "week": return { from: ws, to: addDays(ws, 6) };
    case "last-week": return { from: addDays(ws, -7), to: addDays(ws, -1) };
    case "30d": return { from: addDays(today, -29), to: today };
    case "month": return { from: `${today.slice(0, 8)}01`, to: today };
  }
}
