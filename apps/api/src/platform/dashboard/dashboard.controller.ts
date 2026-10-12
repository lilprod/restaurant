import { Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../../prisma/prisma.service";
import { PlatformAuthGuard, PlatformRoles } from "../auth/platform-auth.guard";
import { LicensingService } from "../licensing/licensing.service";

@ApiTags("Plateforme · Tableau de bord")
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard)
@Controller("platform")
export class DashboardController {
  constructor(private readonly prisma: PrismaService, private readonly licensing: LicensingService) {}

  @Get("dashboard")
  async dashboard() {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [byStatus, pendingRegistrations, revenueByMethod, expiringSoon] = await Promise.all([
      this.prisma.tenant.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.tenantRegistration.count({ where: { status: "PENDING" } }),
      this.prisma.subscriptionPayment.groupBy({
        by: ["method"], where: { status: "RECORDED", paidAt: { gte: monthStart } }, _sum: { amount: true }, _count: { _all: true },
      }),
      this.licensing.expiringSoon(7, now),
    ]);
    const tenants = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all]));
    return {
      tenants,
      pendingRegistrations,
      revenueThisMonth: {
        total: revenueByMethod.reduce((n, r) => n + (r._sum.amount ?? 0), 0),
        byMethod: revenueByMethod.map((r) => ({ method: r.method, amount: r._sum.amount ?? 0, count: r._count._all })),
      },
      expiringSoon: expiringSoon.map((s) => ({
        tenant: s.tenant, plan: s.plan, status: s.status, currentPeriodEnd: s.currentPeriodEnd,
      })),
    };
  }

  @Post("licensing/sweep") @HttpCode(200) @PlatformRoles("SUPER_ADMIN")
  sweep() { return this.licensing.sweep(); }
}
