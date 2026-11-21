import { Global, Module } from "@nestjs/common";
import { PlatformModule } from "../platform/platform.module";
import { TenantModule } from "../tenant/tenant.module";
import { LicenseRemindersService } from "./license-reminders.service";
import { PushController } from "./push.controller";
import { PushSubscriptionsService } from "./push-subscriptions.service";
import { PlatformNotificationsController, TenantNotificationsController } from "./notifications.controllers";
import { NotificationsService } from "./notifications.service";

/** Notifications email / SMS : service unique, modèles, pilotes, file d'envoi, journal, relances de licence. */
@Global()
@Module({
  imports: [TenantModule, PlatformModule],
  controllers: [TenantNotificationsController, PlatformNotificationsController, PushController],
  providers: [NotificationsService, LicenseRemindersService, PushSubscriptionsService],
  exports: [NotificationsService, LicenseRemindersService],
})
export class NotificationsModule {}
