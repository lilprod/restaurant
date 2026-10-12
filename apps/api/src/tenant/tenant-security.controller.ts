import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ZodPipe } from "../common/zod.pipe";
import { AccountAdminService } from "../security/account-admin.service";
import { Account } from "../security/accounts.repo";
import { LoginEventsService } from "../security/login-events.service";
import { CurrentAccount } from "../security/space-auth.guard";
import { TenantAuthGuard, TenantRoles } from "./tenant-auth.guard";

const eventsQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

/** L'administrateur du restaurant gère la sécurité de ses utilisateurs. */
@ApiTags("Restaurant · Sécurité")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles("ADMIN")
@Controller("tenant/security")
export class TenantSecurityController {
  constructor(private readonly admin: AccountAdminService, private readonly events: LoginEventsService) {}

  private actor = (a: Account) => ({ kind: "tenant" as const, id: a.id });

  @Get("users") users(@CurrentAccount() acc: Account) { return this.admin.listTenantUsers(acc.tenantId!); }

  @Get("login-events")
  history(@CurrentAccount() acc: Account, @Query(new ZodPipe(eventsQuery)) q: { limit: number }) {
    return this.events.list({ tenantId: acc.tenantId }, q.limit);
  }

  @Post("users/:id/reset-password") @HttpCode(200)
  reset(@CurrentAccount() acc: Account, @Param("id", ParseUUIDPipe) id: string) {
    return this.admin.resetPassword("tenant", acc.tenantId, id, this.actor(acc));
  }
  @Post("users/:id/unlock") @HttpCode(200)
  unlock(@CurrentAccount() acc: Account, @Param("id", ParseUUIDPipe) id: string) {
    return this.admin.unlock("tenant", acc.tenantId, id, this.actor(acc));
  }
  @Post("users/:id/disable-2fa") @HttpCode(200)
  disable2fa(@CurrentAccount() acc: Account, @Param("id", ParseUUIDPipe) id: string) {
    return this.admin.disableTwoFactor("tenant", acc.tenantId, id, this.actor(acc));
  }
  @Post("users/:id/revoke-sessions") @HttpCode(200)
  revoke(@CurrentAccount() acc: Account, @Param("id", ParseUUIDPipe) id: string) {
    return this.admin.revokeSessions("tenant", acc.tenantId, id, this.actor(acc));
  }
  @Patch("users/:id/active")
  setActive(@CurrentAccount() acc: Account, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ isActive: z.boolean() }))) body: { isActive: boolean }) {
    return this.admin.setActive("tenant", acc.tenantId, id, body.isActive, this.actor(acc));
  }
}
