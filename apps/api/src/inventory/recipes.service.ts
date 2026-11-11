import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { canConvert, dishMargin, lineCostExact, recipeCost } from "@restaurant/utils";
import type { RecipeInput } from "@restaurant/validation";
import { PrismaService, Tx } from "../prisma/prisma.service";

const lineInclude = { ingredient: { select: { id: true, name: true, unit: true, avgCost: true, isActive: true } } } satisfies Prisma.RecipeLineInclude;
type LineRow = { ingredientId: string; quantity: Prisma.Decimal; unit: string | null; ingredient: { id: string; name: string; unit: string; avgCost: number; isActive: boolean } };

function linesView(rows: LineRow[]) {
  const lines = rows
    .map((l) => {
      const c = { quantity: Number(l.quantity), unit: l.unit, ingredient: l.ingredient };
      return {
        ingredientId: l.ingredientId, name: l.ingredient.name, quantity: c.quantity, unit: l.unit ?? l.ingredient.unit,
        ingredientUnit: l.ingredient.unit, avgCost: l.ingredient.avgCost, cost: Math.round(lineCostExact(c)), archived: !l.ingredient.isActive,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const cost = recipeCost(rows.map((l) => ({ quantity: Number(l.quantity), unit: l.unit, ingredient: l.ingredient })));
  return { lines, cost };
}

/** Recettes (fiches techniques) des plats et des options ; coût matière et marge. */
@Injectable()
export class RecipesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Recette d'un plat + recettes de ses options (éditeur de plat : coût et marge en direct). */
  async dish(tenantId: string, menuItemId: string) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      const item = await tx.menuItem.findFirst({
        where: { id: menuItemId, tenantId, archivedAt: null },
        include: {
          recipe: { include: lineInclude },
          optionGroups: { where: { archivedAt: null }, orderBy: { sortOrder: "asc" }, include: { options: { orderBy: { extra: "asc" }, include: { recipe: { include: lineInclude } } } } },
        },
      });
      if (!item) throw new NotFoundException("Plat introuvable");
      const { lines, cost } = linesView(item.recipe);
      return {
        menuItemId: item.id, name: item.name, price: item.price, vatRate: Number(item.vatRate), lines,
        ...dishMargin(item.price, Number(item.vatRate), cost),
        options: item.optionGroups.flatMap((g) => g.options.map((o) => ({ optionId: o.id, name: o.name, group: g.name, extra: o.extra, ...linesView(o.recipe) }))),
      };
    });
  }

  async setDish(tenantId: string, menuItemId: string, input: RecipeInput) {
    await this.prisma.asTenant(tenantId, async (tx) => {
      if (!(await tx.menuItem.findFirst({ where: { id: menuItemId, tenantId, archivedAt: null } }))) throw new NotFoundException("Plat introuvable");
      await this.checkLines(tx, tenantId, input);
      await tx.recipeLine.deleteMany({ where: { menuItemId } });
      if (input.lines.length) {
        await tx.recipeLine.createMany({ data: input.lines.map((l) => ({ tenantId, menuItemId, ingredientId: l.ingredientId, quantity: l.quantity, unit: l.unit ?? null })) });
      }
    });
    return this.dish(tenantId, menuItemId);
  }

  async option(tenantId: string, optionId: string) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      const o = await tx.option.findFirst({ where: { id: optionId, tenantId }, include: { group: true, recipe: { include: lineInclude } } });
      if (!o) throw new NotFoundException("Option introuvable");
      return { optionId: o.id, name: o.name, group: o.group.name, extra: o.extra, ...linesView(o.recipe) };
    });
  }

  async setOption(tenantId: string, optionId: string, input: RecipeInput) {
    await this.prisma.asTenant(tenantId, async (tx) => {
      if (!(await tx.option.findFirst({ where: { id: optionId, tenantId } }))) throw new NotFoundException("Option introuvable");
      await this.checkLines(tx, tenantId, input);
      await tx.optionRecipeLine.deleteMany({ where: { optionId } });
      if (input.lines.length) {
        await tx.optionRecipeLine.createMany({ data: input.lines.map((l) => ({ tenantId, optionId, ingredientId: l.ingredientId, quantity: l.quantity, unit: l.unit ?? null })) });
      }
    });
    return this.option(tenantId, optionId);
  }

  /** Coût matière et marge de tous les plats de la carte (réutilisable par les rapports). */
  async dishCosts(tenantId: string) {
    const items = await this.prisma.asTenant(tenantId, (tx) => tx.menuItem.findMany({
      where: { tenantId, archivedAt: null }, orderBy: [{ name: "asc" }],
      include: { category: { select: { name: true } }, recipe: { include: lineInclude } },
    }));
    return items.map((i) => {
      const { cost } = linesView(i.recipe);
      return {
        menuItemId: i.id, name: i.name, category: i.category.name, price: i.price, isAvailable: i.isAvailable,
        hasRecipe: i.recipe.length > 0, ...dishMargin(i.price, Number(i.vatRate), cost),
      };
    });
  }

  /** Ingrédients du restaurant, actifs, et unités compatibles (g ↔ kg, ml ↔ cl ↔ l, pièce). */
  private async checkLines(tx: Tx, tenantId: string, input: RecipeInput) {
    if (!input.lines.length) return;
    const ings = await tx.ingredient.findMany({ where: { tenantId, isActive: true, id: { in: input.lines.map((l) => l.ingredientId) } } });
    for (const [n, l] of input.lines.entries()) {
      const ing = ings.find((i) => i.id === l.ingredientId);
      if (!ing) throw new NotFoundException("Ingrédient introuvable");
      if (l.unit && !canConvert(l.unit, ing.unit)) {
        throw new BadRequestException({ message: "Données invalides", errors: [{ path: `lines.${n}.unit`, message: `Unité incompatible avec « ${ing.name} » (stocké en ${ing.unit})` }] });
      }
    }
  }
}
