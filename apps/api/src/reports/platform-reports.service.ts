import { Injectable } from "@nestjs/common";
import type { PlatformReportQuery } from "@restaurant/validation";
import { PrismaService } from "../prisma/prisma.service";
import { PlatformSettingsService } from "../settings/platform-settings.service";
import { StorageService } from "../storage/storage.service";
import { docToCsv } from "./csv";
import { PdfService } from "./pdf.service";
import { METHOD_LABEL, dateTimeFr, fmtMoney, periodLabel, type ReportDoc } from "./report-doc";

const STATUS_LABEL: Record<string, string> = { PENDING: "En attente", TRIAL: "Essai", ACTIVE: "Actif", SUSPENDED: "Suspendu", CANCELLED: "Résilié" };
const n = (v: unknown) => Number(v ?? 0);

/** Rapports de la plateforme (SuperAdmin) : revenus de licences, état du parc, renouvellements et résiliations. Mois en UTC. */
@Injectable()
export class PlatformReportsService {
  constructor(private readonly prisma: PrismaService, private readonly platform: PlatformSettingsService, private readonly storage: StorageService, private readonly pdf: PdfService) {}

  async licenses(q: Pick<PlatformReportQuery, "from" | "to">) {
    const from = new Date(`${q.from}T00:00:00Z`), to = new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86_400_000);
    return this.prisma.asPlatform(async (tx) => {
      const [statuses, byMonthMethod, renewals, cancellations, voided] = await Promise.all([
        tx.tenant.groupBy({ by: ["status"], _count: { _all: true } }),
        tx.$queryRaw<{ month: string; method: string; amount: bigint; count: bigint }[]>`
          SELECT to_char("paidAt", 'YYYY-MM') AS month, method::text AS method, SUM(amount) AS amount, COUNT(*) AS count
          FROM "SubscriptionPayment" WHERE status = 'RECORDED' AND "paidAt" >= ${from} AND "paidAt" < ${to} GROUP BY 1, 2`,
        tx.$queryRaw<{ month: string; first: bigint; renewals: bigint }[]>`
          SELECT to_char("paidAt", 'YYYY-MM') AS month, COUNT(*) FILTER (WHERE rn = 1) AS first, COUNT(*) FILTER (WHERE rn > 1) AS renewals
          FROM (SELECT "paidAt", ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "paidAt", "createdAt") AS rn FROM "SubscriptionPayment" WHERE status = 'RECORDED') x
          WHERE "paidAt" >= ${from} AND "paidAt" < ${to} GROUP BY 1`,
        tx.$queryRaw<{ month: string; count: bigint }[]>`
          SELECT to_char("cancelledAt", 'YYYY-MM') AS month, COUNT(*) AS count FROM "Subscription"
          WHERE "cancelledAt" >= ${from} AND "cancelledAt" < ${to} GROUP BY 1`,
        tx.subscriptionPayment.count({ where: { status: "VOIDED", paidAt: { gte: from, lt: to } } }),
      ]);
      const months = new Map<string, { month: string; total: number; count: number; byMethod: Record<string, number>; firstPayments: number; renewals: number; cancellations: number }>();
      const row = (m: string) => months.get(m) ?? months.set(m, { month: m, total: 0, count: 0, byMethod: {}, firstPayments: 0, renewals: 0, cancellations: 0 }).get(m)!;
      const methods = new Map<string, { method: string; amount: number; count: number }>();
      for (const r of byMonthMethod) {
        const x = row(r.month);
        x.total += n(r.amount); x.count += n(r.count); x.byMethod[r.method] = n(r.amount);
        const mm = methods.get(r.method) ?? methods.set(r.method, { method: r.method, amount: 0, count: 0 }).get(r.method)!;
        mm.amount += n(r.amount); mm.count += n(r.count);
      }
      for (const r of renewals) { row(r.month).firstPayments = n(r.first); row(r.month).renewals = n(r.renewals); }
      for (const r of cancellations) row(r.month).cancellations = n(r.count);
      const list = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
      return {
        from: q.from, to: q.to,
        tenants: Object.fromEntries(["PENDING", "TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"].map((s) => [s, statuses.find((x) => x.status === s)?._count._all ?? 0])) as Record<string, number>,
        revenue: { total: list.reduce((a, m) => a + m.total, 0), count: list.reduce((a, m) => a + m.count, 0), byMonth: list, byMethod: [...methods.values()].sort((a, b) => b.amount - a.amount || a.method.localeCompare(b.method)) },
        totals: { firstPayments: list.reduce((a, m) => a + m.firstPayments, 0), renewals: list.reduce((a, m) => a + m.renewals, 0), cancellations: list.reduce((a, m) => a + m.cancellations, 0), voided },
      };
    });
  }

  async file(q: PlatformReportQuery) {
    const r = await this.licenses(q);
    const doc: ReportDoc = {
      title: "Licences et revenus", subtitle: `${periodLabel(q.from, q.to)} · mois en UTC`,
      kpis: [{ label: "Revenus encaissés", value: fmtMoney(r.revenue.total) }, { label: "Paiements", value: String(r.revenue.count) }, { label: "Renouvellements", value: String(r.totals.renewals) }, { label: "Résiliations", value: String(r.totals.cancellations) }],
      sections: [
        { title: "Revenus par mois", columns: [{ label: "Mois" }, { label: "Paiements", type: "int" }, ...Object.values(METHOD_LABEL).slice(0, 4).map((label) => ({ label: `${label} (FCFA)`, type: "money" as const })), { label: "Total (FCFA)", type: "money" }],
          rows: r.revenue.byMonth.map((m) => [m.month, m.count, m.byMethod.CASH ?? 0, m.byMethod.CARD ?? 0, m.byMethod.FLOOZ ?? 0, m.byMethod.TMONEY ?? 0, m.total]),
          total: ["Total", r.revenue.count, ...["CASH", "CARD", "FLOOZ", "TMONEY"].map((k) => r.revenue.byMonth.reduce((a, m) => a + (m.byMethod[k] ?? 0), 0)), r.revenue.total] },
        { title: "Par moyen de paiement", columns: [{ label: "Moyen" }, { label: "Paiements", type: "int" }, { label: "Montant (FCFA)", type: "money" }], rows: r.revenue.byMethod.map((m) => [METHOD_LABEL[m.method] ?? m.method, m.count, m.amount]), total: ["Total", r.revenue.count, r.revenue.total] },
        { title: "Souscriptions, renouvellements et résiliations", columns: [{ label: "Mois" }, { label: "Premiers paiements", type: "int" }, { label: "Renouvellements", type: "int" }, { label: "Résiliations", type: "int" }],
          rows: r.revenue.byMonth.map((m) => [m.month, m.firstPayments, m.renewals, m.cancellations]), total: ["Total", r.totals.firstPayments, r.totals.renewals, r.totals.cancellations] },
        { title: "Restaurants par statut (aujourd'hui)", columns: [{ label: "Statut" }, { label: "Restaurants", type: "int" }], rows: Object.entries(r.tenants).map(([s, c]) => [STATUS_LABEL[s] ?? s, c]), total: ["Total", Object.values(r.tenants).reduce((a, b) => a + b, 0)] },
      ],
    };
    const name = `plateforme-licences-${q.from}_${q.to}`;
    if (q.format === "csv") return { body: Buffer.from(docToCsv(doc), "utf8"), type: "text/csv; charset=utf-8", filename: `${name}.csv` };
    const assets = await this.platform.publicBranding();
    const company = await this.platform.getSection("company");
    const brand = { name: assets.displayName ?? company.legalName, primary: assets.theme?.primary, logo: await this.storage.readUrl(assets.logoUrl), lines: [company.legalName, [company.phone, company.email].filter(Boolean).join(" · ")].filter((x): x is string => !!x) };
    return { body: await this.pdf.report(doc, brand, dateTimeFr(new Date(), "UTC")), type: "application/pdf", filename: `${name}.pdf` };
  }
}
