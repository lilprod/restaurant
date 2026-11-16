import { z } from "zod";

/** Schémas du personnel (P4) : fiches, planning, pointage, absences, paie, messagerie. */

const uuid = z.string().uuid();
const optText = (max: number) => z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === "" ? null : v));
/** Jour calendaire du restaurant : AAAA-MM-JJ. */
export const dayStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ").refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "Date invalide");

export const staffSettingsSchema = z.object({
  /** Au-delà de ce volume hebdomadaire, les heures sont supplémentaires. */
  overtimeThresholdHours: z.number().min(1).max(80),
  /** Congés payés annuels par personne (jours). */
  leaveDaysPerYear: z.number().int().min(0).max(60),
});
export type StaffSettingsInput = z.infer<typeof staffSettingsSchema>;

// ── Fiches ──
export const contractTypeSchema = z.enum(["CDI", "CDD", "EXTRA", "INTERN", "OTHER"]);
export const staffProfileInputSchema = z.object({
  position: z.string().trim().min(1, "Indiquez le poste").max(60),
  contractType: contractTypeSchema.default("CDI"),
  contractEndsAt: dayStringSchema.nullable().optional(),
  hiredAt: dayStringSchema,
  /** Taux horaire FCFA et majoration des heures supplémentaires : réservés à l'administrateur. */
  hourlyRate: z.number().int().min(0).max(1_000_000).optional(),
  overtimeMultiplier: z.number().min(1).max(3).optional(),
  emergencyContact: nullableText(120),
  notes: nullableText(500),
}).refine((v) => !v.contractEndsAt || v.contractEndsAt >= v.hiredAt, { path: ["contractEndsAt"], message: "La fin du contrat précède l'embauche" });
export type StaffProfileInput = z.infer<typeof staffProfileInputSchema>;

/** Code de pointage : 4 à 6 chiffres, ni répétés (1111) ni suite (1234). */
/** Action sans paramètre : corps vide (documenté dans OpenAPI). */
export const emptyBodySchema = z.object({});

export const kioskCodeSchema = z.object({
  code: z.string().regex(/^\d{4,6}$/, "Le code comporte 4 à 6 chiffres").refine((c) => {
    if (/^(\d)\1+$/.test(c)) return false;
    const d = [...c].map(Number);
    return !(d.every((n, i) => i === 0 || n === d[i - 1] + 1) || d.every((n, i) => i === 0 || n === d[i - 1] - 1));
  }, "Code trop simple : évitez les chiffres répétés ou à la suite"),
});
export type KioskCodeInput = z.infer<typeof kioskCodeSchema>;

// ── Planning ──
const dateTime = z.coerce.date();
const shiftBase = z.object({
  staffId: uuid,
  startsAt: dateTime,
  endsAt: dateTime,
  position: optText(60),
  notes: nullableText(300),
});
const shiftRange = (v: { startsAt?: Date; endsAt?: Date }) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt;
const shiftLength = (v: { startsAt?: Date; endsAt?: Date }) => !v.startsAt || !v.endsAt || v.endsAt.getTime() - v.startsAt.getTime() <= 16 * 3_600_000;
export const shiftInputSchema = shiftBase
  .refine(shiftRange, { path: ["endsAt"], message: "La fin doit suivre le début" })
  .refine(shiftLength, { path: ["endsAt"], message: "Un créneau dure 16 h au plus" });
export const shiftUpdateSchema = shiftBase.partial()
  .refine(shiftRange, { path: ["endsAt"], message: "La fin doit suivre le début" })
  .refine(shiftLength, { path: ["endsAt"], message: "Un créneau dure 16 h au plus" });
export const planningQuerySchema = z.object({ week: dayStringSchema.optional() });
export const copyWeekSchema = z.object({ fromWeek: dayStringSchema, toWeek: dayStringSchema })
  .refine((v) => v.fromWeek !== v.toWeek, { path: ["toWeek"], message: "Choisissez une autre semaine que celle à copier" });
export const publishWeekSchema = z.object({ week: dayStringSchema });
export type ShiftInput = z.infer<typeof shiftInputSchema>;
export type ShiftUpdate = z.infer<typeof shiftUpdateSchema>;
export type CopyWeekInput = z.infer<typeof copyWeekSchema>;
export type PublishWeekInput = z.infer<typeof publishWeekSchema>;

// ── Pointage ──
export const punchActionSchema = z.enum(["IN", "OUT", "BREAK_START", "BREAK_END"]);
export const punchSchema = z.object({ action: punchActionSchema });
export const kioskPunchSchema = z.object({ staffId: uuid, code: z.string().regex(/^\d{4,6}$/, "Le code comporte 4 à 6 chiffres"), action: punchActionSchema });
export const attendanceCreateSchema = z.object({
  staffId: uuid,
  clockIn: dateTime,
  clockOut: dateTime,
  breakMinutes: z.number().int().min(0).max(600).default(0),
  note: z.string().trim().min(3, "Expliquez la correction").max(300),
}).refine((v) => v.clockOut > v.clockIn, { path: ["clockOut"], message: "Le départ doit suivre l'arrivée" });
export const attendanceCorrectionSchema = z.object({
  clockIn: dateTime.optional(),
  clockOut: dateTime.nullable().optional(),
  breakMinutes: z.number().int().min(0).max(600).optional(),
  note: z.string().trim().min(3, "Expliquez la correction").max(300),
}).refine((v) => !v.clockIn || !v.clockOut || v.clockOut > v.clockIn, { path: ["clockOut"], message: "Le départ doit suivre l'arrivée" });
export const listAttendanceQuerySchema = z.object({ from: dayStringSchema, to: dayStringSchema, staffId: uuid.optional() })
  .refine((v) => v.to >= v.from, { path: ["to"], message: "La fin précède le début" });
export type PunchAction = z.infer<typeof punchActionSchema>;
export type KioskPunchInput = z.infer<typeof kioskPunchSchema>;
export type AttendanceCreateInput = z.infer<typeof attendanceCreateSchema>;
export type AttendanceCorrectionInput = z.infer<typeof attendanceCorrectionSchema>;
export type ListAttendanceQuery = z.infer<typeof listAttendanceQuerySchema>;

// ── Absences ──
export const absenceTypeSchema = z.enum(["PAID_LEAVE", "SICK", "UNPAID", "OTHER"]);
export const absenceInputSchema = z.object({
  /** Responsables : demande saisie pour quelqu'un (validée d'office). */
  staffId: uuid.optional(),
  type: absenceTypeSchema,
  from: dayStringSchema,
  to: dayStringSchema,
  reason: optText(300),
}).refine((v) => v.to >= v.from, { path: ["to"], message: "La fin précède le début" });
export const balanceQuerySchema = z.object({ userId: uuid.optional(), year: z.coerce.number().int().min(2000).max(2100).optional() });
export const absenceDecisionSchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), note: optText(300) });
export const listAbsencesQuerySchema = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(), mine: z.enum(["true", "false"]).optional() });
export type AbsenceInput = z.infer<typeof absenceInputSchema>;
export type AbsenceDecisionInput = z.infer<typeof absenceDecisionSchema>;

// ── Performances et paie ──
export const periodQuerySchema = z.object({ from: dayStringSchema, to: dayStringSchema })
  .refine((v) => v.to >= v.from, { path: ["to"], message: "La fin précède le début" })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 92 * 86_400_000, { path: ["to"], message: "Période de 93 jours au plus" });
export type PeriodQuery = z.infer<typeof periodQuerySchema>;

// ── Messagerie ──
export const sendMessageSchema = z.object({
  body: z.string().trim().min(1, "Écrivez un message").max(2000),
  mentions: z.array(uuid).max(20).default([]),
});
export const directChannelSchema = z.object({ userId: uuid });
export const listMessagesQuerySchema = z.object({ before: z.coerce.date().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
