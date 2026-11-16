import { Injectable } from "@nestjs/common";
import type { PeriodQuery } from "@restaurant/validation";
import { computeHours, grossPay, weekBounds, weekStartOf, zonedDayRange } from "@restaurant/utils";
import { PrismaService } from "../prisma/prisma.service";
import { StaffContext, fullName } from "./staff.common";

/** Performances par serveur (commandes, encaissements, pourboires) et récapitulatif de paie (heures, brut estimé). */
@Injectable()
export class StaffReportsService {
  constructor(private readonly prisma: PrismaService, private readonly ctx: StaffContext) {}

  /**
   * Mêmes définitions que le tableau de bord : commandes = non annulées créées sur la période, encaissé = paiements `PAID` (par date de paiement),
   * ticket moyen = total des commandes ÷ nombre de commandes. Les pourboires restent par serveur, sans répartition automatique.
   */
  async performance(tenantId: string, q: PeriodQuery) {
    const c = await this.ctx.get(tenantId);
    const start = zonedDayRange(q.from, c.tz).start, end = zonedDayRange(q.to, c.tz).end;
    return this.prisma.asTenant(tenantId, async (tx) => {
      const [users, orders, cancelled, payments] = await Promise.all([
        tx.user.findMany({ where: { tenantId, role: { not: "CUSTOMER" } }, select: { id: true, firstName: true, lastName: true, role: true, isActive: true } }),
        tx.order.groupBy({ by: ["waiterId"], where: { tenantId, createdAt: { gte: start, lt: end }, cancelledAt: null }, _count: { _all: true }, _sum: { total: true } }),
        tx.order.groupBy({ by: ["waiterId"], where: { tenantId, cancelledAt: { gte: start, lt: end } }, _count: { _all: true } }),
        tx.payment.findMany({ where: { tenantId, status: "PAID", paidAt: { gte: start, lt: end } }, select: { amount: true, tip: true, order: { select: { waiterId: true } } } }),
      ]);
      const rows = new Map<string | null, { orders: number; orderTotal: number; revenue: number; tips: number; cancellations: number }>();
      const row = (id: string | null) => rows.get(id) ?? rows.set(id, { orders: 0, orderTotal: 0, revenue: 0, tips: 0, cancellations: 0 }).get(id)!;
      for (const o of orders) { const r = row(o.waiterId); r.orders = o._count._all; r.orderTotal = o._sum.total ?? 0; }
      for (const o of cancelled) row(o.waiterId).cancellations = o._count._all;
      for (const p of payments) { const r = row(p.order.waiterId); r.revenue += p.amount; r.tips += p.tip; }
      const view = (r: ReturnType<typeof row>) => ({ orders: r.orders, revenue: r.revenue, tips: r.tips, cancellations: r.cancellations, averageTicket: r.orders ? Math.round(r.orderTotal / r.orders) : 0 });
      const byUser = new Map(users.map((u) => [u.id, u]));
      const waiters = [...rows.entries()].filter(([id]) => id !== null).map(([id, r]) => ({ userId: id as string, name: fullName(byUser.get(id!) ?? { firstName: "Ancien", lastName: "membre" }), role: byUser.get(id!)?.role ?? null, ...view(r) }));
      // Les serveurs actifs sans commande figurent aussi au classement (à zéro).
      for (const u of users) if (u.role === "WAITER" && u.isActive && !rows.has(u.id)) waiters.push({ userId: u.id, name: fullName(u), role: u.role, ...view(row(u.id)) });
      waiters.sort((a, b) => b.revenue - a.revenue || b.orders - a.orders || a.name.localeCompare(b.name, "fr"));
      const all = [...rows.values()];
      const sum = (f: (r: (typeof all)[number]) => number) => all.reduce((n, r) => n + f(r), 0);
      const totalOrders = sum((r) => r.orders);
      return {
        from: q.from, to: q.to,
        rows: waiters.map((w, i) => ({ rank: i + 1, ...w })),
        unassigned: rows.has(null) ? view(row(null)) : null,
        totals: { orders: totalOrders, revenue: sum((r) => r.revenue), tips: sum((r) => r.tips), cancellations: sum((r) => r.cancellations), averageTicket: totalOrders ? Math.round(sum((r) => r.orderTotal) / totalOrders) : 0 },
      };
    });
  }

  /** Heures normales / supplémentaires et brut estimé par personne (pas de bulletin de paie). */
  async payroll(tenantId: string, q: PeriodQuery) {
    const c = await this.ctx.get(tenantId);
    const from = zonedDayRange(q.from, c.tz).start, to = zonedDayRange(q.to, c.tz).end;
    // On charge depuis le début de la première semaine : le cumul hebdomadaire en dépend.
    const loadFrom = weekBounds(weekStartOf(q.from, c.firstDay), c.tz).start;
    const profiles = await this.prisma.asTenant(tenantId, (tx) => tx.staffProfile.findMany({
      where: { tenantId, OR: [{ user: { isActive: true } }, { attendances: { some: { clockIn: { lt: to }, clockOut: { gt: from } } } }] },
      include: {
        user: { select: { firstName: true, lastName: true } },
        // Un pointage commencé avant la semaine mais qui la déborde compte aussi (nuit du dimanche au lundi).
        attendances: { where: { clockIn: { lt: to }, OR: [{ clockOut: null }, { clockOut: { gt: loadFrom } }] }, orderBy: { clockIn: "asc" } },
      },
      orderBy: { user: { firstName: "asc" } },
    }));
    const rows = profiles.map((p) => {
      const h = computeHours(p.attendances, { from, to }, c.tz, c.thresholdMinutes, c.firstDay);
      const multiplier = Number(p.overtimeMultiplier);
      return {
        staffId: p.id, name: fullName(p.user), position: p.position, hourlyRate: p.hourlyRate, overtimeMultiplier: multiplier,
        normalMinutes: h.normalMinutes, overtimeMinutes: h.overtimeMinutes, totalMinutes: h.normalMinutes + h.overtimeMinutes,
        gross: grossPay(h.normalMinutes, h.overtimeMinutes, p.hourlyRate, multiplier),
        openAttendances: p.attendances.filter((a) => !a.clockOut && a.clockIn >= from).length,
      };
    }).filter((r) => r.totalMinutes > 0 || r.openAttendances > 0);
    return {
      from: q.from, to: q.to, thresholdHours: c.thresholdMinutes / 60, rows,
      totals: { normalMinutes: rows.reduce((n, r) => n + r.normalMinutes, 0), overtimeMinutes: rows.reduce((n, r) => n + r.overtimeMinutes, 0), gross: rows.reduce((n, r) => n + r.gross, 0) },
    };
  }

  /** Export CSV (séparateur « ; », virgule décimale, BOM : s'ouvre directement dans Excel). */
  async payrollCsv(tenantId: string, q: PeriodQuery) {
    const r = await this.payroll(tenantId, q);
    const h = (m: number) => (m / 60).toFixed(2).replace(".", ",");
    // Neutralise l'injection de formule dans un tableur.
    const cell = (v: string | number) => {
      const s = String(v);
      return /^[=+\-@\t\r]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ["Nom", "Poste", "Heures normales", "Heures supplémentaires", "Total heures", "Taux horaire (FCFA)", "Majoration heures sup.", "Brut estimé (FCFA)"],
      ...r.rows.map((x) => [x.name, x.position, h(x.normalMinutes), h(x.overtimeMinutes), h(x.totalMinutes), x.hourlyRate, String(x.overtimeMultiplier).replace(".", ","), x.gross]),
      ["Total", "", h(r.totals.normalMinutes), h(r.totals.overtimeMinutes), h(r.totals.normalMinutes + r.totals.overtimeMinutes), "", "", r.totals.gross],
    ];
    return `﻿${lines.map((l) => l.map(cell).join(";")).join("\r\n")}\r\n`;
  }
}
