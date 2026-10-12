import {
  Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { assetKindSchema } from "@restaurant/validation";
import { ZodPipe } from "../common/zod.pipe";
import { Account } from "../security/accounts.repo";
import { CurrentAccount } from "../security/space-auth.guard";
import { TenantSettingsService } from "../settings/tenant-settings.service";
import { TenantAuthGuard, TenantRoles } from "./tenant-auth.guard";

type Kind = "logo" | "logoDark" | "favicon";

/** Qui peut LIRE chaque section (l'écriture est réservée à l'administrateur). */
const READ: Record<string, string[]> = {
  business: ["ADMIN", "MANAGER"],
  branding: ["ADMIN", "MANAGER"],
  operations: ["ADMIN", "MANAGER", "WAITER", "KITCHEN"],
  localization: ["ADMIN", "MANAGER", "WAITER", "KITCHEN"],
  security: ["ADMIN"],
};

@ApiTags("Restaurant · Paramètres")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles("ADMIN", "MANAGER", "WAITER", "KITCHEN")
@Controller("tenant/settings")
export class TenantSettingsController {
  constructor(private readonly settings: TenantSettingsService) {}

  private actor = (a: Account) => ({ kind: "tenant" as const, id: a.id });

  /** Toutes les sections que le rôle de l'appelant a le droit de lire. */
  @Get()
  async all(@CurrentAccount() acc: Account) {
    const all = (await this.settings.all(acc.tenantId!)) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(all).filter(([k]) => !READ[k] || READ[k].includes(acc.role)));
  }

  @Get(":section")
  get(@CurrentAccount() acc: Account, @Param("section") section: string) {
    if (READ[section] && !READ[section].includes(acc.role)) throw new ForbiddenException("Droits insuffisants");
    return this.settings.get(acc.tenantId!, section);
  }

  @Patch(":section") @TenantRoles("ADMIN")
  update(@CurrentAccount() acc: Account, @Param("section") section: string, @Body() body: unknown) {
    return this.settings.update(acc.tenantId!, section, body, this.actor(acc));
  }

  @Post("assets/:kind") @HttpCode(201) @TenantRoles("ADMIN") @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 3 * 1024 * 1024 } }))
  upload(@CurrentAccount() acc: Account, @Param("kind", new ZodPipe(assetKindSchema)) kind: Kind, @UploadedFile() file: { buffer: Buffer } | undefined) {
    return this.settings.uploadAsset(acc.tenantId!, kind, file, this.actor(acc));
  }

  @Delete("assets/:kind") @HttpCode(204) @TenantRoles("ADMIN")
  remove(@CurrentAccount() acc: Account, @Param("kind", new ZodPipe(assetKindSchema)) kind: Kind) {
    return this.settings.removeAsset(acc.tenantId!, kind, this.actor(acc));
  }
}
