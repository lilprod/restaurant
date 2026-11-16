import { ConflictException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import type { CopyWeekInput, PublishWeekInput, ShiftInput, ShiftUpdate } from "@restaurant/validation";
import { addDays, rangesOverlap, shiftLocalDays, weekBounds, weekDays, weekStartOf, zonedDay } from "@restaurant/utils";
import { RealtimeService } from "../realtime/realtime.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService, Tx } from "../prisma/prisma.service";
import type { Account } from "../security/accounts.repo";
import { StaffContext, StaffCtx, fullName, hhmm } from "./staff.common";
import { absenceInclude, absenceView, shiftInclude, shiftView } from "./staff.views";

const conflict = (code: string, message: string) => new HttpException({ statusCode: 409, code, message }, 409);
const weekday = (d: Date, tz: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(d);
const range = (a: Date, b: Date, tz: string) => `${hhmm(a, tz)}–${hhmm(b, tz)}`;

/** Planning hebdomadaire : créneaux, chevauchements, absences, copie de semaine, publication. */
@Injectable()
export class PlanningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: StaffContext,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
  ) {}

  private normalizeWeek(c: StaffCtx, week?: string) {
    return weekStartOf(week ?? zonedDay(new Date(), c.tz), c.firstDay);
  }

  /** Planning de l'équipe (responsables) ou « mon planning » (`onlyUserId` : créneaux publiés de cette personne). */
  async week(tenantId: string, weekParam?: string, onlyUserId?: string) {
    const c = await this.ctx.get(tenantId);
    const weekStart = this.normalizeWeek(c, weekParam);
    const { start, end } = weekBounds(weekStart, c.tz);
    return this.prisma.asTenant(tenantId, async (tx) => {
      const mine = onlyUserId ? { staff: { userId: onlyUserId } } : {};
      const [shifts, absences, staff, noProfile] = await Promise.all([
        tx.shift.findMany({
          where: { tenantId, startsAt: { lt: end }, endsAt: { gt: start }, ...mine, ...(onlyUserId ? { publishedAt: { not: null } } : {}) },
          include: shiftInclude, orderBy: [{ startsAt: "asc" }],
        }),
        tx.absence.findMany({ where: { tenantId, status: { in: ["PENDING", "APPROVED"] }, from: { lt: end }, to: { gt: start }, ...mine }, include: absenceInclude }),
        onlyUserId ? Promise.resolve([]) : tx.staffProfile.findMany({ where: { tenantId, user: { isActive: true } }, include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } }, orderBy: { user: { firstName: "asc" } } }),
        onlyUserId ? Promise.resolve(0) : tx.user.count({ where: { tenantId, isActive: true, role: { not: "CUSTOMER" }, staffProfile: null } }),
      ]);
      return {
        weekStart, weekEnd: addDays(weekStart, 6), days: weekDays(weekStart), timezone: c.tz,
        shifts: shifts.map(shiftView),
        absences: absences.map((a) => absenceView(a, c.tz, zonedDay)),
        staff: staff.map((p) => ({ staffId: p.id, userId: p.user.id, name: fullName(p.user), role: p.user.role, position: p.position })),
        draftCount: shifts.filter((s) => !s.publishedAt).length,
        missingProfiles: noProfile,
      };
    });
  }

  /** Refuse un créneau qui chevauche un autre créneau de la personne ou une de ses absences validées. */
  private async assertAvailable(tx: Tx, c: StaffCtx, tenantId: string, staffId: string, startsAt: Date, endsAt: Date, excludeId?: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`shift:${staffId}`}))`;
    const person = await tx.staffProfile.findFirst({ where: { id: staffId, tenantId, user: { isActive: true } }, include: { user: { select: { firstName: true, lastName: true } } } });
    if (!person) throw new NotFoundException("Personne introuvable ou désactivée");
    const name = fullName(person.user);
    const other = await tx.shift.findFirst({ where: { tenantId, staffId, ...(excludeId ? { id: { not: excludeId } } : {}), startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } });
    if (other) throw conflict("SHIFT_OVERLAP", `${name} a déjà un créneau de ${range(other.startsAt, other.endsAt, c.tz)} le ${weekday(other.startsAt, c.tz)}`);
    const away = await tx.absence.findFirst({ where: { tenantId, staffId, status: "APPROVED", from: { lt: endsAt }, to: { gt: startsAt } } });
    if (away) throw conflict("ABSENCE_CONFLICT", `${name} est absent·e ce jour-là (absence validée)`);
    return person;
  }

  async create(acc: Account, input: ShiftInput) {
    const tenantId = acc.tenantId!, c = await this.ctx.get(tenantId);
    return this.prisma.asTenant(tenantId, async (tx) => {
      const person = await this.assertAvailable(tx, c, tenantId, input.staffId, input.startsAt, input.endsAt);
      const s = await tx.shift.create({
        data: { tenantId, staffId: input.staffId, startsAt: input.startsAt, endsAt: input.endsAt, position: input.position ?? person.position, notes: input.notes ?? null },
        include: shiftInclude,
      });
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "staff.shift.create", entity: "Shift", entityId: s.id, metadata: { staffId: s.staffId, startsAt: s.startsAt, endsAt: s.endsAt } } });
      return shiftView(s);
    });
  }

  async update(acc: Account, id: string, patch: ShiftUpdate) {
    const tenantId = acc.tenantId!, c = await this.ctx.get(tenantId);
    return this.prisma.asTenant(tenantId, async (tx) => {
      const cur = await tx.shift.findFirst({ where: { id, tenantId } });
      if (!cur) throw new NotFoundException("Créneau introuvable");
      const staffId = patch.staffId ?? cur.staffId, startsAt = patch.startsAt ?? cur.startsAt, endsAt = patch.endsAt ?? cur.endsAt;
      if (endsAt <= startsAt) throw new ConflictException("La fin doit suivre le début");
      if (endsAt.getTime() - startsAt.getTime() > 16 * 3_600_000) throw new ConflictException("Un créneau dure 16 h au plus");
      await this.assertAvailable(tx, c, tenantId, staffId, startsAt, endsAt, id);
      const s = await tx.shift.update({
        where: { id },
        data: { staffId, startsAt, endsAt, ...(patch.position !== undefined ? { position: patch.position } : {}), ...(patch.notes !== undefined ? { notes: patch.notes } : {}) },
        include: shiftInclude,
      });
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "staff.shift.update", entity: "Shift", entityId: id, metadata: { before: { staffId: cur.staffId, startsAt: cur.startsAt, endsAt: cur.endsAt }, after: { staffId, startsAt, endsAt } } } });
      return shiftView(s);
    });
  }

  async remove(acc: Account, id: string) {
    const tenantId = acc.tenantId!;
    await this.prisma.asTenant(tenantId, async (tx) => {
      const cur = await tx.shift.findFirst({ where: { id, tenantId } });
      if (!cur) throw new NotFoundException("Créneau introuvable");
      await tx.shift.delete({ where: { id } });
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "staff.shift.delete", entity: "Shift", entityId: id, metadata: { staffId: cur.staffId, startsAt: cur.startsAt } } });
    });
    return { ok: true };
  }

  /** Copie les créneaux d'une semaine vers une autre (brouillons) ; ceux qui se heurtent à un créneau ou une absence sont ignorés. */
  async copyWeek(acc: Account, input: CopyWeekInput) {
    const tenantId = acc.tenantId!, c = await this.ctx.get(tenantId);
    const from = this.normalizeWeek(c, input.fromWeek), to = this.normalizeWeek(c, input.toWeek);
    if (from === to) throw new ConflictException("Choisissez une autre semaine que celle à copier");
    const offset = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
    const { start, end } = weekBounds(from, c.tz);
    return this.prisma.asTenant(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`shiftcopy:${tenantId}`}))`;
      const source = await tx.shift.findMany({ where: { tenantId, startsAt: { gte: start, lt: end }, staff: { user: { isActive: true } } }, orderBy: { startsAt: "asc" } });
      let copied = 0, skipped = 0;
      for (const s of source) {
        const startsAt = shiftLocalDays(s.startsAt, offset, c.tz), endsAt = shiftLocalDays(s.endsAt, offset, c.tz);
        try {
          // Un point de sauvegarde évite qu'un refus n'annule toute la transaction.
          await tx.$executeRaw`SAVEPOINT copy_shift`;
          await this.assertAvailable(tx, c, tenantId, s.staffId, startsAt, endsAt);
          await tx.shift.create({ data: { tenantId, staffId: s.staffId, startsAt, endsAt, position: s.position, notes: s.notes } });
          await tx.$executeRaw`RELEASE SAVEPOINT copy_shift`;
          copied++;
        } catch (e) {
          if (!(e instanceof HttpException)) throw e;
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT copy_shift`;
          skipped++;
        }
      }
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "staff.planning.copy", entity: "Shift", metadata: { from, to, copied, skipped } } });
      return { copied, skipped, week: to };
    });
  }

  /** Publie les créneaux en brouillon de la semaine et prévient chaque personne concernée (email / SMS X1 + temps réel). */
  async publish(acc: Account, input: PublishWeekInput) {
    const tenantId = acc.tenantId!, c = await this.ctx.get(tenantId);
    const week = this.normalizeWeek(c, input.week);
    const { start, end } = weekBounds(week, c.tz);
    const now = new Date();
    const drafts = await this.prisma.asTenant(tenantId, async (tx) => {
      const rows = await tx.shift.findMany({
        where: { tenantId, publishedAt: null, startsAt: { gte: start, lt: end }, staff: { user: { isActive: true } } },
        include: { staff: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } } } }, orderBy: { startsAt: "asc" },
      });
      if (rows.length) {
        await tx.shift.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { publishedAt: now } });
        await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "staff.planning.publish", entity: "Shift", metadata: { week, count: rows.length } } });
      }
      return rows;
    });
    const byUser = new Map<string, typeof drafts>();
    for (const s of drafts) byUser.set(s.staff.user.id, [...(byUser.get(s.staff.user.id) ?? []), s]);
    const weekLabel = `du ${weekday(start, c.tz)} au ${weekday(new Date(end.getTime() - 1), c.tz)}`;
    let notified = 0;
    for (const shifts of byUser.values()) {
      const u = shifts[0].staff.user;
      const data = { firstName: u.firstName, weekLabel, lines: shifts.map((s) => `${weekday(s.startsAt, c.tz)} · ${range(s.startsAt, s.endsAt, c.tz)}${s.position ? ` · ${s.position}` : ""}`) };
      const results = await Promise.all([
        this.notifications.send({ channel: "EMAIL", to: u.email, template: "staff.planning-published", data, tenantId }),
        u.phone ? this.notifications.send({ channel: "SMS", to: u.phone, template: "staff.planning-published", data, tenantId }) : Promise.resolve(null),
      ]);
      if (results.some((r) => r?.status === "queued")) notified++;
    }
    this.realtime.emitToUsers(tenantId, [...byUser.keys()], "planning.published", { week });
    return { published: drafts.length, people: byUser.size, notified, week };
  }
}
