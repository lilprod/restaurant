import { Controller, Get, Param, ParseUUIDPipe, Query, StreamableFile, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformReportQuery, ReportExportQuery, ReportKind, ReportPeriodQuery, platformReportQuerySchema, reportExportQuerySchema, reportKindSchema, reportPeriodSchema } from "@restaurant/validation";
import { ZodPipe } from "../common/zod.pipe";
import { PlatformAuthGuard, PlatformRoles } from "../platform/auth/platform-auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { FLOOR, MANAGERS } from "../restaurant/common";
import { Account } from "../security/accounts.repo";
import { CurrentAccount } from "../security/space-auth.guard";
import { PlanFeature, PlanFeatureGuard } from "../tenant/plan-feature.guard";
import { TenantAuthGuard, TenantRoles } from "../tenant/tenant-auth.guard";
import { DocumentsService } from "./documents.service";
import { OrdersExportService } from "./orders-export.service";
import { PlatformReportsService } from "./platform-reports.service";
import { ReportsService } from "./reports.service";

const t = (a: Account) => a.tenantId!;
const UUID = new ParseUUIDPipe();
const file = (f: { body: Buffer; type: string; filename: string }) => new StreamableFile(f.body, { type: f.type, disposition: `attachment; filename="${f.filename}"` });
const period = () => new ZodPipe(reportPeriodSchema);

/**
 * P5 — Rapports du restaurant (responsables). Module `reports` du plan (sinon `403 PLAN_FEATURE`).
 * Périodes en jours du restaurant (`from`, `to` inclus, 366 jours au plus).
 */
@ApiTags("Restaurant · Rapports")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard, PlanFeatureGuard)
@PlanFeature("reports")
@TenantRoles(...MANAGERS)
@Controller("tenant/reports")
export class TenantReportsController {
  constructor(
    private readonly reports: ReportsService, private readonly docs: DocumentsService, private readonly orders: OrdersExportService, private readonly prisma: PrismaService,
  ) {}

  @Get("sales") sales(@CurrentAccount() a: Account, @Query(period()) q: ReportPeriodQuery) { return this.reports.sales(t(a), q); }
  @Get("vat") vat(@CurrentAccount() a: Account, @Query(period()) q: ReportPeriodQuery) { return this.reports.vat(t(a), q); }
  @Get("register") register(@CurrentAccount() a: Account, @Query(period()) q: ReportPeriodQuery) { return this.reports.register(t(a), q); }
  @Get("margins") margins(@CurrentAccount() a: Account, @Query(period()) q: ReportPeriodQuery) { return this.reports.margins(t(a), q); }
  @Get("waste") waste(@CurrentAccount() a: Account, @Query(period()) q: ReportPeriodQuery) { return this.reports.waste(t(a), q); }
  @Get("staff") staff(@CurrentAccount() a: Account, @Query(period()) q: ReportPeriodQuery) { return this.reports.staffPerformance(t(a), q); }
  @Get("reviews") reviews(@CurrentAccount() a: Account, @Query(period()) q: ReportPeriodQuery) { return this.reports.reviews(t(a), q); }
  @Get("peak-hours") peak(@CurrentAccount() a: Account, @Query(period()) q: ReportPeriodQuery) { return this.reports.peakHours(t(a), q); }

  /** Export CSV (flux pour `orders`) ou PDF d'un rapport. Journalisé (audit). */
  @Get("export/:kind")
  async export(
    @CurrentAccount() a: Account, @Param("kind", new ZodPipe(reportKindSchema)) kind: ReportKind, @Query(new ZodPipe(reportExportQuerySchema)) q: ReportExportQuery,
  ) {
    await this.prisma.asTenant(t(a), (tx) => tx.auditLog.create({ data: { tenantId: t(a), userId: a.id, action: "report.export", entity: "Report", entityId: kind, metadata: { kind, format: kind === "orders" ? "csv" : q.format, from: q.from, to: q.to } } }));
    if (kind === "orders") {
      const { stream, filename } = await this.orders.stream(t(a), q);
      return new StreamableFile(stream, { type: "text/csv; charset=utf-8", disposition: `attachment; filename="${filename}"` });
    }
    return file(await this.docs.reportFile(kind, q.format, t(a), q));
  }
}

/** Facture PDF d'une commande (salle) : disponible sur tous les plans, comme le ticket. */
@ApiTags("Restaurant · Rapports")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles(...FLOOR)
@Controller("tenant/orders")
export class OrderInvoiceController {
  constructor(private readonly docs: DocumentsService) {}

  @Get(":id/invoice.pdf") async invoice(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return file(await this.docs.invoice(t(a), id)); }
}

/** Reçu PDF d'un paiement de licence, côté restaurant (administrateur). */
@ApiTags("Restaurant · Licence")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles("ADMIN")
@Controller("tenant/license/payments")
export class TenantLicenseReceiptController {
  constructor(private readonly docs: DocumentsService) {}

  @Get(":id/receipt.pdf") async receipt(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return file(await this.docs.licenseReceipt(id, t(a))); }
}

/** Reçu PDF d'un paiement de licence et rapport de licences, côté plateforme. */
@ApiTags("Plateforme · Rapports")
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard)
@Controller("platform")
export class PlatformReportsController {
  constructor(private readonly docs: DocumentsService, private readonly reports: PlatformReportsService) {}

  @Get("payments/:id/receipt.pdf") async receipt(@Param("id", UUID) id: string) { return file(await this.docs.licenseReceipt(id)); }

  @Get("reports/licenses") @PlatformRoles("SUPER_ADMIN")
  licenses(@Query(new ZodPipe(platformReportQuerySchema)) q: PlatformReportQuery) { return this.reports.licenses(q); }

  @Get("reports/licenses/export") @PlatformRoles("SUPER_ADMIN")
  async export(@Query(new ZodPipe(platformReportQuerySchema)) q: PlatformReportQuery) { return file(await this.reports.file(q)); }
}
