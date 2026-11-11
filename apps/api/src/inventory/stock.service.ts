import { Injectable, NotFoundException } from "@nestjs/common";
import { MovementType, Prisma } from "@prisma/client";
import { ItemStatus, isLowStock, stockState, unitFactor, weightedAvgCost } from "@restaurant/utils";
import { Tx } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import { MenuService } from "../restaurant/menu.service";

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/** Variation de stock à appliquer (delta signé, dans l'unité de stock de l'ingrédient). */
export type StockChange = {
  ingredientId: string;
  delta: Decimal;
  type: MovementType;
  reason?: string | null;
  orderItemId?: string;
  purchaseOrderId?: string;
  stockCountId?: string;
  /** Réception fournisseur : prix unitaire payé (met à jour le coût moyen pondéré). */
  purchaseUnitCost?: number;
};

/** État léger d'un ingrédient diffusé en temps réel (sans coûts : la salle reçoit aussi les événements). */
export type StockLight = { id: string; name: string; unit: string; quantity: number; lowStockThreshold: number; state: ReturnType<typeof stockState> };

/** Conséquences d'une transaction de stock, à diffuser une fois la transaction validée (voir `publish`). */
export type StockEffects = { updated: StockLight[]; lowAlerts: StockLight[]; disabledMenuItemIds: string[] };

type Locked = {
  id: string; name: string; unit: string; quantity: Decimal; lowStockThreshold: Decimal; avgCost: number;
  autoDisable: boolean; lowAlertedAt: Date | null;
};

/** Article de commande vu par le stock (plat, quantité, options choisies). */
export type StockItem = { id: string; menuItemId: string; quantity: number; options: { optionId: string }[] };
export type ItemTransition = { item: StockItem; from: ItemStatus; to: ItemStatus };

const LAUNCHED: ItemStatus[] = ["IN_PROGRESS", "READY"];
export const emptyEffects = (): StockEffects => ({ updated: [], lowAlerts: [], disabledMenuItemIds: [] });

const light = (r: Locked): StockLight => ({
  id: r.id, name: r.name, unit: r.unit, quantity: r.quantity.toNumber(), lowStockThreshold: r.lowStockThreshold.toNumber(),
  state: stockState(r.quantity.toNumber(), r.lowStockThreshold.toNumber()),
});

/**
 * Cœur du stock : toutes les variations passent par `apply` (verrou FOR UPDATE des ingrédients dans l'ordre des ID,
 * mouvements avec solde, coût moyen pondéré, alerte de stock bas une fois par franchissement, `autoDisable`).
 * Toujours appelé DANS la transaction de l'opération métier (commande, réception, perte, inventaire).
 */
@Injectable()
export class StockService {
  constructor(private readonly realtime: RealtimeService, private readonly menu: MenuService) {}

  /** Verrouille les ingrédients (ordre d'ID stable : pas d'interblocage entre deux transactions). */
  async lock(tx: Tx, tenantId: string, ids: string[]): Promise<Locked[]> {
    if (!ids.length) return [];
    const sorted = [...new Set(ids)].sort();
    return tx.$queryRaw<Locked[]>`
      SELECT id, name, unit, quantity, "lowStockThreshold", "avgCost", "autoDisable", "lowAlertedAt"
      FROM "Ingredient" WHERE "tenantId" = ${tenantId} AND id IN (${Prisma.join(sorted)})
      ORDER BY id FOR UPDATE`;
  }

  /** Applique des variations : mouvements (solde après chaque mouvement), quantités, coût moyen, alertes, plats à désactiver. */
  async apply(tx: Tx, tenantId: string, userId: string | null, changes: StockChange[]): Promise<StockEffects & { avgCost: Map<string, number> }> {
    const changed = changes.filter((c) => !c.delta.isZero());
    if (!changed.length) return { ...emptyEffects(), avgCost: new Map() };
    const rows = await this.lock(tx, tenantId, changed.map((c) => c.ingredientId));
    const byId = new Map(rows.map((r) => [r.id, { ...r, quantity: new D(r.quantity) }]));
    if (byId.size !== new Set(changed.map((c) => c.ingredientId)).size) throw new NotFoundException("Ingrédient introuvable");

    const movements: Prisma.StockMovementCreateManyInput[] = [];
    const deducted = new Set<string>();
    const now = Date.now();
    for (const [n, c] of changed.entries()) {
      const r = byId.get(c.ingredientId)!;
      let unitCost = r.avgCost;
      if (c.purchaseUnitCost !== undefined) {
        r.avgCost = weightedAvgCost(r.quantity.toNumber(), r.avgCost, c.delta.toNumber(), c.purchaseUnitCost);
        unitCost = c.purchaseUnitCost;
      }
      r.quantity = r.quantity.add(c.delta);
      if (c.delta.isNegative()) deducted.add(r.id);
      movements.push({
        tenantId, ingredientId: r.id, type: c.type, quantity: c.delta, balanceAfter: r.quantity, unitCost,
        orderItemId: c.orderItemId, purchaseOrderId: c.purchaseOrderId, stockCountId: c.stockCountId, userId, reason: c.reason ?? null,
        createdAt: new Date(now + n), // ordre stable des mouvements d'une même transaction
      });
    }
    await tx.stockMovement.createMany({ data: movements });

    const effects = emptyEffects();
    const zeroed: string[] = [];
    for (const r of byId.values()) {
      const q = r.quantity.toNumber();
      const low = isLowStock(q, r.lowStockThreshold.toNumber());
      // Une alerte par franchissement : on la note tant que le stock reste bas, on la réarme au-dessus du seuil.
      let lowAlertedAt = r.lowAlertedAt;
      if (low && !lowAlertedAt) { lowAlertedAt = new Date(); effects.lowAlerts.push(light(r)); }
      if (!low && lowAlertedAt) lowAlertedAt = null;
      await tx.ingredient.update({ where: { id: r.id }, data: { quantity: r.quantity, avgCost: r.avgCost, lowAlertedAt } });
      effects.updated.push(light(r));
      if (r.autoDisable && q <= 0 && deducted.has(r.id)) zeroed.push(r.id);
    }
    if (zeroed.length) effects.disabledMenuItemIds = await this.disableDishes(tx, tenantId, zeroed);
    return { ...effects, avgCost: new Map([...byId.values()].map((r) => [r.id, r.avgCost])) };
  }

  /** Plats disponibles dont la recette utilise un ingrédient épuisé (`autoDisable`) → indisponibles. */
  private async disableDishes(tx: Tx, tenantId: string, ingredientIds: string[]) {
    const items = await tx.menuItem.findMany({
      where: { tenantId, archivedAt: null, isAvailable: true, recipe: { some: { ingredientId: { in: ingredientIds } } } },
      select: { id: true }, orderBy: { id: "asc" },
    });
    for (const i of items) await tx.menuItem.update({ where: { id: i.id }, data: { isAvailable: false } });
    return items.map((i) => i.id);
  }

  /**
   * Stock d'une transition d'articles de commande (appelé dans la transaction verrouillée de `OrdersService.mutate`) :
   * - PENDING → IN_PROGRESS | READY : déduction (recette × quantité + recettes des options), une seule fois par article ;
   * - IN_PROGRESS | READY → PENDING : retour (mouvement RETURN de ce qui a réellement été déduit) ;
   * - article lancé → CANCELLED : la marchandise est perdue → RETURN puis WASTE (motif « annulation ») + perte valorisée.
   * Ce qui est restitué est calculé depuis les mouvements de l'article, pas depuis la recette actuelle (qui a pu changer).
   */
  async onItemTransitions(tx: Tx, tenantId: string, userId: string, orderNumber: number, transitions: ItemTransition[], cancelReason?: string) {
    const consume = transitions.filter((t) => t.from === "PENDING" && LAUNCHED.includes(t.to)).map((t) => t.item);
    const restore = transitions.filter((t) => t.to === "PENDING" && t.from !== "PENDING").map((t) => t.item);
    const cancel = transitions.filter((t) => t.to === "CANCELLED" && t.from !== "PENDING").map((t) => t.item);
    if (!consume.length && !restore.length && !cancel.length) return emptyEffects();

    const net = await this.netConsumed(tx, tenantId, [...consume, ...restore, ...cancel].map((i) => i.id));
    const changes: StockChange[] = [];
    const label = `Commande n° ${orderNumber}`;

    const toConsume = consume.filter((i) => !net.has(i.id));
    if (toConsume.length) {
      for (const [itemId, needs] of await this.requirements(tx, tenantId, toConsume)) {
        for (const [ingredientId, q] of needs) changes.push({ ingredientId, delta: q.neg(), type: "ORDER_DEDUCTION", orderItemId: itemId, reason: label });
      }
    }
    for (const i of restore) {
      for (const [ingredientId, q] of net.get(i.id) ?? []) changes.push({ ingredientId, delta: q, type: "RETURN", orderItemId: i.id, reason: `${label} : retour en attente` });
    }
    const wasted: { itemId: string; ingredientId: string; q: Decimal }[] = [];
    const why = `Annulation (${label})${cancelReason ? ` : ${cancelReason}` : ""}`.slice(0, 200);
    for (const i of cancel) {
      for (const [ingredientId, q] of net.get(i.id) ?? []) {
        changes.push({ ingredientId, delta: q, type: "RETURN", orderItemId: i.id, reason: why });
        changes.push({ ingredientId, delta: q.neg(), type: "WASTE", orderItemId: i.id, reason: why });
        wasted.push({ itemId: i.id, ingredientId, q });
      }
    }
    const { avgCost, ...effects } = await this.apply(tx, tenantId, userId, changes);
    if (wasted.length) {
      await tx.wasteRecord.createMany({
        data: wasted.map((w) => ({
          tenantId, ingredientId: w.ingredientId, quantity: w.q, reason: why, orderItemId: w.itemId, recordedById: userId,
          cost: Math.round(w.q.toNumber() * (avgCost.get(w.ingredientId) ?? 0)),
        })),
      });
    }
    return effects;
  }

  /** Quantité nette consommée par article et par ingrédient (déductions − retours), strictement positive. */
  private async netConsumed(tx: Tx, tenantId: string, itemIds: string[]) {
    const rows = await tx.stockMovement.groupBy({
      by: ["orderItemId", "ingredientId"],
      where: { tenantId, orderItemId: { in: itemIds }, type: { in: ["ORDER_DEDUCTION", "RETURN"] } },
      _sum: { quantity: true },
    });
    const out = new Map<string, Map<string, Decimal>>();
    for (const r of rows) {
      const consumed = new D(r._sum.quantity ?? 0).neg();
      if (!consumed.isPositive() || consumed.isZero()) continue;
      if (!out.has(r.orderItemId!)) out.set(r.orderItemId!, new Map());
      out.get(r.orderItemId!)!.set(r.ingredientId, consumed);
    }
    return out;
  }

  /** Besoins par article : recette du plat + recettes des options, × quantité, convertis dans l'unité de stock. */
  private async requirements(tx: Tx, tenantId: string, items: StockItem[]) {
    const [dish, opt] = await Promise.all([
      tx.recipeLine.findMany({ where: { tenantId, menuItemId: { in: [...new Set(items.map((i) => i.menuItemId))] } }, include: { ingredient: { select: { unit: true } } } }),
      tx.optionRecipeLine.findMany({ where: { tenantId, optionId: { in: [...new Set(items.flatMap((i) => i.options.map((o) => o.optionId)))] } }, include: { ingredient: { select: { unit: true } } } }),
    ]);
    const out = new Map<string, Map<string, Decimal>>();
    for (const i of items) {
      const lines = [...dish.filter((l) => l.menuItemId === i.menuItemId), ...opt.filter((l) => i.options.some((o) => o.optionId === l.optionId))];
      const needs = new Map<string, Decimal>();
      for (const l of lines) {
        const q = toStockUnit(l.quantity, l.unit, l.ingredient.unit).mul(i.quantity);
        needs.set(l.ingredientId, (needs.get(l.ingredientId) ?? new D(0)).add(q));
      }
      for (const [k, v] of needs) needs.set(k, v.toDecimalPlaces(3));
      if (needs.size) out.set(i.id, needs);
    }
    return out;
  }

  /** Diffuse les effets après la transaction : `stock.updated`, `stock.low`, `menu.updated` des plats désactivés. */
  async publish(tenantId: string, effects?: StockEffects | void) {
    if (!effects) return;
    if (effects.updated.length) this.realtime.emit(tenantId, "stock.updated", { ingredients: effects.updated });
    for (const a of effects.lowAlerts) {
      this.realtime.emit(tenantId, "stock.low", a);
      // TODO X1 (notifications) : notifier les responsables (ADMIN, MANAGER) du franchissement de seuil, par ex.
      // `notifications.notifyRoles(tenantId, ["ADMIN", "MANAGER"], "stock.low", { ingredientId: a.id, name: a.name, quantity: a.quantity, unit: a.unit })`.
      // Point d'accroche unique : `lowAlerts` ne contient un ingrédient qu'une fois par franchissement (Ingredient.lowAlertedAt).
    }
    if (effects.disabledMenuItemIds.length) await this.menu.broadcastItems(tenantId, effects.disabledMenuItemIds);
  }
}

/** Quantité convertie dans l'unité de stock (non arrondie : arrondir à 3 décimales au moment d'écrire). */
export function toStockUnit(quantity: Decimal | number, unit: string | null | undefined, stockUnit: string): Decimal {
  const q = new D(quantity);
  if (!unit || unit === stockUnit) return q;
  return q.mul(new D(unitFactor(unit, stockUnit)));
}
