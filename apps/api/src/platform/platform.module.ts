import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { APP_ENV, Env } from "../config/env";
import { PlatformAuditService } from "./audit/platform-audit.service";
import { PlatformAuthController } from "./auth/platform-auth.controller";
import { PlatformAuthGuard } from "./auth/platform-auth.guard";
import { PlatformAuthService } from "./auth/platform-auth.service";
import { DashboardController } from "./dashboard/dashboard.controller";
import { LicensingService } from "./licensing/licensing.service";
import { PaymentsController } from "./payments/payments.controller";
import { PaymentsService } from "./payments/payments.service";
import { PlansController } from "./plans/plans.controller";
import { PlansService } from "./plans/plans.service";
import { PublicRegistrationController, RegistrationsController } from "./registrations/registrations.controller";
import { RegistrationsService } from "./registrations/registrations.service";
import { TenantsController } from "./tenants/tenants.controller";
import { TenantsService } from "./tenants/tenants.service";

/** Espace plateforme (SuperAdmin) : tenants, plans, licences, paiements manuels, inscriptions. */
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_ENV],
      useFactory: (env: Env) => ({ secret: env.JWT_ACCESS_SECRET }),
    }),
  ],
  controllers: [
    PlatformAuthController, PlansController, TenantsController,
    PublicRegistrationController, RegistrationsController, PaymentsController, DashboardController,
  ],
  providers: [
    PlatformAuthGuard, PlatformAuthService, PlatformAuditService, PlansService, TenantsService,
    RegistrationsService, PaymentsService, LicensingService,
  ],
  exports: [LicensingService],
})
export class PlatformModule {}
