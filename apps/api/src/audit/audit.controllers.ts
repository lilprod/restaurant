import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuditLogQuery, auditLogQuerySchema } from "@restaurant/validation";
import { ZodPipe } from "../common/zod.pipe";
import { PlatformAuthGuard, PlatformRoles } from "../platform/auth/platform-auth.guard";
import { Account } from "../security/accounts.repo";
import { CurrentAccount } from "../security/space-auth.guard";
import { TenantAuthGuard, TenantRoles } from "../tenant/tenant-auth.guard";
import { AuditLogService } from "./audit-log.service";

@ApiTags("Restaurant · Journal d'audit")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles("ADMIN")
@Controller("tenant/audit-logs")
export class TenantAuditController {
  constructor(private readonly audit: AuditLogService) {}

  @Get()
  @ApiOperation({ summary: "Journal d'audit du restaurant (filtres : action par préfixe, entité, auteur, période)" })
  list(@CurrentAccount() a: Account, @Query(new ZodPipe(auditLogQuerySchema)) q: AuditLogQuery) {
    return this.audit.tenantLogs(a.tenantId!, q);
  }
}

@ApiTags("Plateforme · Journal d'audit")
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard)
@PlatformRoles("SUPER_ADMIN")
@Controller("platform")
export class PlatformAuditController {
  constructor(private readonly audit: AuditLogService) {}

  @Get("audit-logs")
  @ApiOperation({ summary: "Journal d'audit de la plateforme" })
  list(@Query(new ZodPipe(auditLogQuerySchema)) q: AuditLogQuery) {
    return this.audit.platformLogs(q);
  }

  @Get("tenants/:id/audit-logs")
  @ApiOperation({ summary: "Journal d'audit d'un restaurant (assistance)" })
  tenant(@Param("id", ParseUUIDPipe) id: string, @Query(new ZodPipe(auditLogQuerySchema)) q: AuditLogQuery) {
    return this.audit.tenantLogs(id, q, true);
  }
}
