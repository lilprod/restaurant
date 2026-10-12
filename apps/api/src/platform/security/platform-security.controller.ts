import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { assetKindSchema } from "@restaurant/validation";
import { ZodPipe } from "../../common/zod.pipe";
import { AccountAdminService } from "../../security/account-admin.service";
import { LoginEventsService } from "../../security/login-events.service";
import { TenantSettingsService } from "../../settings/tenant-settings.service";
import { CurrentPlatformUser, PlatformAuthGuard, PlatformPrincipal, PlatformRoles } from "../auth/platform-auth.guard";

type Kind = "logo" | "logoDark" | "favicon";
const eventsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  result: z.enum(["SUCCESS", "BAD_PASSWORD", "UNKNOWN_ACCOUNT", "LOCKED", "TWO_FACTOR_FAILED", "TWO_FACTOR_REQUIRED", "LICENSE_BLOCKED"]).optional(),
});
type EventsQuery = z.infer<typeof eventsQuery>;

/** Journal de connexion de toute la plateforme (détection d'attaques, support). */
@ApiTags("Plateforme · Sécurité")
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard)
@PlatformRoles("SUPER_ADMIN")
@Controller("platform/security")
export class PlatformSecurityController {
  constructor(private readonly events: LoginEventsService) {}

  @Get("login-events")
  list(@Query(new ZodPipe(eventsQuery)) q: EventsQuery, @Query("tenantId") tenantId?: string, @Query("space") space?: string) {
    return this.events.list(
      { ...(q.result ? { result: q.result } : {}), ...(tenantId ? { tenantId } : {}), ...(space === "platform" || space === "tenant" ? { space } : {}) },
      q.limit,
    );
  }
}

/** Le SuperAdmin intervient sur un restaurant : réglages, marque, comptes (support). */
@ApiTags("Plateforme · Support restaurant")
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard)
@PlatformRoles("SUPER_ADMIN")
@Controller("platform/tenants/:tenantId")
export class TenantAdminController {
  constructor(
    private readonly settings: TenantSettingsService,
    private readonly admin: AccountAdminService,
    private readonly events: LoginEventsService,
  ) {}

  private actor = (u: PlatformPrincipal) => ({ kind: "platform" as const, id: u.id });

  @Get("settings") all(@Param("tenantId", ParseUUIDPipe) id: string) { return this.settings.all(id); }

  @Get("settings/:section")
  get(@Param("tenantId", ParseUUIDPipe) id: string, @Param("section") section: string) { return this.settings.get(id, section); }

  @Patch("settings/:section")
  update(@Param("tenantId", ParseUUIDPipe) id: string, @Param("section") section: string, @Body() body: unknown, @CurrentPlatformUser() u: PlatformPrincipal) {
    return this.settings.update(id, section, body, this.actor(u));
  }

  @Post("assets/:kind") @HttpCode(201) @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 3 * 1024 * 1024 } }))
  upload(
    @Param("tenantId", ParseUUIDPipe) id: string, @Param("kind", new ZodPipe(assetKindSchema)) kind: Kind,
    @UploadedFile() file: { buffer: Buffer } | undefined, @CurrentPlatformUser() u: PlatformPrincipal,
  ) {
    return this.settings.uploadAsset(id, kind, file, this.actor(u));
  }

  @Delete("assets/:kind") @HttpCode(204)
  remove(@Param("tenantId", ParseUUIDPipe) id: string, @Param("kind", new ZodPipe(assetKindSchema)) kind: Kind, @CurrentPlatformUser() u: PlatformPrincipal) {
    return this.settings.removeAsset(id, kind, this.actor(u));
  }

  // ── comptes du restaurant ──
  @Get("security/users") users(@Param("tenantId", ParseUUIDPipe) id: string) { return this.admin.listTenantUsers(id); }

  @Get("security/login-events")
  history(@Param("tenantId", ParseUUIDPipe) id: string, @Query(new ZodPipe(eventsQuery)) q: EventsQuery) {
    return this.events.list({ tenantId: id, ...(q.result ? { result: q.result } : {}) }, q.limit);
  }

  @Post("security/users/:userId/reset-password") @HttpCode(200)
  reset(@Param("tenantId", ParseUUIDPipe) t: string, @Param("userId", ParseUUIDPipe) id: string, @CurrentPlatformUser() u: PlatformPrincipal) {
    return this.admin.resetPassword("tenant", t, id, this.actor(u));
  }
  @Post("security/users/:userId/unlock") @HttpCode(200)
  unlock(@Param("tenantId", ParseUUIDPipe) t: string, @Param("userId", ParseUUIDPipe) id: string, @CurrentPlatformUser() u: PlatformPrincipal) {
    return this.admin.unlock("tenant", t, id, this.actor(u));
  }
  @Post("security/users/:userId/disable-2fa") @HttpCode(200)
  disable2fa(@Param("tenantId", ParseUUIDPipe) t: string, @Param("userId", ParseUUIDPipe) id: string, @CurrentPlatformUser() u: PlatformPrincipal) {
    return this.admin.disableTwoFactor("tenant", t, id, this.actor(u));
  }
  @Post("security/users/:userId/revoke-sessions") @HttpCode(200)
  revoke(@Param("tenantId", ParseUUIDPipe) t: string, @Param("userId", ParseUUIDPipe) id: string, @CurrentPlatformUser() u: PlatformPrincipal) {
    return this.admin.revokeSessions("tenant", t, id, this.actor(u));
  }
}
