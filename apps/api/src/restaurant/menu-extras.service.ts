import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { availabilityAt, bestPromotion, type PromotionRule } from "@restaurant/utils";
import type { FormulaInput, FormulaUpdateInput, PromotionInput } from "@restaurant/validation";
import { Clock } from "../common/clock";
import { PrismaService, Tx } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import { TenantSettingsService } from "../settings/tenant-settings.service";

const formulaInclude = {
  steps: { orderBy: { sortOrder: "asc" }, include: { items: { include: { menuItem: { select: { id: true, name: true, price: true, isAvailable: true, archivedAt: true } } } } } },
} satisfies Prisma.FormulaInclude;
type FormulaRow = Prisma.FormulaGetPayload<{ include: typeof formulaInclude }>;

export const formulaView = (f: FormulaRow) => ({
  id: f.id, name: f.name, description: f.description, price: f.price, isActive: f.isActive,
  availableFrom: f.availableFrom, availableTo: f.availableTo, sortOrder: f.sortOrder,
  steps: f.steps.map((s) => ({
    id: s.id, name: s.name, minChoices: s.minChoices, maxChoices: s.maxChoices,
    items: s.items
      .filter((i) => !i.menuItem.archivedAt)
      .map((i) => ({ menuItemId: i.menuItemId, name: i.menuItem.name, price: i.menuItem.price, isAvailable: i.menuItem.isAvailable })),
  })),
});
export type FormulaView = ReturnType<typeof formulaView>;

export const promotionView = (p: Prisma.PromotionGetPayload<object>) => ({
  id: p.id, name: p.name, kind: p.kind, value: p.value, menuItemId: p.menuItemId, categoryId: p.categoryId,
  startsOn: p.startsOn, endsOn: p.endsOn, days: p.days, fromTime: p.fromTime, toTime: p.toTime, isActive: p.isActive,
});
export type PromotionView = ReturnType<typeof promotionView>;

/** Formules (menus à prix fixe) et promotions : gestion par les responsables, lecture pour la prise de commande et la carte publique. */
@Injectable()
export class MenuExtrasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: TenantSettingsService,
    private readonly realtime: RealtimeService,
    private readonly clock: Clock,
  ) {}

  /** Signal temps réel : les écrans rechargent formules et promotions. */
  private changed(tenantId: string, kind: "formula" | "promotion") {
    this.realtime.emit(tenantId, "menu.extras.updated", { kind });
  }

  // ── Formules ──

  async formulas(tenantId: string) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      const rows = await tx.formula.findMany({ where: { tenantId, archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: formulaInclude });
      return rows.map(formulaView);
    });
  }

  async createFormula(tenantId: string, input: FormulaInput) {
    const view = await this.prisma.asTenant(tenantId, async (tx) => {
      await this.checkSteps(tx, tenantId, input.steps);
      const { steps, ...fields } = input;
      const f = await tx.formula.create({ data: { tenantId, ...this.hours(fields) } });
      await this.writeSteps(tx, tenantId, f.id, steps);
      return formulaView(await tx.formula.findUniqueOrThrow({ where: { id: f.id }, include: formulaInclude }));
    });
    this.changed(tenantId, "formula");
    return view;
  }

  async updateFormula(tenantId: string, id: string, patch: FormulaUpdateInput) {
    const view = await this.prisma.asTenant(tenantId, async (tx) => {
      const cur = await tx.formula.findFirst({ where: { id, tenantId, archivedAt: null } });
      if (!cur) throw new NotFoundException("Formule introuvable");
      const { steps, ...fields } = patch;
      this.assertHours({ availableFrom: fields.availableFrom === undefined ? cur.availableFrom : fields.availableFrom, availableTo: fields.availableTo === undefined ? cur.availableTo : fields.availableTo });
      if (steps) await this.checkSteps(tx, tenantId, steps);
      await tx.formula.update({ where: { id }, data: this.hours(fields) });
      if (steps) await this.writeSteps(tx, tenantId, id, steps);
      return formulaView(await tx.formula.findUniqueOrThrow({ where: { id }, include: formulaInclude }));
    });
    this.changed(tenantId, "formula");
    return view;
  }

  /** Une formule déjà commandée est archivée (historique conservé), sinon supprimée. */
  async deleteFormula(tenantId: string, id: string) {
    const out = await this.prisma.asTenant(tenantId, async (tx) => {
      const f = await tx.formula.findFirst({ where: { id, tenantId, archivedAt: null } });
      if (!f) throw new NotFoundException("Formule introuvable");
      if (await tx.orderItem.count({ where: { formulaId: id } })) {
        await tx.formula.update({ where: { id }, data: { archivedAt: new Date(), isActive: false } });
        return { archived: true };
      }
      await tx.formula.delete({ where: { id } });
      return { deleted: true };
    });
    this.changed(tenantId, "formula");
    return out;
  }

  private hours<T extends { availableFrom?: string | null; availableTo?: string | null }>(f: T): T {
    return { ...f, ...(f.availableFrom !== undefined || f.availableTo !== undefined ? { availableFrom: f.availableFrom || null, availableTo: f.availableTo || null } : {}) };
  }

  private assertHours(f: { availableFrom?: string | null; availableTo?: string | null }) {
    if (!f.availableFrom !== !f.availableTo) throw new BadRequestException("Renseignez les deux heures (de / à) ou aucune");
  }

  /** Les plats proposés existent et ne demandent pas d'options obligatoires (non gérées dans une formule). */
  private async checkSteps(tx: Tx, tenantId: string, steps: FormulaInput["steps"]) {
    const ids = [...new Set(steps.flatMap((s) => s.menuItemIds))];
    const dishes = await tx.menuItem.findMany({ where: { id: { in: ids }, tenantId, archivedAt: null }, include: { optionGroups: { where: { archivedAt: null, minChoices: { gt: 0 } } } } });
    if (dishes.length !== ids.length) throw new NotFoundException("Plat introuvable");
    const needy = dishes.find((d) => d.optionGroups.length);
    if (needy) throw new ConflictException(`« ${needy.name} » exige des options : il ne peut pas être proposé dans une formule`);
    for (const s of steps) if (s.minChoices > new Set(s.menuItemIds).size) throw new BadRequestException(`« ${s.name} » : pas assez de plats pour le minimum demandé`);
  }

  /** Étapes remplacées en bloc (les commandes conservent le nom d'étape et de plat figés). */
  private async writeSteps(tx: Tx, tenantId: string, formulaId: string, steps: FormulaInput["steps"]) {
    await tx.formulaStep.deleteMany({ where: { formulaId } });
    for (const [i, s] of steps.entries()) {
      await tx.formulaStep.create({
        data: {
          tenantId, formulaId, name: s.name, minChoices: s.minChoices, maxChoices: s.maxChoices, sortOrder: i,
          items: { create: [...new Set(s.menuItemIds)].map((menuItemId) => ({ tenantId, menuItemId })) },
        },
      });
    }
  }

  // ── Promotions ──

  async promotions(tenantId: string) {
    return this.prisma.asTenant(tenantId, async (tx) => (await tx.promotion.findMany({ where: { tenantId, archivedAt: null }, orderBy: { createdAt: "desc" } })).map(promotionView));
  }

  async createPromotion(tenantId: string, input: PromotionInput) {
    const view = await this.prisma.asTenant(tenantId, async (tx) => {
      await this.checkTarget(tx, tenantId, input);
      return promotionView(await tx.promotion.create({ data: this.promoData(tenantId, input) }));
    });
    this.changed(tenantId, "promotion");
    return view;
  }

  async updatePromotion(tenantId: string, id: string, input: PromotionInput) {
    const view = await this.prisma.asTenant(tenantId, async (tx) => {
      await this.promo(tx, tenantId, id);
      await this.checkTarget(tx, tenantId, input);
      const { tenantId: _t, ...data } = this.promoData(tenantId, input);
      return promotionView(await tx.promotion.update({ where: { id }, data }));
    });
    this.changed(tenantId, "promotion");
    return view;
  }

  async setPromotionActive(tenantId: string, id: string, isActive: boolean) {
    const view = await this.prisma.asTenant(tenantId, async (tx) => {
      await this.promo(tx, tenantId, id);
      return promotionView(await tx.promotion.update({ where: { id }, data: { isActive } }));
    });
    this.changed(tenantId, "promotion");
    return view;
  }

  /** Les lignes de commande gardent le nom et la remise figés : la promotion peut être supprimée. */
  async deletePromotion(tenantId: string, id: string) {
    await this.prisma.asTenant(tenantId, async (tx) => {
      await this.promo(tx, tenantId, id);
      await tx.promotion.delete({ where: { id } });
    });
    this.changed(tenantId, "promotion");
    return { deleted: true };
  }

  private async promo(tx: Tx, tenantId: string, id: string) {
    const p = await tx.promotion.findFirst({ where: { id, tenantId, archivedAt: null } });
    if (!p) throw new NotFoundException("Promotion introuvable");
    return p;
  }

  private async checkTarget(tx: Tx, tenantId: string, i: PromotionInput) {
    if (i.menuItemId && !(await tx.menuItem.findFirst({ where: { id: i.menuItemId, tenantId, archivedAt: null } }))) throw new NotFoundException("Plat introuvable");
    if (i.categoryId && !(await tx.category.findFirst({ where: { id: i.categoryId, tenantId } }))) throw new NotFoundException("Catégorie introuvable");
  }

  private promoData(tenantId: string, i: PromotionInput) {
    return {
      tenantId, name: i.name, kind: i.kind, value: i.value, menuItemId: i.menuItemId || null, categoryId: i.menuItemId ? null : i.categoryId || null,
      startsOn: i.startsOn || null, endsOn: i.endsOn || null, days: [...new Set(i.days)].sort(), fromTime: i.fromTime || null, toTime: i.toTime || null,
      isActive: i.isActive,
    };
  }

  // ── Carte publique ──

  /** Formules disponibles maintenant (ou grisées hors horaires) et promotions en cours, pour la carte publique. */
  async publicExtras(tenantId: string) {
    const tz = (await this.settings.tenant(tenantId)).timezone;
    const now = this.clock.now();
    const [formulas, promos] = await Promise.all([this.formulas(tenantId), this.promotions(tenantId)]);
    return {
      timezone: tz,
      formulas: formulas
        .filter((f) => f.isActive)
        .map((f) => ({
          id: f.id, name: f.name, description: f.description, price: f.price, availableFrom: f.availableFrom, availableTo: f.availableTo,
          availableNow: availabilityAt({ availableFrom: f.availableFrom, availableTo: f.availableTo }, now, tz).available,
          steps: f.steps.map((s) => ({ id: s.id, name: s.name, minChoices: s.minChoices, maxChoices: s.maxChoices, items: s.items.filter((i) => i.isAvailable).map((i) => ({ menuItemId: i.menuItemId, name: i.name })) })),
        }))
        .filter((f) => f.steps.every((s) => s.items.length >= s.minChoices)),
      /** Prix remisé d'un plat à cet instant (null si aucune promotion). */
      promotionFor: (dish: { id: string; categoryId: string; price: number }) =>
        bestPromotion(dish.price, dish, promos as PromotionRule[], now, tz),
      now,
      tz,
    };
  }
}
