import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ListNotificationsQuery, listNotificationsQuerySchema } from "@restaurant/validation";
import { ZodPipe } from "../common/zod.pipe";
import { CurrentPlatformUser, PlatformAuthGuard, PlatformPrincipal, PlatformRoles } from "../platform/auth/platform-auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { Account } from "../security/accounts.repo";
import { CurrentAccount } from "../security/space-auth.guard";
import { TenantAuthGuard, TenantRoles } from "../tenant/tenant-auth.guard";
import { NotificationsService } from "./notifications.service";

@ApiTags("Restaurant · Notifications")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles("ADMIN")
@Controller("tenant/notifications")
export class TenantNotificationsController {
  constructor(private readonly notifications: NotificationsService, private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: "Journal des messages du restaurant (destinataires masqués)" })
  list(@CurrentAccount() a: Account, @Query(new ZodPipe(listNotificationsQuerySchema)) q: ListNotificationsQuery) {
    return this.notifications.list(q, { tenantId: a.tenantId! });
  }

  @Post(":id/resend") @HttpCode(200)
  @ApiOperation({ summary: "Renvoie un message (impossible pour les messages confidentiels)" })
  async resend(@CurrentAccount() a: Account, @Param("id", new ParseUUIDPipe()) id: string) {
    const r = await this.notifications.resend(id, { tenantId: a.tenantId! });
    await this.prisma.asTenant(a.tenantId!, (tx) =>
      tx.auditLog.create({ data: { tenantId: a.tenantId!, userId: a.id, action: "notification.resend", entity: "NotificationLog", entityId: id } }),
    );
    return r;
  }
}

@ApiTags("Plateforme · Notifications")
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard)
@Controller("platform/notifications")
export class PlatformNotificationsController {
  constructor(private readonly notifications: NotificationsService, private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: "Journal de tous les messages (plateforme et restaurants), destinataires masqués" })
  list(@Query(new ZodPipe(listNotificationsQuerySchema)) q: ListNotificationsQuery) {
    return this.notifications.list(q, "platform");
  }

  @Post(":id/resend") @HttpCode(200) @PlatformRoles("SUPER_ADMIN")
  async resend(@Param("id", new ParseUUIDPipe()) id: string, @CurrentPlatformUser() u: PlatformPrincipal) {
    const r = await this.notifications.resend(id, "platform");
    await this.prisma.platformAuditLog.create({ data: { actorId: u.id, action: "notification.resend", entity: "NotificationLog", entityId: id } });
    return r;
  }
}
