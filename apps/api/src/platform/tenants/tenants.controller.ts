import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  CreateTenantInput, createTenantSchema, listTenantsQuerySchema, updateTenantSchema,
} from "@restaurant/validation";
import { ZodPipe } from "../../common/zod.pipe";
import { CurrentPlatformUser, PlatformAuthGuard, PlatformPrincipal, PlatformRoles } from "../auth/platform-auth.guard";
import { TenantsService } from "./tenants.service";

@ApiTags("Plateforme · Restaurants (tenants)")
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard)
@Controller("platform/tenants")
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  list(@Query(new ZodPipe(listTenantsQuerySchema)) q: { status?: string; search?: string; page: number; pageSize: number }) {
    return this.tenants.list(q);
  }

  @Post() @PlatformRoles("SUPER_ADMIN")
  create(@Body(new ZodPipe(createTenantSchema)) body: CreateTenantInput, @CurrentPlatformUser() u: PlatformPrincipal) {
    return this.tenants.create(body, u.id);
  }

  @Get(":id") get(@Param("id", ParseUUIDPipe) id: string) { return this.tenants.get(id); }

  @Get(":id/subscriptions") subscriptions(@Param("id", ParseUUIDPipe) id: string) { return this.tenants.subscriptions(id); }

  @Patch(":id") @PlatformRoles("SUPER_ADMIN")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateTenantSchema)) body: { name?: string; email?: string; phone?: string; address?: string },
    @CurrentPlatformUser() u: PlatformPrincipal,
  ) {
    return this.tenants.update(id, body, u.id);
  }

  @Post(":id/suspend") @HttpCode(200) @PlatformRoles("SUPER_ADMIN")
  suspend(@Param("id", ParseUUIDPipe) id: string, @CurrentPlatformUser() u: PlatformPrincipal) {
    return this.tenants.suspend(id, u.id);
  }

  @Post(":id/reactivate") @HttpCode(200) @PlatformRoles("SUPER_ADMIN")
  reactivate(@Param("id", ParseUUIDPipe) id: string, @CurrentPlatformUser() u: PlatformPrincipal) {
    return this.tenants.reactivate(id, u.id);
  }
}
