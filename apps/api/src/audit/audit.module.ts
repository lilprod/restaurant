import { Module } from "@nestjs/common";
import { PlatformModule } from "../platform/platform.module";
import { TenantModule } from "../tenant/tenant.module";
import { PlatformAuditController, TenantAuditController } from "./audit.controllers";
import { AuditLogService } from "./audit-log.service";

/** Consultation des journaux d'audit (restaurant et plateforme). */
@Module({
  imports: [TenantModule, PlatformModule],
  controllers: [TenantAuditController, PlatformAuditController],
  providers: [AuditLogService],
})
export class AuditModule {}
