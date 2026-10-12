import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { APP_ENV, Env } from "../../config/env";
import { PrismaService } from "../../prisma/prisma.service";
import { PlatformAuditService } from "../audit/platform-audit.service";
import { evaluateLicense, tenantStatusFor } from "./licensing";

@Injectable()
export class LicensingService {
  private readonly log = new Logger(LicensingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async scheduledSweep() {
    if (this.env.DISABLE_CRON) return;
    const r = await this.sweep();
    if (r.changed) this.log.log(`Licences mises à jour : ${r.changed}`);
  }

  /**
   * Fait avancer les licences échues : ACTIVE/TRIALING → GRACE → EXPIRED, et suspend le tenant à
   * l'expiration. Idempotent ; peut être déclenché à la main par le SuperAdmin.
   */
  async sweep(now = new Date()) {
    const due = await this.prisma.subscription.findMany({
      where: {
        OR: [
          { status: { in: ["TRIALING", "ACTIVE"] }, currentPeriodEnd: { lt: now } },
          { status: "GRACE", graceEndsAt: { lt: now } },
        ],
      },
      include: { tenant: { select: { id: true, status: true } } },
    });

    let changed = 0;
    for (const sub of due) {
      const next = evaluateLicense(sub, now);
      if (next.status === sub.status) continue;
      await this.prisma.asPlatform(async (tx) => {
        await tx.subscription.update({ where: { id: sub.id }, data: { status: next.status, graceEndsAt: next.graceEndsAt } });
        // Une licence périmée ne doit jamais toucher un tenant déjà résilié ou suspendu à la main.
        const tenantStatus = tenantStatusFor(next.status, sub.tenant.status);
        if (tenantStatus !== sub.tenant.status && sub.tenant.status !== "CANCELLED" && !(sub.tenant.status === "SUSPENDED")) {
          await tx.tenant.update({ where: { id: sub.tenantId }, data: { status: tenantStatus } });
        }
        await this.audit.log(
          { actorId: null, action: "license.status_changed", entity: "Subscription", entityId: sub.id, metadata: { from: sub.status, to: next.status, tenantId: sub.tenantId } },
          tx,
        );
      });
      changed++;
    }
    return { checked: due.length, changed };
  }

  /** Licences qui expirent dans les `days` prochains jours (relances à envoyer). */
  expiringSoon(days = 7, now = new Date()) {
    return this.prisma.subscription.findMany({
      where: {
        status: { in: ["TRIALING", "ACTIVE"] },
        currentPeriodEnd: { gte: now, lte: new Date(now.getTime() + days * 86_400_000) },
      },
      orderBy: { currentPeriodEnd: "asc" },
      include: {
        tenant: { select: { id: true, name: true, slug: true, email: true, phone: true } },
        plan: { select: { code: true, name: true } },
      },
    });
  }
}
