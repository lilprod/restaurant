/** Modèle neutre d'un rapport : alimente l'export CSV et le PDF (mêmes en-têtes, mêmes totaux). */

export type Cell = string | number | null;
export type ColType = "text" | "int" | "money" | "percent" | "decimal" | "date";

export interface Col { label: string; type?: ColType }
export interface Section { title: string; columns: Col[]; rows: Cell[][]; total?: Cell[] }
export interface ReportDoc {
  title: string;
  /** Ex. « Du 01/11/2026 au 30/11/2026 ». */
  subtitle: string;
  kpis?: { label: string; value: string }[];
  sections: Section[];
}

export const METHOD_LABEL: Record<string, string> = { CASH: "Espèces", CARD: "Carte", FLOOZ: "Flooz", TMONEY: "TMoney", OTHER: "Autre" };
export const TYPE_LABEL: Record<string, string> = { DINE_IN: "Sur place", TAKEAWAY: "À emporter", DELIVERY: "Livraison" };
export const WEEKDAY_LABEL = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
export const STATUS_LABEL: Record<string, string> = { PENDING: "Nouvelle", IN_PROGRESS: "En préparation", READY: "Prête", DELIVERED: "Servie", CANCELLED: "Annulée" };

/** Espace insécable ordinaire (U+00A0) : présent dans les polices embarquées, contrairement à l'espace fine U+202F de `Intl`. */
export const fmtInt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
export const fmtMoney = (n: number) => `${fmtInt(n)} FCFA`;
export const fmtDec = (n: number, digits = 1) => n.toFixed(digits).replace(".", ",");
export const fmtPct = (n: number | null) => (n == null ? "—" : `${fmtDec(n)} %`);

/** « 16/11/2026 » à partir d'un jour AAAA-MM-JJ. */
export const dayFr = (d: string) => d.split("-").reverse().join("/");
export const periodLabel = (from: string, to: string) => (from === to ? `Le ${dayFr(from)}` : `Du ${dayFr(from)} au ${dayFr(to)}`);

/** Date-heure dans le fuseau du restaurant : « 16/11/2026 14:35 » (jamais d'espace fine). */
export function dateTimeFr(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(d).replace(/[  ]/g, " ").replace(",", "");
}

/** Variation en % entre deux valeurs (null si la base est nulle). */
export const delta = (now: number, before: number): number | null => (before === 0 ? null : Math.round(((now - before) / before) * 1000) / 10);
