import { Injectable, NotFoundException } from "@nestjs/common";
import type { Tenant } from "@prisma/client";
import {
  brandingInputSchema, businessSchema, localizationSchema, operationsSchema, tenantSecuritySchema,
} from "@restaurant/validation";
import { PrismaService } from "../prisma/prisma.service";
import { SecurityPolicyService } from "../security/security-policy.service";
import { Actor } from "../security/account-admin.service";
import { ASSET_RULES, validateImage } from "../storage/image-validation";
import { StorageService } from "../storage/storage.service";
import { Assets, composeBranding } from "./branding";
import {
  DEFAULT_LOCALIZATION, DEFAULT_OPERATIONS, DEFAULT_TENANT_SECURITY, defaultBranding,
} from "./defaults";
import { SectionDef, SettingsEngine } from "./settings.engine";

export const TENANT_SECTIONS = ["business", "branding", "operations", "localization", "security"] as const;

const formatAddress = (a: { street?: string; postalCode?: string; city?: string; country?: string }) =>
  [a.street, [a.postalCode, a.city].filter(Boolean).join(" "), a.country].filter(Boolean).join(", ") || null;

/** Paramètres d'un restaurant : informations, marque & thème, exploitation, localisation, sécurité. */
@Injectable()
export class TenantSettingsService extends SettingsEngine<Tenant> {
  protected readonly sections: Record<string, SectionDef<Tenant>> = {
    business: {
      schema: businessSchema,
      defaults: (t) => ({
        tradeName: t.name, phone: t.phone ?? undefined, email: t.email, address: {}, social: {},
        receipt: { showLogo: true, showTaxId: true },
      }),
    },
    branding: { schema: brandingInputSchema, defaults: (t) => defaultBranding(t.name) },
    operations: { schema: operationsSchema, defaults: () => DEFAULT_OPERATIONS },
    localization: { schema: localizationSchema, defaults: (t) => ({ ...DEFAULT_LOCALIZATION, locale: t.locale, timezone: t.timezone }) },
    security: { schema: tenantSecuritySchema, defaults: () => DEFAULT_TENANT_SECURITY },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: SecurityPolicyService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  protected async read(key: string, t: Tenant) {
    const row = await this.prisma.asTenant(t.id, (tx) => tx.setting.findUnique({ where: { tenantId_key: { tenantId: t.id, key } } }));
    return row?.value ?? null;
  }

  protected async write(key: string, value: unknown, t: Tenant) {
    await this.prisma.asTenant(t.id, (tx) =>
      tx.setting.upsert({
        where: { tenantId_key: { tenantId: t.id, key } },
        create: { tenantId: t.id, key, value: value as object },
        update: { value: value as object },
      }),
    );
  }

  async tenant(id: string): Promise<Tenant> {
    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException("Restaurant introuvable");
    return t;
  }

  private async assets(t: Tenant): Promise<Assets> {
    return ((await this.read("assets", t)) as Assets | null) ?? {};
  }

  async all(tenantId: string) {
    const t = await this.tenant(tenantId);
    const entries = await Promise.all(TENANT_SECTIONS.map(async (s) => [s, await this.getSection(s, t)] as const));
    const assets = await this.assets(t);
    return {
      ...Object.fromEntries(entries),
      assets,
      currency: t.currency,
      branding: { ...(Object.fromEntries(entries).branding as object), assets },
    };
  }

  async get(tenantId: string, section: string) {
    const t = await this.tenant(tenantId);
    const value = await this.getSection(section, t);
    return section === "branding"
      ? { ...value, assets: await this.assets(t), preview: composeBranding(value, await this.assets(t)) }
      : value;
  }

  async update(tenantId: string, section: string, patch: unknown, actor: Actor) {
    const t = await this.tenant(tenantId);
    const value = await this.patchSection(section, patch, t);

    // Les champs d'identité du restaurant restent synchronisés avec la fiche du tenant (listes SuperAdmin).
    if (section === "business") {
      await this.prisma.tenant.update({
        where: { id: t.id },
        data: { name: value.tradeName, phone: value.phone ?? null, email: value.email ?? t.email, address: formatAddress(value.address) },
      });
    } else if (section === "localization") {
      await this.prisma.tenant.update({ where: { id: t.id }, data: { locale: value.locale, timezone: value.timezone } });
    } else if (section === "security") {
      this.policies.invalidate("tenant", t.id);
    }
    await this.audit(t.id, actor, `settings.${section}.update`);
    return this.get(tenantId, section);
  }

  async uploadAsset(tenantId: string, kind: "logo" | "logoDark" | "favicon", file: { buffer: Buffer } | undefined, actor: Actor) {
    const t = await this.tenant(tenantId);
    const type = validateImage(file?.buffer, ASSET_RULES[kind]);
    const assets = await this.assets(t);
    const url = await this.storage.save(`tenants/${t.id}`, kind, file!.buffer, type);
    await this.write("assets", { ...assets, [kind]: url }, t);
    await this.storage.remove(assets[kind]);
    await this.audit(t.id, actor, `settings.asset.${kind}`);
    return { kind, url };
  }

  async removeAsset(tenantId: string, kind: "logo" | "logoDark" | "favicon", actor: Actor) {
    const t = await this.tenant(tenantId);
    const assets = await this.assets(t);
    await this.write("assets", { ...assets, [kind]: null }, t);
    await this.storage.remove(assets[kind]);
    await this.audit(t.id, actor, `settings.asset.${kind}.remove`);
  }

  /** Marque affichée avant connexion (page de login du restaurant), via son sous-domaine. */
  async publicBranding(slug: string) {
    const t = await this.prisma.tenant.findUnique({ where: { slug: slug.toLowerCase() } });
    if (!t || t.status === "CANCELLED" || t.status === "PENDING") throw new NotFoundException("Restaurant introuvable");
    const branding = await this.getSection("branding", t);
    return { slug: t.slug, name: t.name, locale: t.locale, ...composeBranding(branding, await this.assets(t)) };
  }

  private async audit(tenantId: string, actor: Actor, action: string) {
    if (actor.kind === "platform") {
      await this.prisma.platformAuditLog.create({ data: { actorId: actor.id, action, entity: "Tenant", entityId: tenantId } });
    } else {
      await this.prisma.asTenant(tenantId, (tx) => tx.auditLog.create({ data: { tenantId, userId: actor.id, action, entity: "Setting" } }));
    }
  }
}
