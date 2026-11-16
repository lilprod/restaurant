import { ConflictException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import type { AttendanceCorrectionInput, AttendanceCreateInput, KioskPunchInput, ListAttendanceQuery, PunchAction } from "@restaurant/validation";
import { addDays, minutesBetween, zonedDayRange } from "@restaurant/utils";
import { PrismaService, Tx } from "../prisma/prisma.service";
import type { Account } from "../security/accounts.repo";
import { PasswordService } from "../security/password.service";
import { SecurityPolicyService } from "../security/security-policy.service";
import { StaffContext, fullName, hhmm } from "./staff.common";
import { attendanceInclude, attendanceView, presence, shiftInclude, shiftView } from "./staff.views";

const SHIFT_EARLY_MS = 2 * 3_600_000; // un pointage jusqu'à 2 h avant le début se rattache au créneau

/** Pointage (compte personnel ou tablette commune), rattachement au créneau, corrections par un responsable. */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: StaffContext,
    private readonly passwords: PasswordService,
    private readonly policies: SecurityPolicyService,
  ) {}

  /** Applique une action de pointage ; sérialisé par personne (deux appareils simultanés ne créent jamais deux pointages ouverts). */
  private async apply(tx: Tx, tenantId: string, staffId: string, action: PunchAction, source: "SELF" | "KIOSK", now = new Date()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`attendance:${staffId}`}))`;
    const open = await tx.attendance.findFirst({ where: { tenantId, staffId, clockOut: null }, orderBy: { clockIn: "desc" } });
    if (action === "IN") {
      if (open) throw new ConflictException("Vous avez déjà pointé votre arrivée");
      // Créneau publié le plus proche, pas encore rattaché à un pointage.
      const candidates = await tx.shift.findMany({
        where: { tenantId, staffId, publishedAt: { not: null }, endsAt: { gt: now }, startsAt: { lte: new Date(now.getTime() + SHIFT_EARLY_MS) }, attendances: { none: {} } },
        orderBy: { startsAt: "asc" },
      });
      const shift = candidates.sort((a, b) => Math.abs(a.startsAt.getTime() - now.getTime()) - Math.abs(b.startsAt.getTime() - now.getTime()))[0];
      return tx.attendance.create({ data: { tenantId, staffId, shiftId: shift?.id ?? null, clockIn: now, source }, include: attendanceInclude });
    }
    if (!open) throw new ConflictException("Pointez d'abord votre arrivée");
    if (action === "BREAK_START") {
      if (open.breakStartedAt) throw new ConflictException("Une pause est déjà en cours");
      return tx.attendance.update({ where: { id: open.id }, data: { breakStartedAt: now }, include: attendanceInclude });
    }
    const closeBreak = open.breakStartedAt ? { breakMinutes: open.breakMinutes + Math.max(0, minutesBetween(open.breakStartedAt, now)), breakStartedAt: null } : {};
    if (action === "BREAK_END") {
      if (!open.breakStartedAt) throw new ConflictException("Aucune pause en cours");
      return tx.attendance.update({ where: { id: open.id }, data: closeBreak, include: attendanceInclude });
    }
    return tx.attendance.update({ where: { id: open.id }, data: { ...closeBreak, clockOut: now }, include: attendanceInclude });
  }

  private async profileId(tx: Tx, tenantId: string, userId: string) {
    const p = await tx.staffProfile.findFirst({ where: { tenantId, userId } });
    if (!p) throw new ConflictException("Votre fiche personnel n'est pas encore créée : demandez à un responsable");
    return p;
  }

  /** Mon état de pointage et mon créneau du jour. */
  async me(acc: Account) {
    const tenantId = acc.tenantId!, c = await this.ctx.get(tenantId), now = new Date();
    return this.prisma.asTenant(tenantId, async (tx) => {
      const p = await tx.staffProfile.findFirst({ where: { tenantId, userId: acc.id } });
      if (!p) return { hasProfile: false, state: "OFF" as const, open: null, today: [], shift: null };
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: c.tz }).format(now);
      const range = zonedDayRange(day, c.tz);
      const [open, today, shift] = await Promise.all([
        tx.attendance.findFirst({ where: { tenantId, staffId: p.id, clockOut: null }, include: attendanceInclude }),
        tx.attendance.findMany({ where: { tenantId, staffId: p.id, clockIn: { gte: range.start, lt: range.end } }, include: attendanceInclude, orderBy: { clockIn: "asc" } }),
        tx.shift.findFirst({ where: { tenantId, staffId: p.id, publishedAt: { not: null }, endsAt: { gt: now }, startsAt: { lt: range.end } }, orderBy: { startsAt: "asc" }, include: shiftInclude }),
      ]);
      return { hasProfile: true, state: presence(open), open: open && attendanceView(open), today: today.map(attendanceView), shift: shift && shiftView(shift) };
    });
  }

  async punch(acc: Account, action: PunchAction) {
    const tenantId = acc.tenantId!;
    const a = await this.prisma.asTenant(tenantId, async (tx) => {
      const p = await this.profileId(tx, tenantId, acc.id);
      return this.apply(tx, tenantId, p.id, action, "SELF");
    });
    return { ...attendanceView(a), state: presence(a.clockOut ? null : a) };
  }

  // ── Tablette commune (kiosque) ──

  /** Personnes pouvant pointer sur la tablette (celles qui ont un code) et leur état. */
  async kioskPeople(tenantId: string) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      const rows = await tx.staffProfile.findMany({
        where: { tenantId, kioskPinHash: { not: null }, user: { isActive: true } },
        include: { user: { select: { firstName: true, lastName: true } }, attendances: { where: { clockOut: null }, take: 1 } },
        orderBy: { user: { firstName: "asc" } },
      });
      return rows.map((p) => ({ staffId: p.id, name: fullName(p.user), position: p.position, state: presence(p.attendances[0]) }));
    });
  }

  async kioskPunch(acc: Account, input: KioskPunchInput) {
    const tenantId = acc.tenantId!;
    const policy = await this.policies.get("tenant", tenantId);
    const c = await this.ctx.get(tenantId);
    const now = new Date();
    const p = await this.prisma.asTenant(tenantId, (tx) => tx.staffProfile.findFirst({ where: { id: input.staffId, tenantId, user: { isActive: true } }, include: { user: { select: { firstName: true, lastName: true } } } }));
    if (!p) throw new NotFoundException("Personne introuvable");
    if (!p.kioskPinHash) throw new ConflictException("Aucun code de pointage n'est défini pour cette personne");
    if (p.kioskLockedUntil && p.kioskLockedUntil > now) {
      throw new HttpException({ statusCode: 423, code: "KIOSK_LOCKED", message: `Pointage verrouillé jusqu'à ${hhmm(p.kioskLockedUntil, c.tz)} après trop d'essais. Un responsable peut le déverrouiller.` }, 423);
    }
    const ok = await this.passwords.verify(p.kioskPinHash, input.code);
    if (!ok) {
      // Le compteur est enregistré hors de la transaction qui échoue ensuite.
      const expired = !!p.kioskLockedUntil && p.kioskLockedUntil <= now;
      const failed = (expired ? 0 : p.kioskFailedCount) + 1;
      const locks = failed >= policy.maxFailedAttempts;
      const until = locks ? new Date(now.getTime() + policy.lockoutMinutes * 60_000) : null;
      await this.prisma.asTenant(tenantId, async (tx) => {
        await tx.staffProfile.update({ where: { id: p.id }, data: { kioskFailedCount: locks ? 0 : failed, kioskLockedUntil: until } });
        if (locks) await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "staff.kiosk.locked", entity: "StaffProfile", entityId: p.id, metadata: { until } } });
      });
      if (locks) throw new HttpException({ statusCode: 423, code: "KIOSK_LOCKED", message: `Trop d'essais : pointage verrouillé pour ${policy.lockoutMinutes} minutes.` }, 423);
      const left = policy.maxFailedAttempts - failed;
      throw new HttpException({ statusCode: 400, code: "KIOSK_CODE_INVALID", message: `Code incorrect. ${left} essai${left > 1 ? "s" : ""} restant${left > 1 ? "s" : ""}.` }, 400);
    }
    const a = await this.prisma.asTenant(tenantId, async (tx) => {
      await tx.staffProfile.update({ where: { id: p.id }, data: { kioskFailedCount: 0, kioskLockedUntil: null } });
      return this.apply(tx, tenantId, p.id, input.action, "KIOSK", now);
    });
    return { ...attendanceView(a), state: presence(a.clockOut ? null : a), name: fullName(p.user) };
  }

  // ── Consultation et corrections ──

  async list(tenantId: string, q: ListAttendanceQuery) {
    const c = await this.ctx.get(tenantId);
    const start = zonedDayRange(q.from, c.tz).start, end = zonedDayRange(addDays(q.to, 0), c.tz).end;
    const rows = await this.prisma.asTenant(tenantId, (tx) => tx.attendance.findMany({
      where: { tenantId, clockIn: { gte: start, lt: end }, ...(q.staffId ? { staffId: q.staffId } : {}) },
      include: attendanceInclude, orderBy: { clockIn: "desc" }, take: 500,
    }));
    return rows.map(attendanceView);
  }

  /** Qui est présent maintenant (pointages ouverts). */
  async present(tenantId: string) {
    const rows = await this.prisma.asTenant(tenantId, (tx) => tx.attendance.findMany({ where: { tenantId, clockOut: null }, include: attendanceInclude, orderBy: { clockIn: "asc" } }));
    return rows.map(attendanceView);
  }

  async create(acc: Account, input: AttendanceCreateInput) {
    const tenantId = acc.tenantId!;
    return this.prisma.asTenant(tenantId, async (tx) => {
      const p = await tx.staffProfile.findFirst({ where: { id: input.staffId, tenantId } });
      if (!p) throw new NotFoundException("Personne introuvable");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`attendance:${p.id}`}))`;
      await this.assertFree(tx, tenantId, p.id, input.clockIn, input.clockOut);
      const a = await tx.attendance.create({
        data: { tenantId, staffId: p.id, clockIn: input.clockIn, clockOut: input.clockOut, breakMinutes: input.breakMinutes, source: "MANUAL", note: input.note, correctedById: acc.id, correctedAt: new Date() },
        include: attendanceInclude,
      });
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "staff.attendance.create", entity: "Attendance", entityId: a.id, metadata: { staffId: p.id, clockIn: input.clockIn, clockOut: input.clockOut, note: input.note } } });
      return attendanceView(a);
    });
  }

  private async assertFree(tx: Tx, tenantId: string, staffId: string, start: Date, end: Date | null, excludeId?: string) {
    const clash = await tx.attendance.findFirst({
      where: { tenantId, staffId, ...(excludeId ? { id: { not: excludeId } } : {}), clockIn: { lt: end ?? new Date(8.64e15) }, OR: [{ clockOut: null }, { clockOut: { gt: start } }] },
    });
    if (clash) throw new ConflictException("Ce pointage chevauche un autre pointage de la même personne");
  }

  async correct(acc: Account, id: string, input: AttendanceCorrectionInput) {
    const tenantId = acc.tenantId!;
    return this.prisma.asTenant(tenantId, async (tx) => {
      const cur = await tx.attendance.findFirst({ where: { id, tenantId } });
      if (!cur) throw new NotFoundException("Pointage introuvable");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`attendance:${cur.staffId}`}))`;
      const clockIn = input.clockIn ?? cur.clockIn;
      const clockOut = input.clockOut === undefined ? cur.clockOut : input.clockOut;
      if (clockOut && clockOut <= clockIn) throw new ConflictException("Le départ doit suivre l'arrivée");
      await this.assertFree(tx, tenantId, cur.staffId, clockIn, clockOut, id);
      const a = await tx.attendance.update({
        where: { id },
        data: { clockIn, clockOut, breakMinutes: input.breakMinutes ?? cur.breakMinutes, ...(clockOut ? { breakStartedAt: null } : {}), note: input.note, correctedById: acc.id, correctedAt: new Date() },
        include: attendanceInclude,
      });
      await tx.auditLog.create({
        data: {
          tenantId, userId: acc.id, action: "staff.attendance.correct", entity: "Attendance", entityId: id,
          metadata: { note: input.note, before: { clockIn: cur.clockIn, clockOut: cur.clockOut, breakMinutes: cur.breakMinutes }, after: { clockIn, clockOut, breakMinutes: a.breakMinutes } },
        },
      });
      return attendanceView(a);
    });
  }
}
