import { Controller, Get, Header, Param } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PlatformSettingsService } from "../../settings/platform-settings.service";
import { TenantSettingsService } from "../../settings/tenant-settings.service";

/** Marque visible avant connexion : thème, logo, favicon (plateforme ou restaurant, via son sous-domaine). */
@ApiTags("Public · Marque")
@Controller("public")
export class PublicBrandingController {
  constructor(private readonly platform: PlatformSettingsService, private readonly tenants: TenantSettingsService) {}

  @Get("branding") @Header("Cache-Control", "public, max-age=60")
  platformBranding() { return this.platform.publicBranding(); }

  @Get("tenants/:slug/branding") @Header("Cache-Control", "public, max-age=60")
  tenantBranding(@Param("slug") slug: string) { return this.tenants.publicBranding(slug); }
}
