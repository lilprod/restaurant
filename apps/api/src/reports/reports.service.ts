import { Injectable } from "@nestjs/common";
import type { ReportPeriodQuery } from "@restaurant/validation";
import { dishMargin } from "@restaurant/utils";
import { reviewSummary } from "../customers/review-stats";
import { RecipesService } from "../inventory/recipes.service";
import { PrismaService } from "../prisma/prisma.service";
import { TenantSettingsService } from "../settings/tenant-settings.service";
import { StaffReportsService } from "../staff/reports.service";
import { fullName } from "../staff/staff.common";
import { previousPeriod, rangeOf } from "./period";
import { daily, grid, itemRows, summary, vatByRate } from "./sales.queries";

const sumBy = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((n, r) => n + f(r), 0);

/** Rapports du restaurant (module `reports` du plan). Les chiffres reprennent les définitions du tableau de bord (voir `sales.queries.ts`). */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService, private readonly settings: TenantSettingsService,
    private readonly recipes: RecipesService, private readonly staff: StaffReportsService,
  ) {}

  private async ctx(tenantId: string) {
    const t = await this.settings.tenant(tenantId);
    const ops = await this.settings.getSection("operations", t);
    return { tz: t.timezone as string, defaultVatRate: (ops?.defaultVatRate ?? 18) as number, tenant: t };
  }

  // ── Ventes ──

  async sales(tenantId: string, p: ReportPeriodQuery) {
    const { tz } = await this.ctx(tenantId);
    const prev = previousPeriod(p.from, p.to);
    const r = rangeOf(p, tz), pr = rangeOf(prev, tz);
    return this.prisma.asTenant(tenantId, async (tx) => {
      const [current, previous, items, cells, days, payments, types, waiters] = await Promise.all([
        summary(tx, tenantId, r), summary(tx, tenantId, pr), itemRows(tx, tenantId, r), grid(tx, tenantId, r, tz), daily(tx, tenantId, r, tz),
        tx.payment.groupBy({ by: ["method"], where: { tenantId, status: "PAID", paidAt: { gte: r.start, lt: r.end } }, _sum: { amount: true, tip: true }, _count: { _all: true } }),
        tx.order.groupBy({ by: ["type"], where: { tenantId, createdAt: { gte: r.start, lt: r.end }, cancelledAt: null }, _count: { _all: true }, _sum: { total: true } }),
        tx.order.groupBy({ by: ["waiterId"], where: { tenantId, createdAt: { gte: r.start, lt: r.end }, cancelledAt: null }, _count: { _all: true }, _sum: { total: true } }),
      ]);
      const users = await tx.user.findMany({ where: { tenantId, id: { in: waiters.map((w) => w.waiterId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } });
      const names = new Map(users.map((u) => [u.id, fullName(u)]));

      const cats = new Map<string, { categoryId: string | null; name: string; quantity: number; amount: number }>();
      for (const i of items) {
        const k = i.categoryId ?? "formulas";
        const c = cats.get(k) ?? cats.set(k, { categoryId: i.categoryId, name: i.category, quantity: 0, amount: 0 }).get(k)!;
        c.quantity += i.quantity; c.amount += i.amount;
      }
      const byItem = new Map<string, { menuItemId: string | null; name: string; category: string; quantity: number; amount: number }>();
      for (const i of items) {
        const k = `${i.menuItemId ?? "f"}|${i.name}`;
        const x = byItem.get(k) ?? byItem.set(k, { menuItemId: i.menuItemId, name: i.name, category: i.category, quantity: 0, amount: 0 }).get(k)!;
        x.quantity += i.quantity; x.amount += i.amount;
      }
      const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, total: 0 }));
      const weekdays = Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, orders: 0, total: 0 }));
      for (const c of cells) { hours[c.hour].orders += c.orders; hours[c.hour].total += c.total; weekdays[c.weekday - 1].orders += c.orders; weekdays[c.weekday - 1].total += c.total; }

      return {
        from: p.from, to: p.to, timezone: tz,
        summary: current,
        previous: { ...prev, summary: previous },
        byCategory: [...cats.values()].sort((a, b) => b.amount - a.amount),
        byItem: [...byItem.values()].sort((a, b) => b.quantity - a.quantity || b.amount - a.amount),
        byHour: hours,
        byWeekday: weekdays,
        byDay: days,
        byWaiter: waiters
          .map((w) => ({ userId: w.waiterId, name: w.waiterId ? names.get(w.waiterId) ?? "Ancien membre" : "Sans serveur", orders: w._count._all, total: w._sum.total ?? 0 }))
          .sort((a, b) => b.total - a.total),
        byMethod: payments.map((m) => ({ method: m.method, amount: m._sum.amount ?? 0, tips: m._sum.tip ?? 0, count: m._count._all })).sort((a, b) => b.amount - a.amount || a.method.localeCompare(b.method)),
        byType: types.map((t) => ({ type: t.type, orders: t._count._all, total: t._sum.total ?? 0 })),
      };
    });
  }

  // ── TVA ──

  async vat(tenantId: string, p: ReportPeriodQuery) {
    const { tz, defaultVatRate } = await this.ctx(tenantId);
    const data = await this.prisma.asTenant(tenantId, (tx) => vatByRate(tx, tenantId, rangeOf(p, tz), defaultVatRate));
    return { from: p.from, to: p.to, basis: "Commandes non annulées créées dans la période, TVA incluse dans les prix TTC", ...data };
  }

  // ── Caisse ──

  async register(tenantId: string, p: ReportPeriodQuery) {
    const { tz } = await this.ctx(tenantId);
    const r = rangeOf(p, tz);
    return this.prisma.asTenant(tenantId, async (tx) => {
      const sessions = await tx.registerSession.findMany({ where: { tenantId, openedAt: { gte: r.start, lt: r.end } }, orderBy: { openedAt: "asc" } });
      const ids = sessions.map((s) => s.id);
      const [pay, users] = await Promise.all([
        tx.payment.groupBy({ by: ["registerSessionId", "method"], where: { tenantId, status: "PAID", registerSessionId: { in: ids } }, _sum: { amount: true } }),
        tx.user.findMany({ where: { tenantId, id: { in: [...new Set(sessions.flatMap((s) => [s.openedById, s.closedById].filter((x): x is string => !!x)))] } }, select: { id: true, firstName: true, lastName: true } }),
      ]);
      const names = new Map(users.map((u) => [u.id, fullName(u)]));
      const rows = sessions.map((s) => {
        const mine = pay.filter((x) => x.registerSessionId === s.id);
        return {
          id: s.id, openedAt: s.openedAt, closedAt: s.closedAt, openedBy: names.get(s.openedById) ?? "Ancien membre",
          closedBy: s.closedById ? names.get(s.closedById) ?? "Ancien membre" : null,
          opening: s.opening, expectedCash: s.expectedCash, closing: s.closing, difference: s.difference,
          payments: sumBy(mine, (x) => x._sum.amount ?? 0), cash: sumBy(mine.filter((x) => x.method === "CASH"), (x) => x._sum.amount ?? 0),
        };
      });
      const closed = rows.filter((x) => x.closedAt);
      return {
        from: p.from, to: p.to, timezone: tz, rows,
        totals: {
          sessions: rows.length, open: rows.length - closed.length, payments: sumBy(rows, (x) => x.payments),
          difference: sumBy(closed, (x) => x.difference ?? 0), withGap: closed.filter((x) => (x.difference ?? 0) !== 0).length,
          shortfall: sumBy(closed, (x) => Math.min(x.difference ?? 0, 0)), surplus: sumBy(closed, (x) => Math.max(x.difference ?? 0, 0)),
        },
      };
    });
  }

  // ── Coût matière et marges (P3) ──

  /** Marge réalisée par plat vendu : `dishMargin(CA TTC, taux, coût unitaire actuel × quantité)`. Coût = fiche technique d'aujourd'hui. */
  async margins(tenantId: string, p: ReportPeriodQuery) {
    const { tz } = await this.ctx(tenantId);
    const [items, costs] = await Promise.all([
      this.prisma.asTenant(tenantId, (tx) => itemRows(tx, tenantId, rangeOf(p, tz))),
      this.recipes.dishCosts(tenantId),
    ]);
    const unit = new Map(costs.map((c) => [c.menuItemId, c]));
    const merged = new Map<string, { menuItemId: string; name: string; category: string; vatRate: number; quantity: number; amount: number }>();
    let uncosted = { items: 0, revenue: 0 };
    for (const i of items) {
      const c = i.menuItemId ? unit.get(i.menuItemId) : undefined;
      if (!i.menuItemId || !c?.hasRecipe) { uncosted = { items: uncosted.items + i.quantity, revenue: uncosted.revenue + i.amount }; if (!i.menuItemId) continue; }
      const k = `${i.menuItemId}|${i.vatRate}`;
      const x = merged.get(k) ?? merged.set(k, { menuItemId: i.menuItemId, name: c?.name ?? i.name, category: i.category, vatRate: i.vatRate, quantity: 0, amount: 0 }).get(k)!;
      x.quantity += i.quantity; x.amount += i.amount;
    }
    const rows = [...merged.values()].map((x) => {
      const c = unit.get(x.menuItemId);
      const unitCost = c?.hasRecipe ? c.cost : 0;
      const m = dishMargin(x.amount, x.vatRate, unitCost * x.quantity);
      return { ...x, hasRecipe: !!c?.hasRecipe, unitCost, revenueNet: m.net, cost: m.cost, margin: m.margin, marginRate: c?.hasRecipe ? m.marginRate : null };
    }).sort((a, b) => b.margin - a.margin);
    const costed = rows.filter((r) => r.hasRecipe);
    const net = sumBy(costed, (r) => r.revenueNet), margin = sumBy(costed, (r) => r.margin);
    return {
      from: p.from, to: p.to, rows,
      totals: { revenue: sumBy(costed, (r) => r.amount), revenueNet: net, cost: sumBy(costed, (r) => r.cost), margin, marginRate: net > 0 ? Math.round((margin / net) * 1000) / 10 : null },
      uncosted,
    };
  }

  // ── Pertes valorisées ──

  async waste(tenantId: string, p: ReportPeriodQuery) {
    const { tz } = await this.ctx(tenantId);
    const r = rangeOf(p, tz);
    return this.prisma.asTenant(tenantId, async (tx) => {
      const where = { tenantId, createdAt: { gte: r.start, lt: r.end } };
      const [byReason, byIngredient] = await Promise.all([
        tx.wasteRecord.groupBy({ by: ["reason"], where, _sum: { cost: true }, _count: { _all: true } }),
        tx.wasteRecord.groupBy({ by: ["ingredientId"], where, _sum: { cost: true, quantity: true }, _count: { _all: true } }),
      ]);
      const ings = await tx.ingredient.findMany({ where: { tenantId, id: { in: byIngredient.map((i) => i.ingredientId) } }, select: { id: true, name: true, unit: true } });
      const meta = new Map(ings.map((i) => [i.id, i]));
      const ingredients = byIngredient.map((i) => ({
        ingredientId: i.ingredientId, name: meta.get(i.ingredientId)?.name ?? "Ingrédient supprimé", unit: meta.get(i.ingredientId)?.unit ?? "",
        quantity: Number(i._sum.quantity ?? 0), cost: i._sum.cost ?? 0, count: i._count._all,
      })).sort((a, b) => b.cost - a.cost);
      const reasons = byReason.map((x) => ({ reason: x.reason, cost: x._sum.cost ?? 0, count: x._count._all })).sort((a, b) => b.cost - a.cost);
      return { from: p.from, to: p.to, ingredients, reasons, totals: { cost: sumBy(reasons, (x) => x.cost), count: sumBy(reasons, (x) => x.count) } };
    });
  }

  // ── Personnel (P4) ──

  staffPerformance(tenantId: string, p: ReportPeriodQuery) {
    return this.staff.performance(tenantId, { from: p.from, to: p.to });
  }

  // ── Avis (P2C) ──

  async reviews(tenantId: string, p: ReportPeriodQuery) {
    const { tz } = await this.ctx(tenantId);
    const prev = previousPeriod(p.from, p.to);
    const r = rangeOf(p, tz);
    return this.prisma.asTenant(tenantId, async (tx) => {
      const [current, previous, hidden, recent] = await Promise.all([
        reviewSummary(tx, tenantId, false, r), reviewSummary(tx, tenantId, false, rangeOf(prev, tz)),
        tx.feedback.count({ where: { tenantId, hiddenAt: { not: null }, createdAt: { gte: r.start, lt: r.end } } }),
        tx.feedback.findMany({
          where: { tenantId, createdAt: { gte: r.start, lt: r.end } }, orderBy: { createdAt: "desc" }, take: 20,
          select: { id: true, rating: true, comment: true, authorName: true, hiddenAt: true, createdAt: true, order: { select: { number: true } } },
        }),
      ]);
      return {
        from: p.from, to: p.to, summary: current, previous: { ...prev, summary: previous }, hidden,
        recent: recent.map((f) => ({ id: f.id, orderNumber: f.order.number, rating: f.rating, comment: f.comment, authorName: f.authorName, hidden: !!f.hiddenAt, createdAt: f.createdAt })),
      };
    });
  }

  // ── Heures de pointe ──

  async peakHours(tenantId: string, p: ReportPeriodQuery) {
    const { tz } = await this.ctx(tenantId);
    const cells = await this.prisma.asTenant(tenantId, (tx) => grid(tx, tenantId, rangeOf(p, tz), tz));
    const max = cells.reduce((m, c) => Math.max(m, c.orders), 0);
    const top = [...cells].sort((a, b) => b.orders - a.orders || b.total - a.total).slice(0, 5);
    return { from: p.from, to: p.to, timezone: tz, cells, max, top, totalOrders: sumBy(cells, (c) => c.orders) };
  }
}
