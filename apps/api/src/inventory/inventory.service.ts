import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { canConvert, isLowStock } from "@restaurant/utils";
import type {
  CreateStockCountInput, IngredientInput, IngredientUpdate, ListIngredientsQuery, ListMovementsQuery, ListWasteQuery,
  StockAdjustInput, StockCountLinesInput, WasteInput,
} from "@restaurant/validation";
import { PrismaService, Tx } from "../prisma/prisma.service";
import type { Account } from "../security/accounts.repo";
import { IngredientView, UserNames, ingredientInclude, ingredientView, suggestedQty } from "./inventory.views";
import { StockService, toStockUnit } from "./stock.service";

const D = Prisma.Decimal;
const SEVERITY = { NEGATIVE: 0, OUT: 1, LOW: 2, OK: 3 } as const;

/** Stock : ingrédients, mouvements, pertes, inventaires physiques, alertes. */
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService, private readonly stock: StockService) {}

  // ── Ingrédients ──

  async list(tenantId: string, q: ListIngredientsQuery) {
    const rows = await this.prisma.asTenant(tenantId, (tx) => tx.ingredient.findMany({
      where: {
        tenantId, isActive: !q.archived,
        ...(q.search ? { name: { contains: q.search, mode: "insensitive" } } : {}),
        ...(q.category ? { category: q.category } : {}),
      },
      include: ingredientInclude, orderBy: { name: "asc" },
    }));
    const views = rows.map(ingredientView);
    if (!q.state) return views;
    return views.filter((v) => (q.state === "ALERT" ? v.state !== "OK" : v.state === q.state));
  }

  async get(tenantId: string, id: string) {
    return this.prisma.asTenant(tenantId, async (tx) => ingredientView(await this.find(tx, tenantId, id)));
  }

  async categories(tenantId: string) {
    const rows = await this.prisma.asTenant(tenantId, (tx) => tx.ingredient.findMany({
      where: { tenantId, category: { not: null } }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" },
    }));
    return rows.map((r) => r.category!);
  }

  async create(acc: Account, input: IngredientInput) {
    const tenantId = acc.tenantId!;
    const { initialQuantity, ...data } = input;
    let effects;
    const view = await this.prisma.asTenant(tenantId, async (tx) => {
      if (data.supplierId) await this.supplier(tx, tenantId, data.supplierId);
      const row = await tx.ingredient.create({ data: { tenantId, ...data } });
      if (initialQuantity) {
        effects = await this.stock.apply(tx, tenantId, acc.id, [{ ingredientId: row.id, delta: new D(initialQuantity), type: "ADJUSTMENT", reason: "Stock initial" }]);
      }
      return ingredientView(await this.find(tx, tenantId, row.id));
    });
    await this.stock.publish(tenantId, effects);
    return view;
  }

  async update(acc: Account, id: string, patch: IngredientUpdate) {
    const tenantId = acc.tenantId!;
    return this.prisma.asTenant(tenantId, async (tx) => {
      const cur = await this.find(tx, tenantId, id, true);
      if (patch.supplierId) await this.supplier(tx, tenantId, patch.supplierId);
      if (patch.unit && patch.unit !== cur.unit) {
        const used = await tx.stockMovement.count({ where: { ingredientId: id } })
          + await tx.recipeLine.count({ where: { ingredientId: id } }) + await tx.optionRecipeLine.count({ where: { ingredientId: id } });
        if (used) throw new ConflictException("L'unité ne peut plus être modifiée : cet ingrédient a déjà des mouvements ou des recettes");
      }
      const threshold = patch.lowStockThreshold ?? Number(cur.lowStockThreshold);
      // Seuil relevé ou abaissé : on réarme l'alerte si le stock n'est plus bas (pas d'alerte rétroactive).
      const lowAlertedAt = isLowStock(Number(cur.quantity), threshold) ? cur.lowAlertedAt : null;
      await tx.ingredient.update({ where: { id }, data: { ...patch, lowAlertedAt } });
      if (patch.isActive !== undefined && patch.isActive !== cur.isActive) {
        await this.audit(tx, acc, patch.isActive ? "inventory.ingredient.restore" : "inventory.ingredient.archive", id, { name: cur.name });
      }
      return ingredientView(await this.find(tx, tenantId, id, true));
    });
  }

  /** Jamais utilisé → supprimé ; sinon archivé (historique conservé). Refusé s'il figure dans une recette. */
  async remove(acc: Account, id: string) {
    const tenantId = acc.tenantId!;
    return this.prisma.asTenant(tenantId, async (tx) => {
      const cur = await this.find(tx, tenantId, id, true);
      const recipes = await tx.recipeLine.count({ where: { ingredientId: id } }) + await tx.optionRecipeLine.count({ where: { ingredientId: id } });
      if (recipes) throw new ConflictException(`« ${cur.name} » est utilisé dans ${recipes} recette(s) : retirez-le d'abord des recettes`);
      const history = await tx.stockMovement.count({ where: { ingredientId: id } }) + await tx.purchaseOrderLine.count({ where: { ingredientId: id } })
        + await tx.wasteRecord.count({ where: { ingredientId: id } }) + await tx.stockCountLine.count({ where: { ingredientId: id } });
      if (history) {
        await tx.ingredient.update({ where: { id }, data: { isActive: false } });
        await this.audit(tx, acc, "inventory.ingredient.archive", id, { name: cur.name });
        return { archived: true };
      }
      await tx.ingredient.delete({ where: { id } });
      return { deleted: true };
    });
  }

  /** Correction ponctuelle (mouvement ADJUSTMENT). */
  async adjust(acc: Account, id: string, input: StockAdjustInput) {
    const tenantId = acc.tenantId!;
    let effects;
    const view = await this.prisma.asTenant(tenantId, async (tx) => {
      const cur = await this.find(tx, tenantId, id);
      effects = await this.stock.apply(tx, tenantId, acc.id, [{ ingredientId: id, delta: new D(input.delta), type: "ADJUSTMENT", reason: input.reason }]);
      await this.audit(tx, acc, "inventory.adjust", id, { name: cur.name, delta: input.delta, reason: input.reason });
      return ingredientView(await this.find(tx, tenantId, id));
    });
    await this.stock.publish(tenantId, effects);
    return view;
  }

  // ── Mouvements ──

  async movements(tenantId: string, q: ListMovementsQuery) {
    const where: Prisma.StockMovementWhereInput = {
      tenantId,
      ...(q.ingredientId ? { ingredientId: q.ingredientId } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    };
    return this.prisma.asTenant(tenantId, async (tx) => {
      const [total, rows] = await Promise.all([
        tx.stockMovement.count({ where }),
        tx.stockMovement.findMany({
          where, include: { ingredient: { select: { id: true, name: true, unit: true } } },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        }),
      ]);
      const users = await this.users(tx, tenantId, rows.map((r) => r.userId));
      return {
        total, page: q.page, pageSize: q.pageSize,
        items: rows.map((m) => {
          const quantity = Number(m.quantity);
          return {
            id: m.id, type: m.type, ingredient: m.ingredient, quantity, balanceAfter: Number(m.balanceAfter), unitCost: m.unitCost,
            value: m.unitCost == null ? null : Math.round(quantity * m.unitCost), reason: m.reason, orderItemId: m.orderItemId,
            purchaseOrderId: m.purchaseOrderId, stockCountId: m.stockCountId, user: m.userId ? users.get(m.userId) ?? null : null, createdAt: m.createdAt,
          };
        }),
      };
    });
  }

  // ── Pertes ──

  async wasteList(tenantId: string, q: ListWasteQuery) {
    const where: Prisma.WasteRecordWhereInput = {
      tenantId, ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    };
    return this.prisma.asTenant(tenantId, async (tx) => {
      const [total, sum, rows] = await Promise.all([
        tx.wasteRecord.count({ where }),
        tx.wasteRecord.aggregate({ where, _sum: { cost: true } }),
        tx.wasteRecord.findMany({
          where, include: { ingredient: { select: { id: true, name: true, unit: true } } },
          orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        }),
      ]);
      const users = await this.users(tx, tenantId, rows.map((r) => r.recordedById));
      return {
        total, page: q.page, pageSize: q.pageSize, totalCost: sum._sum.cost ?? 0,
        items: rows.map((w) => ({
          id: w.id, ingredient: w.ingredient, quantity: Number(w.quantity), reason: w.reason, cost: w.cost,
          automatic: !!w.orderItemId, recordedBy: users.get(w.recordedById) ?? null, createdAt: w.createdAt,
        })),
      };
    });
  }

  /** Perte déclarée (cuisine ou responsables) : mouvement WASTE + perte valorisée au coût moyen. */
  async declareWaste(acc: Account, input: WasteInput) {
    const tenantId = acc.tenantId!;
    let effects;
    const record = await this.prisma.asTenant(tenantId, async (tx) => {
      const ing = await this.find(tx, tenantId, input.ingredientId);
      if (input.unit && !canConvert(input.unit, ing.unit)) throw new BadRequestException(`Unité incompatible avec « ${ing.name} » (${ing.unit})`);
      const q = toStockUnit(input.quantity, input.unit, ing.unit).toDecimalPlaces(3);
      if (q.lte(0)) throw new BadRequestException("Quantité trop faible pour l'unité de stock");
      const res = await this.stock.apply(tx, tenantId, acc.id, [{ ingredientId: ing.id, delta: q.neg(), type: "WASTE", reason: input.reason }]);
      effects = res;
      const w = await tx.wasteRecord.create({
        data: { tenantId, ingredientId: ing.id, quantity: q, reason: input.reason, recordedById: acc.id, cost: Math.round(q.toNumber() * ing.avgCost) },
      });
      await this.audit(tx, acc, "inventory.waste", w.id, { ingredient: ing.name, quantity: q.toNumber(), cost: w.cost, reason: input.reason });
      return { id: w.id, ingredient: { id: ing.id, name: ing.name, unit: ing.unit }, quantity: q.toNumber(), reason: w.reason, cost: w.cost, automatic: false, createdAt: w.createdAt };
    });
    await this.stock.publish(tenantId, effects);
    return record;
  }

  // ── Alertes ──

  /** Ingrédients actifs sous le seuil, épuisés ou négatifs (les plus graves d'abord), avec la quantité suggérée. */
  async alerts(tenantId: string) {
    const all = await this.list(tenantId, { state: "ALERT" });
    return all
      .sort((a, b) => SEVERITY[a.state] - SEVERITY[b.state] || a.name.localeCompare(b.name, "fr"))
      .map((i) => ({ ...i, suggestedQty: suggestedQty(i) }));
  }

  // ── Inventaire physique ──

  async counts(tenantId: string) {
    const rows = await this.prisma.asTenant(tenantId, (tx) => tx.stockCount.findMany({
      where: { tenantId }, orderBy: { createdAt: "desc" }, take: 50, include: { lines: { select: { countedQty: true } } },
    }));
    return rows.map(({ lines, ...c }) => ({
      id: c.id, status: c.status, category: c.category, notes: c.notes, varianceCost: c.varianceCost, createdAt: c.createdAt,
      validatedAt: c.validatedAt, lineCount: lines.length, countedCount: lines.filter((l) => l.countedQty != null).length,
    }));
  }

  async createCount(acc: Account, input: CreateStockCountInput) {
    const tenantId = acc.tenantId!;
    const id = await this.prisma.asTenant(tenantId, async (tx) => {
      // Un seul inventaire ouvert à la fois (verrou consultatif : deux créations simultanées).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stock-count:${tenantId}`}))`;
      if (await tx.stockCount.findFirst({ where: { tenantId, status: "OPEN" } })) throw new ConflictException("Un inventaire est déjà en cours : terminez-le ou annulez-le d'abord");
      const ings = await tx.ingredient.findMany({ where: { tenantId, isActive: true, ...(input.category ? { category: input.category } : {}) }, select: { id: true } });
      if (!ings.length) throw new ConflictException("Aucun ingrédient à compter");
      const c = await tx.stockCount.create({
        data: { tenantId, category: input.category, notes: input.notes, createdById: acc.id, lines: { create: ings.map((i) => ({ tenantId, ingredientId: i.id })) } },
      });
      return c.id;
    });
    return this.getCount(tenantId, id);
  }

  async getCount(tenantId: string, id: string) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      const c = await tx.stockCount.findFirst({
        where: { id, tenantId },
        include: { lines: { include: { ingredient: { select: { id: true, name: true, unit: true, category: true, quantity: true, avgCost: true } } } } },
      });
      if (!c) throw new NotFoundException("Inventaire introuvable");
      const lines = c.lines
        .map((l) => {
          const expected = c.status === "VALIDATED" && l.expectedQty != null ? Number(l.expectedQty) : Number(l.ingredient.quantity);
          const counted = l.countedQty == null ? null : Number(l.countedQty);
          const variance = counted == null ? null : Math.round((counted - expected) * 1000) / 1000;
          return {
            ingredient: { id: l.ingredient.id, name: l.ingredient.name, unit: l.ingredient.unit, category: l.ingredient.category },
            expectedQty: expected, countedQty: counted, variance, unitCost: l.ingredient.avgCost,
            varianceCost: l.varianceCost ?? (variance == null ? null : Math.round(variance * l.ingredient.avgCost)),
          };
        })
        .sort((a, b) => (a.ingredient.category ?? "").localeCompare(b.ingredient.category ?? "", "fr") || a.ingredient.name.localeCompare(b.ingredient.name, "fr"));
      return {
        id: c.id, status: c.status, category: c.category, notes: c.notes, createdAt: c.createdAt, validatedAt: c.validatedAt,
        varianceCost: c.status === "VALIDATED" ? c.varianceCost : lines.reduce((s, l) => s + (l.varianceCost ?? 0), 0), lines,
      };
    });
  }

  async saveCountLines(acc: Account, id: string, input: StockCountLinesInput) {
    const tenantId = acc.tenantId!;
    await this.prisma.asTenant(tenantId, async (tx) => {
      const c = await this.lockCount(tx, tenantId, id);
      if (c.status !== "OPEN") throw new ConflictException("Cet inventaire est clôturé");
      for (const l of input.lines) {
        const res = await tx.stockCountLine.updateMany({ where: { countId: id, ingredientId: l.ingredientId }, data: { countedQty: l.countedQty } });
        if (!res.count) throw new BadRequestException("Ingrédient absent de cet inventaire");
      }
    });
    return this.getCount(tenantId, id);
  }

  /** Validation : écart (compté − théorique, lu sous verrou) → mouvements ADJUSTMENT valorisés au coût moyen. */
  async validateCount(acc: Account, id: string) {
    const tenantId = acc.tenantId!;
    let effects;
    await this.prisma.asTenant(tenantId, async (tx) => {
      const c = await this.lockCount(tx, tenantId, id);
      if (c.status !== "OPEN") throw new ConflictException("Cet inventaire est déjà clôturé");
      const lines = await tx.stockCountLine.findMany({ where: { countId: id, countedQty: { not: null } } });
      if (!lines.length) throw new ConflictException("Saisissez au moins une quantité comptée avant de valider");
      const locked = new Map((await this.stock.lock(tx, tenantId, lines.map((l) => l.ingredientId))).map((r) => [r.id, r]));
      let total = 0;
      const changes = [];
      for (const l of lines) {
        const r = locked.get(l.ingredientId)!;
        const delta = new D(l.countedQty!).sub(r.quantity);
        const cost = Math.round(delta.toNumber() * r.avgCost);
        total += cost;
        await tx.stockCountLine.update({ where: { countId_ingredientId: { countId: id, ingredientId: l.ingredientId } }, data: { expectedQty: r.quantity, varianceCost: cost } });
        if (!delta.isZero()) changes.push({ ingredientId: l.ingredientId, delta, type: "ADJUSTMENT" as const, stockCountId: id, reason: "Inventaire physique" });
      }
      effects = await this.stock.apply(tx, tenantId, acc.id, changes);
      await tx.stockCount.update({ where: { id }, data: { status: "VALIDATED", validatedAt: new Date(), validatedById: acc.id, varianceCost: total } });
      await this.audit(tx, acc, "inventory.count.validate", id, { lines: lines.length, adjustments: changes.length, varianceCost: total });
    });
    await this.stock.publish(tenantId, effects);
    return this.getCount(tenantId, id);
  }

  async cancelCount(acc: Account, id: string) {
    const tenantId = acc.tenantId!;
    await this.prisma.asTenant(tenantId, async (tx) => {
      const c = await this.lockCount(tx, tenantId, id);
      if (c.status !== "OPEN") throw new ConflictException("Cet inventaire est déjà clôturé");
      await tx.stockCount.update({ where: { id }, data: { status: "CANCELLED" } });
    });
    return this.getCount(tenantId, id);
  }

  // ── interne ──

  private async find(tx: Tx, tenantId: string, id: string, includeArchived = false) {
    const i = await tx.ingredient.findFirst({ where: { id, tenantId, ...(includeArchived ? {} : { isActive: true }) }, include: ingredientInclude });
    if (!i) throw new NotFoundException("Ingrédient introuvable");
    return i;
  }

  private async supplier(tx: Tx, tenantId: string, id: string) {
    if (!(await tx.supplier.findFirst({ where: { id, tenantId } }))) throw new NotFoundException("Fournisseur introuvable");
  }

  private async lockCount(tx: Tx, tenantId: string, id: string) {
    const rows = await tx.$queryRaw<{ id: string; status: string }[]>`SELECT id, status FROM "StockCount" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException("Inventaire introuvable");
    return rows[0];
  }

  private async users(tx: Tx, tenantId: string, ids: (string | null)[]): Promise<UserNames> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map();
    const rows = await tx.user.findMany({ where: { tenantId, id: { in: unique } }, select: { id: true, firstName: true, lastName: true } });
    return new Map(rows.map((u) => [u.id, u]));
  }

  private audit(tx: Tx, acc: Account, action: string, entityId: string, metadata: Prisma.InputJsonObject) {
    return tx.auditLog.create({ data: { tenantId: acc.tenantId!, userId: acc.id, action, entity: action.split(".")[1] ?? "inventory", entityId, metadata } });
  }
}

export type { IngredientView };
