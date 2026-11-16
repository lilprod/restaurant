import type { Absence, Attendance, Shift, StaffProfile, User } from "@prisma/client";
import { minutesBetween } from "@restaurant/utils";
import { dateToDay, fullName } from "./staff.common";

type UserLite = Pick<User, "id" | "firstName" | "lastName" | "email" | "phone" | "role" | "isActive">;

export type PresenceState = "OFF" | "CLOCKED_IN" | "ON_BREAK";
export const presence = (open: Pick<Attendance, "breakStartedAt"> | null | undefined): PresenceState =>
  !open ? "OFF" : open.breakStartedAt ? "ON_BREAK" : "CLOCKED_IN";

/** Fiche RH. Le taux horaire n'est montré qu'à l'administrateur (et à la personne concernée). */
export function profileView(u: UserLite, p: StaffProfile | null, canSeeRate: boolean) {
  return {
    userId: u.id, firstName: u.firstName, lastName: u.lastName, name: fullName(u), email: u.email, phone: u.phone, role: u.role, isActive: u.isActive,
    profile: p && {
      id: p.id, position: p.position, contractType: p.contractType, contractEndsAt: p.contractEndsAt ? dateToDay(p.contractEndsAt) : null,
      hiredAt: dateToDay(p.hiredAt), emergencyContact: p.emergencyContact, notes: p.notes,
      hourlyRate: canSeeRate ? p.hourlyRate : null, overtimeMultiplier: canSeeRate ? Number(p.overtimeMultiplier) : null,
      kioskCodeSet: !!p.kioskPinHash, kioskLockedUntil: p.kioskLockedUntil && p.kioskLockedUntil > new Date() ? p.kioskLockedUntil : null,
    },
  };
}
export type ProfileView = ReturnType<typeof profileView>;

type ShiftRow = Shift & { staff: StaffProfile & { user: Pick<User, "id" | "firstName" | "lastName"> } };
export const shiftInclude = { staff: { include: { user: { select: { id: true, firstName: true, lastName: true } } } } } as const;
export const shiftView = (s: ShiftRow) => ({
  id: s.id, staffId: s.staffId, userId: s.staff.user.id, staffName: fullName(s.staff.user), startsAt: s.startsAt, endsAt: s.endsAt,
  position: s.position ?? s.staff.position, notes: s.notes, publishedAt: s.publishedAt,
});
export type ShiftView = ReturnType<typeof shiftView>;

type AttendanceRow = Attendance & { staff: StaffProfile & { user: Pick<User, "firstName" | "lastName"> } };
export const attendanceInclude = { staff: { include: { user: { select: { firstName: true, lastName: true } } } } } as const;
export function workedMinutes(a: Pick<Attendance, "clockIn" | "clockOut" | "breakMinutes">, now = new Date()) {
  return Math.max(0, minutesBetween(a.clockIn, a.clockOut ?? now) - a.breakMinutes);
}
export const attendanceView = (a: AttendanceRow) => ({
  id: a.id, staffId: a.staffId, staffName: fullName(a.staff.user), position: a.staff.position, shiftId: a.shiftId, clockIn: a.clockIn, clockOut: a.clockOut,
  breakMinutes: a.breakMinutes, breakStartedAt: a.breakStartedAt, source: a.source, note: a.note, correctedAt: a.correctedAt,
  workedMinutes: workedMinutes(a), state: presence(a.clockOut ? null : a),
});
export type AttendanceView = ReturnType<typeof attendanceView>;

type AbsenceRow = Absence & { staff: StaffProfile & { user: Pick<User, "firstName" | "lastName"> } };
export const absenceInclude = { staff: { include: { user: { select: { firstName: true, lastName: true } } } } } as const;
export const absenceView = (a: AbsenceRow, tz: string, dayOf: (d: Date, tz: string) => string) => {
  const fromDay = dayOf(a.from, tz), toDay = dayOf(new Date(a.to.getTime() - 1), tz);
  return {
    id: a.id, staffId: a.staffId, staffName: fullName(a.staff.user), type: a.type, status: a.status, fromDay, toDay,
    days: Math.round((Date.parse(toDay) - Date.parse(fromDay)) / 86_400_000) + 1,
    reason: a.reason, decisionNote: a.decisionNote, decidedAt: a.decidedAt, createdAt: a.createdAt,
  };
};
export type AbsenceView = ReturnType<typeof absenceView>;
