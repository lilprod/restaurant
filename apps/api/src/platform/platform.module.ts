import { Module } from "@nestjs/common";
import { PlatformAuditService } from "./audit/platform-audit.service";
import { PlatformAuthGuard } from "./auth/platform-auth.guard";
import { PlatformAccountController, PlatformAuthController } from "./auth/platform-auth.controllers";
import { DashboardController } from "./dashboard/dashboard.controller";
import { LicensingService } from "./licensing/licensing.service";
import { PaymentsController } from "./payments/payments.controller";
import { PaymentsService } from "./payments/payments.service";
import { PlansController } from "./plans/plans.controller";
import { PlansService } from "./plans/plans.service";
import { PublicRegistrationController, RegistrationsController } from "./registrations/registrations.controller";
import { RegistrationsService } from "./registrations/registrations.service";
import { PublicBrandingController } from "./settings/public-branding.controller";
import { PlatformSettingsController } from "./settings/platform-settings.controller";
import { PlatformSecurityController, TenantAdminController } from "./security/platform-security.controller";
import { TenantsController } from "./tenants/tenants.controller";
import { TenantsService } from "./tenants/tenants.service";
import { PlatformUsersController } from "./users/platform-users.controller";

/** Espace plateforme (SuperAdmin) : tenants, plans, licences, paiements manuels, inscriptions, réglages, sécurité. */
@Module({
  controllers: [
    PlatformAuthController, PlatformAccountController, PlansController, TenantsController, TenantAdminController,
    PublicRegistrationController, PublicBrandingController, RegistrationsController, PaymentsController,
    DashboardController, PlatformSettingsController, PlatformUsersController, PlatformSecurityController,
  ],
  providers: [
    PlatformAuthGuard, PlatformAuditService, PlansService, TenantsService, RegistrationsService, PaymentsService, LicensingService,
  ],
  exports: [LicensingService, PlatformAuthGuard],
})
export class PlatformModule {}
