import { Global, Module } from "@nestjs/common";
import { PlatformSettingsService } from "./platform-settings.service";
import { TenantSettingsService } from "./tenant-settings.service";

@Global()
@Module({ providers: [TenantSettingsService, PlatformSettingsService], exports: [TenantSettingsService, PlatformSettingsService] })
export class SettingsModule {}
