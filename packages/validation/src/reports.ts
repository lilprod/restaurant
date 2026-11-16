import { z } from "zod";
import { dayStringSchema } from "./staff";

/** P5 — Rapports : période, exports et réglage du rapport quotidien. */

export const reportsSettingsSchema = z.object({
  /** Envoie chaque matin aux responsables (administrateur, gérant) le récapitulatif de la veille. */
  dailyReport: z.boolean(),
  /** Heure locale (0–23) à partir de laquelle le rapport de la veille part. */
  dailyReportHour: z.number().int().min(0).max(23),
});
export type ReportsSettingsInput = z.infer<typeof reportsSettingsSchema>;

const MAX_DAYS = 366;
const span = (v: { from: string; to: string }) => (Date.parse(`${v.to}T00:00:00Z`) - Date.parse(`${v.from}T00:00:00Z`)) / 86_400_000 + 1;
const ordered = <T extends { from: string; to: string }>(s: z.ZodType<T, z.ZodTypeDef, unknown>) =>
  s.refine((v) => v.to >= v.from, { path: ["to"], message: "La fin précède le début" })
    .refine((v) => span(v) <= MAX_DAYS, { path: ["to"], message: "Période de 366 jours au plus" });

/** Période de rapport : jours calendaires du restaurant, bornes incluses. */
export const reportPeriodSchema = ordered(z.object({ from: dayStringSchema, to: dayStringSchema }));
export type ReportPeriodQuery = z.infer<typeof reportPeriodSchema>;

export const REPORT_KINDS = ["sales", "vat", "register", "margins", "waste", "staff", "reviews", "peak-hours", "orders"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const reportKindSchema = z.enum(REPORT_KINDS);
export const REPORT_FORMATS = ["csv", "pdf"] as const;

export const reportExportQuerySchema = ordered(z.object({ from: dayStringSchema, to: dayStringSchema, format: z.enum(REPORT_FORMATS).default("csv") }));
export type ReportExportQuery = z.infer<typeof reportExportQuerySchema>;

/** Rapport de la plateforme : jusqu'à 5 ans, regroupé par mois. */
export const platformReportQuerySchema = z.object({ from: dayStringSchema, to: dayStringSchema, format: z.enum(REPORT_FORMATS).default("csv") })
  .refine((v) => v.to >= v.from, { path: ["to"], message: "La fin précède le début" })
  .refine((v) => span(v) <= 1830, { path: ["to"], message: "Période de 5 ans au plus" });
export type PlatformReportQuery = z.infer<typeof platformReportQuerySchema>;
