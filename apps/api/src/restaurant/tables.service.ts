import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { TableInput } from "@restaurant/validation";
import { PrismaService, Tx } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import { PlanLimitsService } from "./plan-limits.service";

/** Tables de la salle. Le plan de salle visuel (positions, fusion) viendra avec les réservations. */
@Injectable()
export class TablesService {
  constructor(private readonly prisma: PrismaService, private readonly limits: PlanLimitsService, private readonly realtime: RealtimeService) {}

  private static readonly withOrders = {
    orders: {
      where: { closedAt: null, cancelledAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, number: true, status: true, total: true, paidAmount: true, paymentStatus: true, createdAt: true },
    },
  } satisfies Prisma.RestaurantTableInclude;

  private static view = ({ orders, posX, posY, shape, rotation, mergedIntoId, minCapacity, floorPlanId, ...t }: Prisma.RestaurantTableGetPayload<{ include: typeof TablesService.withOrders }>) =>
    ({ ...t, openOrders: orders });

  /** Diffuse `table.updated` (même forme qu'un élément de `GET /tenant/tables`) ; à appeler après la transaction. */
  async broadcast(tenantId: string, id: string) {
    const row = await this.prisma.asTenant(tenantId, (tx) => tx.restaurantTable.findFirst({ where: { id, tenantId }, include: TablesService.withOrders }));
    if (row) this.realtime.emit(tenantId, "table.updated", TablesService.view(row));
  }

  /** Chaque restaurant a au moins une salle ; elle est créée à la première table. */
  private async floorPlan(tx: Tx, tenantId: string) {
    return (await tx.floorPlan.findFirst({ where: { tenantId }, orderBy: { name: "asc" } }))
      ?? tx.floorPlan.create({ data: { tenantId, name: "Salle principale", width: 1000, height: 700 } });
  }

  /** Tables avec la commande en cours (s'il y en a une). */
  async list(tenantId: string, includeInactive = false) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      const tables = await tx.restaurantTable.findMany({
        where: { tenantId, ...(includeInactive ? {} : { isActive: true }) },
        orderBy: [{ label: "asc" }],
        include: TablesService.withOrders,
      });
      return tables.sort((a, b) => a.label.localeCompare(b.label, "fr", { numeric: true })).map(TablesService.view);
    });
  }

  async create(tenantId: string, input: TableInput) {
    const created = await this.prisma.asTenant(tenantId, async (tx) => {
      await this.limits.assertCanAdd(tenantId, "tables", await tx.restaurantTable.count({ where: { tenantId, isActive: true } }));
      const plan = await this.floorPlan(tx, tenantId);
      if (await tx.restaurantTable.findFirst({ where: { floorPlanId: plan.id, label: input.label } })) throw new ConflictException(`La table « ${input.label} » existe déjà`);
      const n = await tx.restaurantTable.count({ where: { floorPlanId: plan.id } });
      return tx.restaurantTable.create({
        data: { tenantId, floorPlanId: plan.id, label: input.label, capacity: input.capacity, isActive: input.isActive, posX: 40 + (n % 8) * 110, posY: 40 + Math.floor(n / 8) * 110 },
      });
    });
    await this.broadcast(tenantId, created.id);
    return created;
  }

  async update(tenantId: string, id: string, patch: Partial<TableInput> & { status?: string }) {
    const updated = await this.prisma.asTenant(tenantId, async (tx) => {
      const t = await tx.restaurantTable.findFirst({ where: { id, tenantId } });
      if (!t) throw new NotFoundException("Table introuvable");
      if (patch.isActive === true && !t.isActive) {
        await this.limits.assertCanAdd(tenantId, "tables", await tx.restaurantTable.count({ where: { tenantId, isActive: true } }));
      }
      if (patch.label && patch.label !== t.label && await tx.restaurantTable.findFirst({ where: { floorPlanId: t.floorPlanId, label: patch.label } })) {
        throw new ConflictException(`La table « ${patch.label} » existe déjà`);
      }
      if (patch.status === "FREE" || patch.isActive === false) {
        const open = await tx.order.count({ where: { tableId: id, closedAt: null, cancelledAt: null } });
        if (open) throw new ConflictException("Une commande est encore ouverte sur cette table");
      }
      return tx.restaurantTable.update({ where: { id }, data: patch as never });
    });
    await this.broadcast(tenantId, id);
    return updated;
  }

  /** Une table qui a déjà servi est désactivée (historique des commandes), sinon supprimée. */
  async remove(tenantId: string, id: string) {
    const res = await this.prisma.asTenant(tenantId, async (tx) => {
      const t = await tx.restaurantTable.findFirst({ where: { id, tenantId }, include: { _count: { select: { orders: true } } } });
      if (!t) throw new NotFoundException("Table introuvable");
      if (t._count.orders > 0) {
        const open = await tx.order.count({ where: { tableId: id, closedAt: null, cancelledAt: null } });
        if (open) throw new ConflictException("Une commande est encore ouverte sur cette table");
        await tx.restaurantTable.update({ where: { id }, data: { isActive: false } });
        return { archived: true };
      }
      await tx.restaurantTable.delete({ where: { id } });
      return { deleted: true };
    });
    // Archivée : `table.updated` avec isActive=false ; supprimée : `{ id, deleted: true }`.
    if ("deleted" in res) this.realtime.emit(tenantId, "table.updated", { id, deleted: true });
    else await this.broadcast(tenantId, id);
    return res;
  }

  /**
   * Recalcule le statut d'une table d'après ses commandes ouvertes (appelé par les commandes).
   * Retourne `true` si le statut a changé : l'appelant diffuse alors `broadcast` après la transaction.
   */
  async syncStatus(tx: Tx, tableId: string | null): Promise<boolean> {
    if (!tableId) return false;
    const open = await tx.order.count({ where: { tableId, closedAt: null, cancelledAt: null } });
    const t = await tx.restaurantTable.findUnique({ where: { id: tableId } });
    if (!t) return false;
    if (open > 0 && t.status !== "OCCUPIED") { await tx.restaurantTable.update({ where: { id: tableId }, data: { status: "OCCUPIED" } }); return true; }
    if (open === 0 && t.status === "OCCUPIED") { await tx.restaurantTable.update({ where: { id: tableId }, data: { status: "FREE" } }); return true; }
    return false;
  }
}
