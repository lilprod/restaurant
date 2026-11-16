import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module";
import { PlatformModule } from "../platform/platform.module";
import { RestaurantModule } from "../restaurant/restaurant.module";
import { StaffModule } from "../staff/staff.module";
import { PlanFeatureGuard } from "../tenant/plan-feature.guard";
import { TenantModule } from "../tenant/tenant.module";
import { DailyReportService } from "./daily-report.service";
import { DocumentsService } from "./documents.service";
import { OrdersExportService } from "./orders-export.service";
import { PdfService } from "./pdf.service";
import { PlatformReportsService } from "./platform-reports.service";
import { OrderInvoiceController, PlatformReportsController, TenantLicenseReceiptController, TenantReportsController } from "./reports.controllers";
import { ReportsService } from "./reports.service";

/**
 * P5 — Rapports, analyses et exports : ventes, TVA, caisse, marges, pertes, personnel, avis, heures de pointe (restaurant) ;
 * revenus de licences (plateforme) ; exports CSV (flux) et PDF ; facture d'une commande ; reçu de licence ; rapport quotidien par email.
 * Les calculs réutilisent ceux des autres modules (marges P3, performances P4, avis P2C) ; les définitions suivent le tableau de bord.
 */
@Module({
  imports: [TenantModule, PlatformModule, RestaurantModule, InventoryModule, StaffModule],
  controllers: [TenantReportsController, OrderInvoiceController, TenantLicenseReceiptController, PlatformReportsController],
  providers: [ReportsService, DocumentsService, OrdersExportService, PdfService, PlatformReportsService, DailyReportService, PlanFeatureGuard],
  exports: [ReportsService],
})
export class ReportsModule {}
