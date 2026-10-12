import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../prisma/prisma.service";
import { Account } from "../security/accounts.repo";
import { CurrentAccount } from "../security/space-auth.guard";
import { PlatformSettingsService } from "../settings/platform-settings.service";
import { TenantAuthGuard, TenantRoles } from "./tenant-auth.guard";

/** Le restaurant consulte sa licence et sait comment la régler (Flooz, TMoney, banque, espèces). */
@ApiTags("Restaurant · Licence")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles("ADMIN", "MANAGER")
@Controller("tenant/license")
export class TenantLicenseController {
  constructor(private readonly prisma: PrismaService, private readonly platform: PlatformSettingsService) {}

  @Get()
  async license(@CurrentAccount() acc: Account) {
    const tenantId = acc.tenantId!;
    const [sub, payments, instructions, branding] = await Promise.all([
      this.prisma.subscription.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" }, include: { plan: true } }),
      this.prisma.subscriptionPayment.findMany({
        where: { tenantId, status: "RECORDED" }, orderBy: { paidAt: "desc" }, take: 12,
        select: { id: true, receiptNumber: true, amount: true, currency: true, method: true, paidAt: true, periodStart: true, periodEnd: true },
      }),
      this.platform.paymentInstructions(),
      this.platform.publicBranding(),
    ]);
    const now = Date.now();
    return {
      status: sub?.status ?? null,
      plan: sub && { code: sub.plan.code, name: sub.plan.name, priceMonthly: sub.plan.priceMonthly, priceYearly: sub.plan.priceYearly, maxUsers: sub.plan.maxUsers, maxTables: sub.plan.maxTables, features: sub.plan.features },
      billingCycle: sub?.billingCycle ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      graceEndsAt: sub?.graceEndsAt ?? null,
      daysLeft: sub ? Math.ceil((sub.currentPeriodEnd.getTime() - now) / 86_400_000) : null,
      payments,
      howToPay: instructions,
      support: branding.support,
    };
  }
}
