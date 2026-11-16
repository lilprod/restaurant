import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { zonedDay, zonedHour } from "@restaurant/utils";
import { APP_ENV, Env } from "../config/env";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { TenantSettingsService } from "../settings/tenant-settings.service";
import { METHOD_LABEL, delta, fmtInt, fmtMoney } from "./report-doc";
import { addDays } from "./period";
import { ReportsService } from "./reports.service";

/**
 * Rapport quotidien par email (X1) : chaque matin, aux administrateurs et gérants des restaurants qui l'ont activé
 * (réglage `reports.dailyReport`, plan avec le module `reports`), le récapitulatif de la veille. Les jours sans commande ni encaissement n'envoient rien.
 * Une seule fois par jour et par destinataire : la clé de déduplication du journal l'impose, même si le balayage tourne toutes les heures.
 */
@Injectable()
export class DailyReportService {
  private readonly log = new Logger(DailyReportService.name);

  constructor(
    private readonly prisma: PrismaService, private readonly settings: TenantSettingsService, private readonly reports: ReportsService,
    private readonly notifications: NotificationsService, @Inject(APP_ENV) private readonly env: Env,
  ) {}

  @Cron("7 * * * *")
  async scheduledRun() {
    if (this.env.DISABLE_CRON) return;
    try {
      const r = await this.run();
      if (r.sent) this.log.log(`Rapports quotidiens envoyés : ${r.sent}`);
    } catch (e) {
      this.log.error(`Rapports quotidiens : ${(e as Error).message}`);
    }
  }

  async run(now = new Date()): Promise<{ checked: number; sent: number }> {
    const tenants = await this.prisma.tenant.findMany({ where: { status: { in: ["TRIAL", "ACTIVE"] } }, select: { id: true, name: true, slug: true, timezone: true } });
    let checked = 0, sent = 0;
    for (const t of tenants) {
      try {
        const tenant = await this.settings.tenant(t.id);
        const cfg = await this.settings.getSection("reports", tenant);
        if (!cfg?.dailyReport || zonedHour(now, t.timezone) < cfg.dailyReportHour) continue;
        const sub = await this.prisma.subscription.findFirst({ where: { tenantId: t.id }, orderBy: { createdAt: "desc" }, include: { plan: true } });
        if ((sub?.plan.features as Record<string, unknown> | undefined)?.reports !== true) continue;
        checked++;
        sent += await this.sendFor(t, addDays(zonedDay(now, t.timezone), -1));
      } catch (e) {
        this.log.error(`Rapport quotidien de ${t.slug} : ${(e as Error).message}`);
      }
    }
    return { checked, sent };
  }

  private async sendFor(t: { id: string; name: string; slug: string; timezone: string }, day: string): Promise<number> {
    const prevDay = addDays(day, -1);
    const [r, prev] = await Promise.all([this.reports.sales(t.id, { from: day, to: day }), this.reports.sales(t.id, { from: prevDay, to: prevDay })]);
    const s = r.summary;
    if (s.ordersCount === 0 && s.revenue === 0) return 0;
    const d = delta(s.revenue, prev.summary.revenue);
    const [y, m, dd] = day.split("-").map(Number);
    const dayLabel = new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, dd)));
    const data = {
      dayLabel, revenue: fmtMoney(s.revenue), orders: s.ordersCount, averageTicket: fmtMoney(s.averageTicket), tips: fmtMoney(s.tips),
      vsPrevious: d == null ? undefined : `${d > 0 ? "+" : ""}${String(d).replace(".", ",")} % par rapport à la veille`,
      methods: r.byMethod.map((x) => `${METHOD_LABEL[x.method] ?? x.method} : ${fmtMoney(x.amount)}`),
      topItems: r.byItem.slice(0, 5).map((i) => `${fmtInt(i.quantity)} × ${i.name}`),
      cancellations: s.cancelledOrders.count || s.cancelledItems.count || s.refunds.count
        ? `Annulations : ${s.cancelledOrders.count} commande(s), ${s.cancelledItems.count} article(s) ; remboursements : ${fmtMoney(s.refunds.amount)}.`
        : "Aucune annulation ni remboursement.",
      reportUrl: `${this.env.APP_URL}/r/${t.slug}/rapports`,
    };
    const managers = await this.prisma.asTenant(t.id, (tx) => tx.user.findMany({ where: { tenantId: t.id, role: { in: ["ADMIN", "MANAGER"] }, isActive: true }, select: { id: true, email: true, firstName: true } }));
    let n = 0;
    for (const u of managers) {
      const res = await this.notifications.send({
        channel: "EMAIL", to: u.email, template: "reports.daily", tenantId: t.id, dedupeKey: `report:daily:${t.id}:${day}:${u.id}`,
        data: { ...data, firstName: u.firstName },
      });
      if (res.status === "queued") n++;
    }
    return n;
  }
}
