import { Module } from "@nestjs/common";
import { TenantAccountController, TenantAuthController } from "./tenant-auth.controllers";
import { TenantAuthGuard } from "./tenant-auth.guard";
import { TenantLicenseController } from "./tenant-license.controller";
import { TenantSecurityController } from "./tenant-security.controller";
import { TenantSettingsController } from "./tenant-settings.controller";

/** Espace d'un restaurant : authentification, compte, paramètres, sécurité, licence. */
@Module({
  controllers: [TenantAuthController, TenantAccountController, TenantSettingsController, TenantSecurityController, TenantLicenseController],
  providers: [TenantAuthGuard],
  exports: [TenantAuthGuard],
})
export class TenantModule {}
