import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CategoryInput, MenuItemInput } from "@restaurant/validation";
import { availabilityAt } from "@restaurant/utils";
import { PrismaService, Tx } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import { MenuExtrasService } from "./menu-extras.service";
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
  vatRate: Number(i.vatRate), imageUrl: i.imageUrl, prepMinutes: i.prepMinutes, isAvailable: i.isAvailable, availableFrom: i.availableFrom, availableTo: i.availableTo,
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
    private readonly realtime: RealtimeService,
    private readonly extras: MenuExtrasService,
  ) {}

  /** Diffuse `menu.updated` (charge utile = `menuItemView`) une fois la transaction terminée. */
  private broadcast<T>(tenantId: string, view: T): T {
    this.realtime.emit(tenantId, "menu.updated", view);
    return view;
  }

  /** Diffuse l'état courant de plats modifiés hors de ce service (ex. rendus indisponibles par le stock). */
  async broadcastItems(tenantId: string, ids: string[]) {
    if (!ids.length) return;
    const rows = await this.prisma.asTenant(tenantId, (tx) => tx.menuItem.findMany({ where: { tenantId, id: { in: ids } }, include: itemInclude }));
    for (const r of rows) this.broadcast(tenantId, menuItemView(r));
  }

  private async viewOf(tenantId: string, id: string) {
    return this.prisma.asTenant(tenantId, async (tx) => menuItemView(await tx.menuItem.findUniqueOrThrow({ where: { id }, include: itemInclude })));
  }

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
    const extras = await this.extras.publicExtras(tenant.id);
    return {
      restaurant: { name: tenant.name, slug: tenant.slug, currency: tenant.currency },
      categories: cats.filter((c) => c.items.length).map((c) => ({
        id: c.id, name: c.name, description: c.description,
        items: c.items.map((i) => {
          const { sortOrder: _s, archived: _a, isAvailable: _v, vatRate: _r, prepMinutes: _p, ...pub } = menuItemView(i);
          // Hors de sa plage horaire : le plat reste affiché mais grisé ; en promotion : prix remisé et nom de l'offre.
          const promo = extras.promotionFor({ id: i.id, categoryId: i.categoryId, price: i.price });
          return {
            ...pub,
            availableNow: availabilityAt(i, extras.now, extras.tz).available,
            promotion: promo ? { name: promo.name, unitPrice: promo.unitPrice } : null,
          };
        }),
      })),
      formulas: extras.formulas,
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
    this.assertHours(input);
    const vatRate = input.vatRate ?? (await this.defaultVat(tenantId));
    const view = await this.prisma.asTenant(tenantId, async (tx) => {
      await this.category(tx, tenantId, input.categoryId);
      const item = await tx.menuItem.create({
        data: {
          tenantId, categoryId: input.categoryId, name: input.name, description: input.description, price: input.price,
          vatRate, prepMinutes: input.prepMinutes, isAvailable: input.isAvailable, availableFrom: input.availableFrom || null, availableTo: input.availableTo || null, isDishOfDay: input.isDishOfDay, sortOrder: input.sortOrder,
        },
      });
      await this.writeRelations(tx, tenantId, item.id, input.allergenCodes, input.optionGroups);
      return menuItemView(await tx.menuItem.findUniqueOrThrow({ where: { id: item.id }, include: itemInclude }));
    });
    return this.broadcast(tenantId, view);
  }

  async updateItem(tenantId: string, id: string, patch: Partial<MenuItemInput>) {
    const view = await this.prisma.asTenant(tenantId, async (tx) => {
      const cur = await this.item(tx, tenantId, id);
      if (patch.categoryId) await this.category(tx, tenantId, patch.categoryId);
      const { allergenCodes, optionGroups, ...fields } = patch;
      this.assertHours({
        availableFrom: fields.availableFrom === undefined ? cur.availableFrom : fields.availableFrom,
        availableTo: fields.availableTo === undefined ? cur.availableTo : fields.availableTo,
      });
      const hours = { ...(fields.availableFrom !== undefined ? { availableFrom: fields.availableFrom || null } : {}), ...(fields.availableTo !== undefined ? { availableTo: fields.availableTo || null } : {}) };
      await tx.menuItem.update({ where: { id }, data: { ...fields, ...hours } });
      await this.writeRelations(tx, tenantId, id, allergenCodes, optionGroups);
      return menuItemView(await tx.menuItem.findUniqueOrThrow({ where: { id }, include: itemInclude }));
    });
    return this.broadcast(tenantId, view);
  }

  /** Disponibilité (« épuisé ») : la cuisine peut la changer en plein service. */
  async setAvailability(tenantId: string, id: string, isAvailable: boolean) {
    const view = await this.prisma.asTenant(tenantId, async (tx) => {
      await this.item(tx, tenantId, id);
      return menuItemView(await tx.menuItem.update({ where: { id }, data: { isAvailable }, include: itemInclude }));
    });
    return this.broadcast(tenantId, view);
  }

  /** Un plat déjà commandé est retiré de la carte (historique conservé), sinon supprimé. */
  async deleteItem(tenantId: string, id: string) {
    const item = await this.prisma.asTenant(tenantId, async (tx) => {
      const i = await this.item(tx, tenantId, id);
      if (await tx.orderItem.count({ where: { menuItemId: id } })) {
        const row = await tx.menuItem.update({ where: { id }, data: { archivedAt: new Date(), isAvailable: false }, include: itemInclude });
        return { ...i, archived: true, view: menuItemView(row) };
      }
      await tx.menuItem.delete({ where: { id } });
      return { ...i, archived: false, view: null };
    });
    // Plat retiré de la carte : `archived: true` ; plat supprimé : `{ id, deleted: true }`.
    this.realtime.emit(tenantId, "menu.updated", item.view ?? { id, deleted: true });
    if (!item.archived) await this.storage.remove(item.imageUrl);
    return item.archived ? { archived: true } : { deleted: true };
  }

  async uploadImage(tenantId: string, id: string, file: { buffer: Buffer } | undefined) {
    const type = validateImage(file?.buffer, ASSET_RULES.menuPhoto);
    const prev = await this.prisma.asTenant(tenantId, (tx) => this.item(tx, tenantId, id));
    const url = await this.storage.save(`tenants/${tenantId}/menu`, "plat", file!.buffer, type);
    await this.prisma.asTenant(tenantId, (tx) => tx.menuItem.update({ where: { id }, data: { imageUrl: url } }));
    await this.storage.remove(prev.imageUrl);
    this.broadcast(tenantId, await this.viewOf(tenantId, id));
    return { imageUrl: url };
  }

  async removeImage(tenantId: string, id: string) {
    const prev = await this.prisma.asTenant(tenantId, async (tx) => {
      const i = await this.item(tx, tenantId, id);
      await tx.menuItem.update({ where: { id }, data: { imageUrl: null } });
      return i;
    });
    await this.storage.remove(prev.imageUrl);
    this.broadcast(tenantId, await this.viewOf(tenantId, id));
  }

  private async item(tx: Tx, tenantId: string, id: string) {
    const i = await tx.menuItem.findFirst({ where: { id, tenantId, archivedAt: null } });
    if (!i) throw new NotFoundException("Plat introuvable");
    return i;
  }

  private assertHours(f: { availableFrom?: string | null; availableTo?: string | null }) {
    if (!f.availableFrom !== !f.availableTo) throw new BadRequestException("Renseignez les deux heures (de / à) ou aucune");
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
      const old = await tx.optionGroup.findMany({ where: { menuItemId: itemId, archivedAt: null }, include: { options: { include: { recipe: true, _count: { select: { orderOptions: true } } } } } });
      // Stock (P3) : les options sont recréées ; leurs recettes suivent l'option de même nom dans le groupe de même nom.
      const recipes = new Map(old.flatMap((g) => g.options.filter((o) => o.recipe.length).map((o) => [`${g.name}\u0000${o.name}`, o.recipe] as const)));
      const used = old.some((g) => g.options.some((o) => o._count.orderOptions > 0));
      if (used) {
        await tx.optionGroup.updateMany({ where: { menuItemId: itemId, archivedAt: null }, data: { archivedAt: new Date() } });
      } else {
        await tx.optionGroup.deleteMany({ where: { menuItemId: itemId, archivedAt: null } });
      }
      for (const [i, g] of groups.entries()) {
        const created = await tx.optionGroup.create({
          data: {
            tenantId, menuItemId: itemId, name: g.name, minChoices: g.minChoices, maxChoices: g.maxChoices, sortOrder: i,
            options: { create: g.options.map((o) => ({ tenantId, name: o.name, extra: o.extra })) },
          },
          include: { options: true },
        });
        for (const o of created.options) {
          const lines = recipes.get(`${g.name}\u0000${o.name}`);
          if (lines) await tx.optionRecipeLine.createMany({ data: lines.map((l) => ({ tenantId, optionId: o.id, ingredientId: l.ingredientId, quantity: l.quantity, unit: l.unit })) });
        }
      }
    }
  }
}
