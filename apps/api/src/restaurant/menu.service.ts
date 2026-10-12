import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CategoryInput, MenuItemInput } from "@restaurant/validation";
import { PrismaService, Tx } from "../prisma/prisma.service";
import { LicenseGateService } from "../security/license-gate.service";
import { TenantSettingsService } from "../settings/tenant-settings.service";
import { ASSET_RULES, validateImage } from "../storage/image-validation";
import { StorageService } from "../storage/storage.service";

const itemInclude = {
  allergens: { include: { allergen: true } },
  optionGroups: { where: { archivedAt: null }, orderBy: { sortOrder: "asc" }, include: { options: { orderBy: { extra: "asc" } } } },
} satisfies Prisma.MenuItemInclude;

type ItemRow = Prisma.MenuItemGetPayload<{ include: typeof itemInclude }>;

export const menuItemView = (i: ItemRow) => ({
  id: i.id, categoryId: i.categoryId, name: i.name, description: i.description, price: i.price,
  vatRate: Number(i.vatRate), imageUrl: i.imageUrl, prepMinutes: i.prepMinutes, isAvailable: i.isAvailable,
  isDishOfDay: i.isDishOfDay, sortOrder: i.sortOrder, archived: !!i.archivedAt,
  allergens: i.allergens.map((a) => ({ code: a.allergen.code, name: a.allergen.name })),
  optionGroups: i.optionGroups.map((g) => ({
    id: g.id, name: g.name, minChoices: g.minChoices, maxChoices: g.maxChoices,
    options: g.options.map((o) => ({ id: o.id, name: o.name, extra: o.extra })),
  })),
});

/** Carte du restaurant : catégories, plats, options et suppléments, allergènes, photos. */
@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: TenantSettingsService,
    private readonly storage: StorageService,
    private readonly gate: LicenseGateService,
  ) {}

  allergens() {
    return this.prisma.allergen.findMany({ orderBy: { name: "asc" }, select: { code: true, name: true } });
  }

  /** Carte complète pour le personnel (plats indisponibles inclus, plats retirés exclus). */
  async full(tenantId: string) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      const cats = await tx.category.findMany({
        where: { tenantId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: { items: { where: { archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: itemInclude } },
      });
      return cats.map(({ items, tenantId: _t, ...c }) => ({ ...c, items: items.map(menuItemView) }));
    });
  }

  /** Carte publique (clients) : catégories actives, plats disponibles. */
  async publicMenu(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: slug.toLowerCase() } });
    if (!tenant) throw new NotFoundException("Restaurant introuvable");
    try { await this.gate.assertAccess(tenant.id); } catch { throw new NotFoundException("Carte indisponible"); }
    const cats = await this.prisma.asTenant(tenant.id, (tx) => tx.category.findMany({
      where: { tenantId: tenant.id, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { items: { where: { archivedAt: null, isAvailable: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: itemInclude } },
    }));
    return {
      restaurant: { name: tenant.name, slug: tenant.slug, currency: tenant.currency },
      categories: cats.filter((c) => c.items.length).map((c) => ({
        id: c.id, name: c.name, description: c.description,
        items: c.items.map((i) => {
          const { sortOrder: _s, archived: _a, isAvailable: _v, vatRate: _r, prepMinutes: _p, ...pub } = menuItemView(i);
          return pub;
        }),
      })),
    };
  }

  // ── Catégories ──
  createCategory(tenantId: string, input: CategoryInput) {
    return this.prisma.asTenant(tenantId, (tx) => tx.category.create({ data: { tenantId, ...input } }));
  }

  async updateCategory(tenantId: string, id: string, patch: Partial<CategoryInput>) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      await this.category(tx, tenantId, id);
      return tx.category.update({ where: { id }, data: patch });
    });
  }

  async deleteCategory(tenantId: string, id: string) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      await this.category(tx, tenantId, id);
      if (await tx.menuItem.count({ where: { categoryId: id, archivedAt: null } })) {
        throw new ConflictException("Cette catégorie contient encore des plats : déplacez-les ou retirez-les d'abord");
      }
      if (await tx.menuItem.count({ where: { categoryId: id } })) {
        await tx.category.update({ where: { id }, data: { isActive: false } });   // plats archivés rattachés : on masque
        return { archived: true };
      }
      await tx.category.delete({ where: { id } });
      return { deleted: true };
    });
  }

  /** Nouvel ordre d'affichage (catégories ou plats d'une catégorie). */
  async reorder(tenantId: string, kind: "categories" | "items", ids: string[]) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      for (const [i, id] of ids.entries()) {
        if (kind === "categories") await tx.category.updateMany({ where: { id, tenantId }, data: { sortOrder: i } });
        else await tx.menuItem.updateMany({ where: { id, tenantId }, data: { sortOrder: i } });
      }
      return { ok: true };
    });
  }

  private async category(tx: Tx, tenantId: string, id: string) {
    const c = await tx.category.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException("Catégorie introuvable");
    return c;
  }

  // ── Plats ──
  async createItem(tenantId: string, input: MenuItemInput) {
    const vatRate = input.vatRate ?? (await this.defaultVat(tenantId));
    return this.prisma.asTenant(tenantId, async (tx) => {
      await this.category(tx, tenantId, input.categoryId);
      const item = await tx.menuItem.create({
        data: {
          tenantId, categoryId: input.categoryId, name: input.name, description: input.description, price: input.price,
          vatRate, prepMinutes: input.prepMinutes, isAvailable: input.isAvailable, isDishOfDay: input.isDishOfDay, sortOrder: input.sortOrder,
        },
      });
      await this.writeRelations(tx, tenantId, item.id, input.allergenCodes, input.optionGroups);
      return menuItemView(await tx.menuItem.findUniqueOrThrow({ where: { id: item.id }, include: itemInclude }));
    });
  }

  async updateItem(tenantId: string, id: string, patch: Partial<MenuItemInput>) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      await this.item(tx, tenantId, id);
      if (patch.categoryId) await this.category(tx, tenantId, patch.categoryId);
      const { allergenCodes, optionGroups, ...fields } = patch;
      await tx.menuItem.update({ where: { id }, data: fields });
      await this.writeRelations(tx, tenantId, id, allergenCodes, optionGroups);
      return menuItemView(await tx.menuItem.findUniqueOrThrow({ where: { id }, include: itemInclude }));
    });
  }

  /** Disponibilité (« épuisé ») : la cuisine peut la changer en plein service. */
  async setAvailability(tenantId: string, id: string, isAvailable: boolean) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      await this.item(tx, tenantId, id);
      return menuItemView(await tx.menuItem.update({ where: { id }, data: { isAvailable }, include: itemInclude }));
    });
  }

  /** Un plat déjà commandé est retiré de la carte (historique conservé), sinon supprimé. */
  async deleteItem(tenantId: string, id: string) {
    const item = await this.prisma.asTenant(tenantId, async (tx) => {
      const i = await this.item(tx, tenantId, id);
      if (await tx.orderItem.count({ where: { menuItemId: id } })) {
        await tx.menuItem.update({ where: { id }, data: { archivedAt: new Date(), isAvailable: false } });
        return { ...i, archived: true };
      }
      await tx.menuItem.delete({ where: { id } });
      return { ...i, archived: false };
    });
    if (!item.archived) await this.storage.remove(item.imageUrl);
    return item.archived ? { archived: true } : { deleted: true };
  }

  async uploadImage(tenantId: string, id: string, file: { buffer: Buffer } | undefined) {
    const type = validateImage(file?.buffer, ASSET_RULES.menuPhoto);
    const prev = await this.prisma.asTenant(tenantId, (tx) => this.item(tx, tenantId, id));
    const url = await this.storage.save(`tenants/${tenantId}/menu`, "plat", file!.buffer, type);
    await this.prisma.asTenant(tenantId, (tx) => tx.menuItem.update({ where: { id }, data: { imageUrl: url } }));
    await this.storage.remove(prev.imageUrl);
    return { imageUrl: url };
  }

  async removeImage(tenantId: string, id: string) {
    const prev = await this.prisma.asTenant(tenantId, async (tx) => {
      const i = await this.item(tx, tenantId, id);
      await tx.menuItem.update({ where: { id }, data: { imageUrl: null } });
      return i;
    });
    await this.storage.remove(prev.imageUrl);
  }

  private async item(tx: Tx, tenantId: string, id: string) {
    const i = await tx.menuItem.findFirst({ where: { id, tenantId, archivedAt: null } });
    if (!i) throw new NotFoundException("Plat introuvable");
    return i;
  }

  private async defaultVat(tenantId: string): Promise<number> {
    const t = await this.settings.tenant(tenantId);
    return (await this.settings.getSection("operations", t)).defaultVatRate;
  }

  /** Allergènes et groupes d'options remplacés en bloc (undefined = inchangés). */
  private async writeRelations(tx: Tx, tenantId: string, itemId: string, codes?: string[], groups?: MenuItemInput["optionGroups"]) {
    if (codes) {
      const allergens = await tx.allergen.findMany({ where: { code: { in: codes } } });
      if (allergens.length !== new Set(codes).size) throw new ConflictException("Allergène inconnu");
      await tx.menuItemAllergen.deleteMany({ where: { menuItemId: itemId } });
      if (allergens.length) await tx.menuItemAllergen.createMany({ data: allergens.map((a) => ({ tenantId, menuItemId: itemId, allergenId: a.id })) });
    }
    if (groups) {
      // Les options déjà commandées restent référencées par les commandes : on ne supprime que les inutilisées.
      const old = await tx.optionGroup.findMany({ where: { menuItemId: itemId, archivedAt: null }, include: { options: { include: { _count: { select: { orderOptions: true } } } } } });
      const used = old.some((g) => g.options.some((o) => o._count.orderOptions > 0));
      if (used) {
        await tx.optionGroup.updateMany({ where: { menuItemId: itemId, archivedAt: null }, data: { archivedAt: new Date() } });
      } else {
        await tx.optionGroup.deleteMany({ where: { menuItemId: itemId, archivedAt: null } });
      }
      for (const [i, g] of groups.entries()) {
        await tx.optionGroup.create({
          data: {
            tenantId, menuItemId: itemId, name: g.name, minChoices: g.minChoices, maxChoices: g.maxChoices, sortOrder: i,
            options: { create: g.options.map((o) => ({ tenantId, name: o.name, extra: o.extra })) },
          },
        });
      }
    }
  }
}
