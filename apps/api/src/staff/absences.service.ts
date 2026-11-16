import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AbsenceDecisionInput, AbsenceInput } from "@restaurant/validation";
import { daysInRange, zonedDay, zonedDayRange } from "@restaurant/utils";
import { PrismaService, Tx } from "../prisma/prisma.service";
import type { Account } from "../security/accounts.repo";
import { isManager } from "../restaurant/common";
import { StaffContext, StaffCtx } from "./staff.common";
import { absenceInclude, absenceView } from "./staff.views";

/** Demandes d'absence et de congés, validation, solde de congés payés (jours calendaires). */
@Injectable()
export class AbsencesService {
  constructor(private readonly prisma: PrismaService, private readonly ctx: StaffContext) {}

  async list(acc: Account, q: { status?: "PENDING" | "APPROVED" | "REJECTED"; mine?: string }) {
    const tenantId = acc.tenantId!, c = await this.ctx.get(tenantId);
    const onlyMine = !isManager(acc) || q.mine === "true";
    const rows = await this.prisma.asTenant(tenantId, (tx) => tx.absence.findMany({
      where: { tenantId, ...(q.status ? { status: q.status } : {}), ...(onlyMine ? { staff: { userId: acc.id } } : {}) },
      include: absenceInclude, orderBy: [{ status: "asc" }, { from: "desc" }], take: 300,
    }));
    return rows.map((a) => absenceView(a, c.tz, zonedDay));
  }

  /** Jours de congés payés pris (validés) et en attente sur une année civile du restaurant. */
  private async usedDays(tx: Tx, c: StaffCtx, tenantId: string, staffId: string, year: number, excludeId?: string) {
    const rows = await tx.absence.findMany({
      where: { tenantId, staffId, type: "PAID_LEAVE", status: { in: ["PENDING", "APPROVED"] }, ...(excludeId ? { id: { not: excludeId } } : {}), from: { lt: zonedDayRange(`${year + 1}-01-01`, c.tz).start }, to: { gt: zonedDayRange(`${year}-01-01`, c.tz).start } },
    });
    let approved = 0, pending = 0;
    for (const a of rows) {
      const days = daysInRange(zonedDay(a.from, c.tz), zonedDay(new Date(a.to.getTime() - 1), c.tz)).filter((d) => d.startsWith(`${year}-`)).length;
      if (a.status === "APPROVED") approved += days; else pending += days;
    }
    return { approved, pending };
  }

  async balance(acc: Account, staffUserId?: string, yearParam?: number) {
    const tenantId = acc.tenantId!, c = await this.ctx.get(tenantId);
    const userId = staffUserId && isManager(acc) ? staffUserId : acc.id;
    const year = yearParam ?? Number(zonedDay(new Date(), c.tz).slice(0, 4));
    return this.prisma.asTenant(tenantId, async (tx) => {
      const p = await tx.staffProfile.findFirst({ where: { tenantId, userId } });
      if (!p) throw new NotFoundException("Fiche personnel introuvable");
      const { approved, pending } = await this.usedDays(tx, c, tenantId, p.id, year);
      return { year, allowance: c.leaveDaysPerYear, taken: approved, pending, remaining: Math.max(0, c.leaveDaysPerYear - approved - pending) };
    });
  }

  private async assertBalance(tx: Tx, c: StaffCtx, tenantId: string, staffId: string, days: string[], excludeId?: string) {
    for (const year of new Set(days.map((d) => Number(d.slice(0, 4))))) {
      const { approved, pending } = await this.usedDays(tx, c, tenantId, staffId, year, excludeId);
      const asked = days.filter((d) => d.startsWith(`${year}-`)).length;
      const left = c.leaveDaysPerYear - approved - pending;
      if (asked > left) throw new ConflictException(`Solde de congés insuffisant en ${year} : ${Math.max(0, left)} jour${left > 1 ? "s" : ""} disponible${left > 1 ? "s" : ""}, ${asked} demandé${asked > 1 ? "s" : ""}`);
    }
  }

  async create(acc: Account, input: AbsenceInput) {
    const tenantId = acc.tenantId!, c = await this.ctx.get(tenantId);
    const forOther = !!input.staffId && isManager(acc);
    if (input.staffId && !isManager(acc)) throw new ForbiddenException("Vous ne pouvez demander une absence que pour vous-même");
    return this.prisma.asTenant(tenantId, async (tx) => {
      const p = forOther
        ? await tx.staffProfile.findFirst({ where: { id: input.staffId, tenantId } })
        : await tx.staffProfile.findFirst({ where: { tenantId, userId: acc.id } });
      if (!p) throw forOther ? new NotFoundException("Personne introuvable") : new ConflictException("Votre fiche personnel n'est pas encore créée : demandez à un responsable");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`absence:${p.id}`}))`;
      const from = zonedDayRange(input.from, c.tz).start, to = zonedDayRange(input.to, c.tz).end;
      const clash = await tx.absence.findFirst({ where: { tenantId, staffId: p.id, status: { in: ["PENDING", "APPROVED"] }, from: { lt: to }, to: { gt: from } } });
      if (clash) throw new ConflictException("Une absence existe déjà sur cette période");
      if (input.type === "PAID_LEAVE") await this.assertBalance(tx, c, tenantId, p.id, daysInRange(input.from, input.to));
      const a = await tx.absence.create({
        data: { tenantId, staffId: p.id, type: input.type, from, to, reason: input.reason ?? null, ...(forOther ? { status: "APPROVED" as const, decidedById: acc.id, decidedAt: new Date() } : {}) },
        include: absenceInclude,
      });
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: forOther ? "staff.absence.record" : "staff.absence.request", entity: "Absence", entityId: a.id, metadata: { type: a.type, from: input.from, to: input.to } } });
      return absenceView(a, c.tz, zonedDay);
    });
  }

  async decide(acc: Account, id: string, input: AbsenceDecisionInput) {
    const tenantId = acc.tenantId!, c = await this.ctx.get(tenantId);
    return this.prisma.asTenant(tenantId, async (tx) => {
      const a = await tx.absence.findFirst({ where: { id, tenantId }, include: absenceInclude });
      if (!a) throw new NotFoundException("Demande introuvable");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`absence:${a.staffId}`}))`;
      if (a.status !== "PENDING") throw new ConflictException("Cette demande a déjà été traitée");
      if (a.staff.userId === acc.id) throw new ForbiddenException("Vous ne pouvez pas valider votre propre demande");
      if (input.decision === "APPROVED" && a.type === "PAID_LEAVE") {
        await this.assertBalance(tx, c, tenantId, a.staffId, daysInRange(zonedDay(a.from, c.tz), zonedDay(new Date(a.to.getTime() - 1), c.tz)), id);
      }
      const u = await tx.absence.update({ where: { id }, data: { status: input.decision, decidedById: acc.id, decidedAt: new Date(), decisionNote: input.note ?? null }, include: absenceInclude });
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: `staff.absence.${input.decision === "APPROVED" ? "approve" : "reject"}`, entity: "Absence", entityId: id, metadata: { note: input.note } } });
      return absenceView(u, c.tz, zonedDay);
    });
  }

  /** Annulation : la personne retire sa demande en attente ; un responsable peut supprimer toute absence. */
  async cancel(acc: Account, id: string) {
    const tenantId = acc.tenantId!;
    await this.prisma.asTenant(tenantId, async (tx) => {
      const a = await tx.absence.findFirst({ where: { id, tenantId }, include: { staff: true } });
      if (!a || (!isManager(acc) && a.staff.userId !== acc.id)) throw new NotFoundException("Demande introuvable");
      if (!isManager(acc) && a.status !== "PENDING") throw new ConflictException("Seule une demande en attente peut être retirée");
      await tx.absence.delete({ where: { id } });
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "staff.absence.cancel", entity: "Absence", entityId: id, metadata: { status: a.status } } });
    });
    return { ok: true };
  }
}
