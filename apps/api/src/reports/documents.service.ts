import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { ReportKind, ReportPeriodQuery } from "@restaurant/validation";
import { OrdersService } from "../restaurant/orders.service";
import { PrismaService } from "../prisma/prisma.service";
import { PlatformSettingsService } from "../settings/platform-settings.service";
import { TenantSettingsService } from "../settings/tenant-settings.service";
import { StorageService } from "../storage/storage.service";
import { docToCsv } from "./csv";
import { PdfBrand, PdfService } from "./pdf.service";
import { METHOD_LABEL, TYPE_LABEL, dateTimeFr, dayFr, fmtMoney, type ReportDoc } from "./report-doc";
import { buildReportDoc } from "./report-docs";
import { ReportsService } from "./reports.service";

/** Marque, gabarits et fichiers : exports CSV/PDF des rapports, facture d'une commande, reçus de licence. */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService, private readonly settings: TenantSettingsService, private readonly platform: PlatformSettingsService,
    private readonly storage: StorageService, private readonly orders: OrdersService, private readonly reports: ReportsService, private readonly pdf: PdfService,
  ) {}

  /** Nom et coordonnées du restaurant, couleur de marque et logo : le gabarit PDF « à la marque du restaurant ». */
  async tenantBrand(tenantId: string, opts: { logo?: boolean } = {}): Promise<PdfBrand & { tz: string }> {
    const t = await this.settings.tenant(tenantId);
    const [business, branding, assets] = await Promise.all([this.settings.getSection("business", t), this.settings.getSection("branding", t), this.settings.get(tenantId, "branding")]);
    const logoUrl = (assets as { assets?: { logo?: string | null } }).assets?.logo ?? null;
    const lines = [business.legalName, t.address, [business.phone ?? t.phone, business.email ?? t.email].filter(Boolean).join(" · "), business.taxId ? `NIF : ${business.taxId}` : null, business.registrationNumber ? `RCCM : ${business.registrationNumber}` : null]
      .filter((x): x is string => !!x);
    return { name: business.tradeName ?? t.name, primary: branding?.theme?.primary, logo: opts.logo === false ? null : await this.storage.readUrl(logoUrl), lines, tz: t.timezone };
  }

  // ── Rapports ──

  async reportFile(kind: Exclude<ReportKind, "orders">, format: "csv" | "pdf", tenantId: string, p: ReportPeriodQuery) {
    const doc: ReportDoc = await buildReportDoc(kind, this.reports, tenantId, p);
    const name = `rapport-${kind}-${p.from}${p.to === p.from ? "" : `_${p.to}`}`;
    if (format === "csv") return { body: Buffer.from(docToCsv(doc), "utf8"), type: "text/csv; charset=utf-8", filename: `${name}.csv` };
    const brand = await this.tenantBrand(tenantId);
    return { body: await this.pdf.report(doc, brand, dateTimeFr(new Date(), brand.tz)), type: "application/pdf", filename: `${name}.pdf` };
  }

  // ── Facture d'une commande ──

  async invoice(tenantId: string, orderId: string) {
    const r = await this.orders.receipt(tenantId, orderId);
    const o = r.order;
    if (o.status === "CANCELLED" || o.cancelledAt) throw new ConflictException("Une commande annulée ne peut pas être facturée");
    const t = await this.settings.tenant(tenantId);
    const brand = await this.tenantBrand(tenantId, { logo: r.restaurant.logoUrl !== null });
    const live = o.items.filter((i) => i.status !== "CANCELLED");
    const lines = live.filter((i) => !i.parentItemId).flatMap((i) => [
      { label: [i.name, ...i.options.map((x) => `+ ${x.name}`)].join(" "), quantity: i.quantity, unitPrice: i.unitPrice + i.optionsExtra, vatRate: i.vatRate, total: i.lineTotal },
      ...live.filter((c) => c.parentItemId === i.id).map((c) => ({ label: `${c.stepName ? `${c.stepName} : ` : ""}${c.name}`, quantity: c.quantity, unitPrice: 0, vatRate: c.vatRate, total: 0, child: true })),
    ]);
    const paid = o.payments.filter((p) => p.status === "PAID");
    const mentions = [
      r.restaurant.headerText, "Montants en FCFA, TVA incluse dans les prix.",
      r.restaurant.legalName ? `${r.restaurant.legalName}${r.restaurant.registrationNumber ? ` · RCCM ${r.restaurant.registrationNumber}` : ""}${r.restaurant.taxId ? ` · NIF ${r.restaurant.taxId}` : ""}` : null,
      r.restaurant.footerText,
    ].filter((x): x is string => !!x);
    const number = `F-${String(o.number).padStart(6, "0")}`;
    const body = await this.pdf.invoice({
      brand, number, date: dateTimeFr(o.createdAt, t.timezone), orderNumber: o.number, type: TYPE_LABEL[o.type] ?? o.type,
      table: o.table?.label ?? "", waiter: o.waiter ? `${o.waiter.firstName} ${o.waiter.lastName}`.trim() : "", customer: o.customerName ?? "",
      lines, subtotal: o.subtotal, discounts: o.discountTotal, serviceCharge: o.serviceCharge, deliveryFee: o.deliveryFee, total: o.total, tip: o.tip,
      vat: r.vatBreakdown, payments: paid.map((p) => ({ label: `${METHOD_LABEL[p.method] ?? p.method}${p.paidAt ? ` (${dayFr(p.paidAt.toISOString().slice(0, 10))})` : ""}`, amount: p.amount })),
      remaining: Math.max(o.total - o.paidAmount, 0), mentions,
    });
    return { body, type: "application/pdf", filename: `facture-${number}.pdf` };
  }

  // ── Reçu d'un paiement de licence ──

  /** `tenantId` : limite au restaurant appelant (404 sinon) ; absent côté plateforme. */
  async licenseReceipt(paymentId: string, tenantId?: string) {
    const p = await this.prisma.subscriptionPayment.findFirst({
      where: { id: paymentId, ...(tenantId ? { tenantId } : {}) },
      include: { tenant: { select: { name: true, email: true, address: true } }, subscription: { include: { plan: { select: { name: true } } } } },
    });
    if (!p) throw new NotFoundException("Paiement introuvable");
    const [company, assets] = await Promise.all([this.platform.getSection("company"), this.platform.publicBranding()]);
    const logo = await this.storage.readUrl(assets.logoUrl);
    const lines = [company.legalName, [company.legalForm].filter(Boolean).join(" "), [company.address?.street, company.address?.city, company.address?.country].filter(Boolean).join(", "), [company.phone, company.email].filter(Boolean).join(" · "),
      company.taxId ? `NIF : ${company.taxId}` : null, company.registrationNumber ? `RCCM : ${company.registrationNumber}` : null].filter((x): x is string => !!x);
    const day = (d: Date) => dayFr(d.toISOString().slice(0, 10));
    const body = await this.pdf.licenseReceipt({
      brand: { name: assets.displayName ?? company.tradeName ?? company.legalName, primary: assets.theme?.primary, logo, lines },
      number: p.receiptNumber, date: `Émis le ${day(p.paidAt)}`, customer: { name: p.tenant.name, email: p.tenant.email },
      plan: p.subscription.plan.name, cycle: p.billingCycle === "YEARLY" ? "Annuel" : "Mensuel", period: `Du ${day(p.periodStart)} au ${day(p.periodEnd)}`,
      method: ({ CASH: "Espèces", CARD: "Carte", FLOOZ: "Flooz", TMONEY: "TMoney" } as Record<string, string>)[p.method] ?? p.method,
      reference: p.reference, amount: p.amount, voided: p.status === "VOIDED" ? { reason: p.voidReason } : null,
      mentions: [`Montant en ${p.currency === "XOF" ? "FCFA (XOF)" : p.currency}. ${fmtMoney(p.amount)} reçus au titre de la licence du logiciel de gestion de restaurant.`],
    });
    return { body, type: "application/pdf", filename: `recu-${p.receiptNumber}.pdf` };
  }
}
