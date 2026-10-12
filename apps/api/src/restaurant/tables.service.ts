import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { TableInput } from "@restaurant/validation";
import { PrismaService, Tx } from "../prisma/prisma.service";
import { PlanLimitsService } from "./plan-limits.service";

/** Tables de la salle. Le plan de salle visuel (positions, fusion) viendra avec les réservations. */
@Injectable()
export class TablesService {
  constructor(private readonly prisma: PrismaService, private readonly limits: PlanLimitsService) {}

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
        include: {
          orders: {
            where: { closedAt: null, cancelledAt: null },
            orderBy: { createdAt: "asc" },
            select: { id: true, number: true, status: true, total: true, paidAmount: true, paymentStatus: true, createdAt: true },
          },
        },
      });
      return tables
        .sort((a, b) => a.label.localeCompare(b.label, "fr", { numeric: true }))
        .map(({ orders, posX, posY, shape, rotation, mergedIntoId, minCapacity, floorPlanId, ...t }) => ({ ...t, openOrders: orders }));
    });
  }

  async create(tenantId: string, input: TableInput) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      await this.limits.assertCanAdd(tenantId, "tables", await tx.restaurantTable.count({ where: { tenantId, isActive: true } }));
      const plan = await this.floorPlan(tx, tenantId);
      if (await tx.restaurantTable.findFirst({ where: { floorPlanId: plan.id, label: input.label } })) throw new ConflictException(`La table « ${input.label} » existe déjà`);
      const n = await tx.restaurantTable.count({ where: { floorPlanId: plan.id } });
      return tx.restaurantTable.create({
        data: { tenantId, floorPlanId: plan.id, label: input.label, capacity: input.capacity, isActive: input.isActive, posX: 40 + (n % 8) * 110, posY: 40 + Math.floor(n / 8) * 110 },
      });
    });
  }

  async update(tenantId: string, id: string, patch: Partial<TableInput> & { status?: string }) {
    return this.prisma.asTenant(tenantId, async (tx) => {
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
  }

  /** Une table qui a déjà servi est désactivée (historique des commandes), sinon supprimée. */
  async remove(tenantId: string, id: string) {
    return this.prisma.asTenant(tenantId, async (tx) => {
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
  }

  /** Recalcule le statut d'une table d'après ses commandes ouvertes (appelé par les commandes). */
  async syncStatus(tx: Tx, tableId: string | null) {
    if (!tableId) return;
    const open = await tx.order.count({ where: { tableId, closedAt: null, cancelledAt: null } });
    const t = await tx.restaurantTable.findUnique({ where: { id: tableId } });
    if (!t) return;
    if (open > 0 && t.status !== "OCCUPIED") await tx.restaurantTable.update({ where: { id: tableId }, data: { status: "OCCUPIED" } });
    if (open === 0 && t.status === "OCCUPIED") await tx.restaurantTable.update({ where: { id: tableId }, data: { status: "FREE" } });
  }
}
