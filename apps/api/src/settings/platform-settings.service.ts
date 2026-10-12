import { Injectable } from "@nestjs/common";
import {
  brandingInputSchema, companySchema, licensingSettingsSchema, localizationSchema, paymentInstructionsSchema,
  platformSecuritySchema, LicensingSettings,
} from "@restaurant/validation";
import { PrismaService } from "../prisma/prisma.service";
import { SecurityPolicyService } from "../security/security-policy.service";
import { ASSET_RULES, validateImage } from "../storage/image-validation";
import { StorageService } from "../storage/storage.service";
import { Assets, composeBranding } from "./branding";
import {
  DEFAULT_LICENSING, DEFAULT_LOCALIZATION, DEFAULT_PAYMENT_INSTRUCTIONS, DEFAULT_PLATFORM_SECURITY, defaultBranding,
} from "./defaults";
import { SectionDef, SettingsEngine } from "./settings.engine";

export const PLATFORM_SECTIONS = ["branding", "company", "localization", "security", "paymentInstructions", "licensing"] as const;

/** Paramètres de la plateforme (l'éditeur du SaaS) : marque, société, sécurité, instructions de paiement, licences. */
@Injectable()
export class PlatformSettingsService extends SettingsEngine<void> {
  protected readonly sections: Record<string, SectionDef<void>> = {
    branding: { schema: brandingInputSchema, defaults: () => defaultBranding("Gestion Restaurant") },
    company: { schema: companySchema, defaults: () => ({ legalName: "Gestion Restaurant", address: {}, social: {} }) },
    localization: { schema: localizationSchema, defaults: () => DEFAULT_LOCALIZATION },
    security: { schema: platformSecuritySchema, defaults: () => DEFAULT_PLATFORM_SECURITY },
    paymentInstructions: { schema: paymentInstructionsSchema, defaults: () => DEFAULT_PAYMENT_INSTRUCTIONS },
    licensing: { schema: licensingSettingsSchema, defaults: () => DEFAULT_LICENSING },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: SecurityPolicyService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  protected async read(key: string) {
    return (await this.prisma.platformSetting.findUnique({ where: { key } }))?.value ?? null;
  }

  protected async write(key: string, value: unknown, _ctx: void, updatedById?: string) {
    await this.prisma.platformSetting.upsert({
      where: { key }, create: { key, value: value as object, updatedById }, update: { value: value as object, updatedById },
    });
  }

  private async assets(): Promise<Assets> {
    return ((await this.read("assets")) as Assets | null) ?? {};
  }

  async all() {
    const entries = await Promise.all(PLATFORM_SECTIONS.map(async (s) => [s, await this.getSection(s)] as const));
    return { ...Object.fromEntries(entries), assets: await this.assets() };
  }

  async get(section: string) {
    const value = await this.getSection(section);
    return section === "branding" ? { ...value, assets: await this.assets(), preview: composeBranding(value, await this.assets()) } : value;
  }

  async update(section: string, patch: unknown, actorId: string) {
    const value = await this.patchSection(section, patch);
    await this.write(section, value, undefined, actorId);
    if (section === "security") this.policies.invalidate("platform");
    await this.prisma.platformAuditLog.create({ data: { actorId, action: `settings.${section}.update`, entity: "PlatformSetting", entityId: section } });
    return this.get(section);
  }

  async graceDays(): Promise<number> {
    return ((await this.getSection("licensing")) as LicensingSettings).graceDays;
  }

  async uploadAsset(kind: "logo" | "logoDark" | "favicon", file: { buffer: Buffer } | undefined, actorId: string) {
    const type = validateImage(file?.buffer, ASSET_RULES[kind]);
    const assets = await this.assets();
    const url = await this.storage.save("platform", kind, file!.buffer, type);
    await this.write("assets", { ...assets, [kind]: url }, undefined, actorId);
    await this.storage.remove(assets[kind]);
    await this.prisma.platformAuditLog.create({ data: { actorId, action: `settings.asset.${kind}`, entity: "PlatformSetting", entityId: "assets" } });
    return { kind, url };
  }

  async removeAsset(kind: "logo" | "logoDark" | "favicon", actorId: string) {
    const assets = await this.assets();
    await this.write("assets", { ...assets, [kind]: null }, undefined, actorId);
    await this.storage.remove(assets[kind]);
    await this.prisma.platformAuditLog.create({ data: { actorId, action: `settings.asset.${kind}.remove`, entity: "PlatformSetting", entityId: "assets" } });
  }

  /** Marque de la plateforme + coordonnées de support, visibles sans connexion. */
  async publicBranding() {
    const branding = await this.getSection("branding");
    const company = await this.getSection("company");
    return {
      ...composeBranding(branding, await this.assets()),
      support: { email: company.supportEmail ?? company.email ?? null, phone: company.supportPhone ?? company.phone ?? null, website: company.website ?? null },
    };
  }

  async paymentInstructions() {
    return this.getSection("paymentInstructions");
  }
}
