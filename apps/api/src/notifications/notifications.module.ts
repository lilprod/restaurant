import { Global, Module } from "@nestjs/common";
import { PlatformModule } from "../platform/platform.module";
import { TenantModule } from "../tenant/tenant.module";
import { LicenseRemindersService } from "./license-reminders.service";
import { PlatformNotificationsController, TenantNotificationsController } from "./notifications.controllers";
import { NotificationsService } from "./notifications.service";

/** Notifications email / SMS : service unique, modèles, pilotes, file d'envoi, journal, relances de licence. */
@Global()
@Module({
  imports: [TenantModule, PlatformModule],
  controllers: [TenantNotificationsController, PlatformNotificationsController],
  providers: [NotificationsService, LicenseRemindersService],
  exports: [NotificationsService, LicenseRemindersService],
})
export class NotificationsModule {}
