import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { PrismaExceptionFilter } from "./common/prisma-exception.filter";
import { AppConfigModule } from "./config/config.module";
import { MailModule } from "./mail/mail.module";
import { PlatformModule } from "./platform/platform.module";
import { SecurityModule } from "./security/security.module";
import { SettingsModule } from "./settings/settings.module";
import { StorageModule } from "./storage/storage.module";
import { TenantModule } from "./tenant/tenant.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RestaurantModule } from "./restaurant/restaurant.module";

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    MailModule,
    StorageModule,
    SecurityModule,
    SettingsModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 120 }], skipIf: () => !!process.env.DISABLE_THROTTLE }),
    PlatformModule,
    TenantModule,
    RestaurantModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
