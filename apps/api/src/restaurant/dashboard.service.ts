import { Injectable } from "@nestjs/common";
import { zonedDay, zonedDayRange, zonedHour } from "@restaurant/utils";
import { PrismaService } from "../prisma/prisma.service";

/** Tableau de bord du jour (dans le fuseau du restaurant). */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async today(tenantId: string, day?: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const date = day ?? zonedDay(new Date(), tenant.timezone);
    const { start, end } = zonedDayRange(date, tenant.timezone);
    return this.prisma.asTenant(tenantId, async (tx) => {
      const [payments, orders, openOrders, items] = await Promise.all([
        tx.payment.findMany({ where: { tenantId, status: "PAID", paidAt: { gte: start, lt: end } }, select: { method: true, amount: true, tip: true } }),
        tx.order.findMany({ where: { tenantId, createdAt: { gte: start, lt: end }, cancelledAt: null }, select: { total: true, createdAt: true, type: true } }),
        tx.order.count({ where: { tenantId, closedAt: null, cancelledAt: null } }),
        tx.orderItem.groupBy({
          by: ["menuItemId", "name"], where: { tenantId, status: { not: "CANCELLED" }, createdAt: { gte: start, lt: end } },
          _sum: { quantity: true, lineTotal: true }, orderBy: { _sum: { quantity: "desc" } }, take: 5,
        }),
      ]);
      const revenue = payments.reduce((n, p) => n + p.amount, 0);
      const byMethod: Record<string, number> = {};
      for (const p of payments) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
      const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0 }));
      for (const o of orders) byHour[zonedHour(o.createdAt, tenant.timezone)].orders++;
      return {
        date,
        revenue,
        tips: payments.reduce((n, p) => n + p.tip, 0),
        ordersCount: orders.length,
        averageTicket: orders.length ? Math.round(orders.reduce((n, o) => n + o.total, 0) / orders.length) : 0,
        openOrders,
        byType: { DINE_IN: orders.filter((o) => o.type === "DINE_IN").length, TAKEAWAY: orders.filter((o) => o.type === "TAKEAWAY").length },
        byMethod: Object.entries(byMethod).map(([method, amount]) => ({ method, amount })),
        byHour,
        topItems: items.map((i) => ({ menuItemId: i.menuItemId, name: i.name, quantity: i._sum.quantity ?? 0, revenue: i._sum.lineTotal ?? 0 })),
      };
    });
  }
}
