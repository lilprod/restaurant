import {
  Body, Controller, ForbiddenException, Delete, Get, HttpCode, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { assetKindSchema } from "@restaurant/validation";
import { ZodPipe } from "../../common/zod.pipe";
import { PlatformSettingsService } from "../../settings/platform-settings.service";
import { CurrentPlatformUser, PlatformAuthGuard, PlatformPrincipal, PlatformRoles } from "../auth/platform-auth.guard";

type Kind = "logo" | "logoDark" | "favicon";
const SECRET_SECTIONS = ["security"];

@ApiTags("Plateforme · Paramètres")
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard)
@Controller("platform/settings")
export class PlatformSettingsController {
  constructor(private readonly settings: PlatformSettingsService) {}

  /** Toutes les sections (la sécurité est réservée au SuperAdmin). */
  @Get()
  async all(@CurrentPlatformUser() u: PlatformPrincipal) {
    const all = await this.settings.all();
    if (u.role !== "SUPER_ADMIN") for (const s of SECRET_SECTIONS) delete (all as Record<string, unknown>)[s];
    return all;
  }

  @Get(":section")
  async get(@Param("section") section: string, @CurrentPlatformUser() u: PlatformPrincipal) {
    if (SECRET_SECTIONS.includes(section) && u.role !== "SUPER_ADMIN") throw new ForbiddenException("Droits insuffisants");
    return this.settings.get(section);
  }

  @Patch(":section") @PlatformRoles("SUPER_ADMIN")
  update(@Param("section") section: string, @Body() body: unknown, @CurrentPlatformUser() u: PlatformPrincipal) {
    return this.settings.update(section, body, u.id);
  }

  @Post("assets/:kind") @HttpCode(201) @PlatformRoles("SUPER_ADMIN") @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 3 * 1024 * 1024 } }))
  upload(@Param("kind", new ZodPipe(assetKindSchema)) kind: Kind, @UploadedFile() file: { buffer: Buffer } | undefined, @CurrentPlatformUser() u: PlatformPrincipal) {
    return this.settings.uploadAsset(kind, file, u.id);
  }

  @Delete("assets/:kind") @HttpCode(204) @PlatformRoles("SUPER_ADMIN")
  remove(@Param("kind", new ZodPipe(assetKindSchema)) kind: Kind, @CurrentPlatformUser() u: PlatformPrincipal) {
    return this.settings.removeAsset(kind, u.id);
  }
}
