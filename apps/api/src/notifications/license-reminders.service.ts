import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { normalizePhone } from "@restaurant/utils";
import { APP_ENV, Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { dueLicenseTier } from "./license-tiers";
import { NotificationsService } from "./notifications.service";

/**
 * Relances de licence J-7, J-1 et jour d'expiration, aux administrateurs du restaurant (email, et SMS au numéro du
 * restaurant si le canal SMS est activé). Une seule fois par palier et par échéance : la clé de déduplication du journal
 * (`license:<abonnement>:<échéance>:<palier>:<destinataire>`) l'impose, même si le balayage tourne toutes les heures.
 * `Subscription.reminderSentAt` garde la date de la dernière relance.
 */
@Injectable()
export class LicenseRemindersService {
  private readonly log = new Logger(LicenseRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async scheduledRun() {
    if (this.env.DISABLE_CRON) return;
    try {
      const r = await this.run();
      if (r.sent) this.log.log(`Relances de licence envoyées : ${r.sent}`);
    } catch (e) {
      this.log.error(`Relances de licence : ${(e as Error).message}`);
    }
  }

  async run(now = new Date()): Promise<{ checked: number; sent: number }> {
    const subs = await this.prisma.subscription.findMany({
      where: {
        status: { in: ["TRIALING", "ACTIVE", "GRACE"] },
        cancelledAt: null,
        currentPeriodEnd: { gte: new Date(now.getTime() - 3 * 86_400_000), lte: new Date(now.getTime() + 9 * 86_400_000) },
        tenant: { status: { in: ["TRIAL", "ACTIVE"] } },
      },
      include: { tenant: { select: { id: true, name: true, slug: true, phone: true, timezone: true } }, plan: { select: { name: true } } },
    });

    let sent = 0;
    for (const sub of subs) {
      const tier = dueLicenseTier(sub.currentPeriodEnd, now, sub.tenant.timezone);
      if (!tier) continue;
      const base = `license:${sub.id}:${sub.currentPeriodEnd.toISOString().slice(0, 10)}:${tier}`;
      const endDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: sub.tenant.timezone }).format(sub.currentPeriodEnd);
      const licenseUrl = `${this.env.APP_URL}/r/${sub.tenant.slug}/licence`;
      const admins = await this.prisma.asTenant(sub.tenantId, (tx) =>
        tx.user.findMany({ where: { tenantId: sub.tenantId, role: "ADMIN", isActive: true }, select: { id: true, email: true, firstName: true } }),
      );

      let delivered = 0;
      for (const a of admins) {
        const r = await this.notifications.send({
          channel: "EMAIL", to: a.email, template: "license.reminder", tenantId: sub.tenantId, dedupeKey: `${base}:${a.id}`,
          data: { firstName: a.firstName, tier, endDate, planName: sub.plan.name, licenseUrl },
        });
        if (r.status === "queued") delivered++;
      }
      // SMS au numéro du restaurant : uniquement si le canal SMS est activé dans ses réglages.
      const phone = sub.tenant.phone ? normalizePhone(sub.tenant.phone) : null;
      if (phone) {
        const r = await this.notifications.send({
          channel: "SMS", to: phone, template: "license.reminder", tenantId: sub.tenantId, dedupeKey: `${base}:sms`,
          data: { firstName: "", tier, endDate, planName: sub.plan.name, licenseUrl },
        });
        if (r.status === "queued") delivered++;
      }
      if (delivered) {
        sent += delivered;
        await this.prisma.subscription.update({ where: { id: sub.id }, data: { reminderSentAt: now } });
      }
    }
    return { checked: subs.length, sent };
  }
}
