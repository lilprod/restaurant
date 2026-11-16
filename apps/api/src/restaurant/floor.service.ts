import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { FloorPlanInput, LayoutInput } from "@restaurant/validation";
import { PrismaService, Tx } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import type { Account } from "../security/accounts.repo";
import { TablesService } from "./tables.service";

const MIN = 60_000;
/** Une table ne peut pas être absorbée si une réservation y est en cours ou commence dans ce délai. */
const MERGE_RESERVATION_HORIZON_MINUTES = 120;
const natural = (a: string, b: string) => a.localeCompare(b, "fr", { numeric: true });

type PlanRow = { id: string; name: string; width: number; height: number };

/** Salles, mise en page des tables, fusion et séparation de tables. Événements : `floorplan.updated`, `table.updated`. */
@Injectable()
export class FloorService {
  constructor(private readonly prisma: PrismaService, private readonly tables: TablesService, private readonly realtime: RealtimeService) {}

  private planView(p: PlanRow, tableCount: number) {
    return { id: p.id, name: p.name, width: p.width, height: p.height, tableCount };
  }

  private async audit(tx: Tx, acc: Account, action: string, entity: string, entityId: string, metadata: Prisma.InputJsonValue) {
    await tx.auditLog.create({ data: { tenantId: acc.tenantId!, userId: acc.id, action, entity, entityId, metadata } });
  }

  // ── Salles ──

  async listPlans(tenantId: string) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      const plans = await tx.floorPlan.findMany({ where: { tenantId }, include: { _count: { select: { tables: { where: { isActive: true } } } } } });
      return plans.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || natural(a.name, b.name)).map((p) => this.planView(p, p._count.tables));
    });
  }

  private async planOrThrow(tx: Tx, tenantId: string, id: string) {
    const p = await tx.floorPlan.findFirst({ where: { id, tenantId } });
    if (!p) throw new NotFoundException("Salle introuvable");
    return p;
  }

  private async assertNameFree(tx: Tx, tenantId: string, name: string, exceptId?: string) {
    const same = await tx.floorPlan.findFirst({ where: { tenantId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
    if (same) throw new ConflictException(`Une salle « ${same.name} » existe déjà`);
  }

  async createPlan(acc: Account, input: FloorPlanInput) {
    const tenantId = acc.tenantId!;
    const view = await this.prisma.asTenant(tenantId, async (tx) => {
      await this.assertNameFree(tx, tenantId, input.name);
      const p = await tx.floorPlan.create({ data: { tenantId, name: input.name, width: input.width, height: input.height } });
      await this.audit(tx, acc, "floorplan.create", "FloorPlan", p.id, { name: p.name });
      return this.planView(p, 0);
    });
    this.realtime.emit(tenantId, "floorplan.updated", view);
    return view;
  }

  async updatePlan(acc: Account, id: string, patch: Partial<FloorPlanInput>) {
    const tenantId = acc.tenantId!;
    const view = await this.prisma.asTenant(tenantId, async (tx) => {
      const p = await this.planOrThrow(tx, tenantId, id);
      if (patch.name) await this.assertNameFree(tx, tenantId, patch.name, id);
      const width = patch.width ?? p.width, height = patch.height ?? p.height;
      const tables = await tx.restaurantTable.findMany({ where: { floorPlanId: id, tenantId }, select: { label: true, posX: true, posY: true, width: true, height: true } });
      const out = tables.find((t) => t.posX + t.width > width || t.posY + t.height > height);
      if (out) throw new ConflictException(`La table ${out.label} dépasserait de la salle : déplacez-la d'abord`);
      const updated = await tx.floorPlan.update({ where: { id }, data: { name: patch.name, width, height } });
      await this.audit(tx, acc, "floorplan.update", "FloorPlan", id, { name: updated.name, width, height });
      return this.planView(updated, tables.length);
    });
    this.realtime.emit(tenantId, "floorplan.updated", view);
    return view;
  }

  async removePlan(acc: Account, id: string) {
    const tenantId = acc.tenantId!;
    await this.prisma.asTenant(tenantId, async (tx) => {
      const p = await this.planOrThrow(tx, tenantId, id);
      if ((await tx.floorPlan.count({ where: { tenantId } })) <= 1) throw new ConflictException("Gardez au moins une salle");
      const n = await tx.restaurantTable.count({ where: { floorPlanId: id, tenantId } });
      if (n) throw new ConflictException(`Cette salle contient encore ${n} table${n > 1 ? "s" : ""} : retirez-les d'abord`);
      await tx.floorPlan.delete({ where: { id } });
      await this.audit(tx, acc, "floorplan.delete", "FloorPlan", id, { name: p.name });
    });
    this.realtime.emit(tenantId, "floorplan.updated", { id, deleted: true });
    return { deleted: true };
  }

  // ── Mise en page (enregistrement en lot) ──

  /** Enregistre positions, tailles, formes et rotations d'une salle ; diffuse `table.updated` pour les tables modifiées. */
  async saveLayout(acc: Account, planId: string, input: LayoutInput) {
    const tenantId = acc.tenantId!;
    const changed: string[] = [];
    await this.prisma.asTenant(tenantId, async (tx) => {
      const plan = await this.planOrThrow(tx, tenantId, planId);
      const rows = await tx.restaurantTable.findMany({ where: { floorPlanId: planId, tenantId } });
      const byId = new Map(rows.map((r) => [r.id, r]));
      const seen = new Set<string>();
      for (const e of input.tables) {
        const row = byId.get(e.id);
        if (!row) throw new NotFoundException("Table introuvable dans cette salle");
        if (seen.has(e.id)) throw new BadRequestException("Une table apparaît deux fois dans la mise en page");
        seen.add(e.id);
        if (e.posX + e.width > plan.width || e.posY + e.height > plan.height) {
          throw new BadRequestException(`La table ${row.label} sort de la salle (${plan.width} × ${plan.height})`);
        }
        const same = row.posX === e.posX && row.posY === e.posY && row.width === e.width && row.height === e.height && row.shape === e.shape && row.rotation === e.rotation;
        if (same) continue;
        await tx.restaurantTable.update({ where: { id: e.id }, data: { posX: e.posX, posY: e.posY, width: e.width, height: e.height, shape: e.shape, rotation: e.rotation } });
        changed.push(e.id);
      }
      if (changed.length) await this.audit(tx, acc, "floorplan.layout", "FloorPlan", planId, { name: plan.name, tables: changed.length });
    });
    for (const id of changed) await this.tables.broadcast(tenantId, id);
    return this.prisma.asTenant(tenantId, async (tx) => {
      const rows = await tx.restaurantTable.findMany({ where: { floorPlanId: planId, tenantId }, include: TablesService.includeForView });
      return rows.sort((a, b) => natural(a.label, b.label)).map(TablesService.view);
    });
  }

  // ── Fusion et séparation ──

  /** Réunit des tables d'une même salle : la table principale cumule les capacités, la commande reste unique. */
  async merge(acc: Account, tableIds: string[]) {
    const tenantId = acc.tenantId!;
    const ids = [...new Set(tableIds)];
    if (ids.length < 2) throw new BadRequestException("Choisissez au moins deux tables");
    let primaryId = "";
    let touched: string[] = [];
    await this.prisma.asTenant(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "RestaurantTable" WHERE "tenantId" = ${tenantId} AND id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
      const rows = await tx.restaurantTable.findMany({ where: { id: { in: ids }, tenantId }, include: { mergedTables: { select: { id: true } } } });
      if (rows.length !== ids.length) throw new NotFoundException("Table introuvable");
      const order = new Map(ids.map((id, i) => [id, i]));
      rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      for (const r of rows) {
        if (!r.isActive) throw new ConflictException(`La table ${r.label} est désactivée`);
        if (r.mergedIntoId) throw new ConflictException(`La table ${r.label} est déjà fusionnée : séparez-la d'abord`);
      }
      if (new Set(rows.map((r) => r.floorPlanId)).size > 1) throw new ConflictException("Les tables doivent être dans la même salle");

      const open = await tx.order.findMany({ where: { tenantId, tableId: { in: ids }, closedAt: null, cancelledAt: null }, select: { tableId: true } });
      const withOrders = new Set(open.map((o) => o.tableId!));
      if (withOrders.size > 1) {
        const labels = rows.filter((r) => withOrders.has(r.id)).map((r) => r.label).join(", ");
        throw new ConflictException(`Des commandes sont ouvertes sur plusieurs tables (${labels}) : transférez-les sur une seule table d'abord`);
      }
      const primary = rows.find((r) => withOrders.has(r.id)) ?? rows.find((r) => r.mergedTables.length) ?? rows[0]!;
      const absorbed = rows.filter((r) => r.id !== primary.id);
      const busy = absorbed.find((r) => r.status === "OCCUPIED");
      if (busy) throw new ConflictException(`La table ${busy.label} est occupée : elle ne peut pas être fusionnée`);

      const now = new Date();
      const soon = await tx.reservationTable.findFirst({
        where: { tenantId, tableId: { in: absorbed.map((r) => r.id) }, active: true, endsAt: { gt: now }, startsAt: { lt: new Date(now.getTime() + MERGE_RESERVATION_HORIZON_MINUTES * MIN) } },
        include: { table: { select: { label: true } } },
      });
      if (soon) throw new ConflictException(`La table ${soon.table.label} a une réservation en cours ou dans les ${MERGE_RESERVATION_HORIZON_MINUTES / 60} heures : fusion impossible`);

      const absorbedIds = absorbed.map((r) => r.id);
      // Une table déjà principale qui est absorbée cède ses propres tables à la nouvelle principale.
      await tx.restaurantTable.updateMany({ where: { tenantId, mergedIntoId: { in: absorbedIds } }, data: { mergedIntoId: primary.id } });
      await tx.restaurantTable.updateMany({ where: { id: { in: absorbedIds }, tenantId }, data: { mergedIntoId: primary.id } });
      const group = await tx.restaurantTable.findMany({ where: { tenantId, OR: [{ id: primary.id }, { mergedIntoId: primary.id }] }, select: { id: true } });
      touched = group.map((g) => g.id);
      primaryId = primary.id;
      await this.audit(tx, acc, "table.merge", "RestaurantTable", primary.id, { tables: rows.map((r) => r.label), primary: primary.label });
    });
    for (const id of touched) await this.tables.broadcast(tenantId, id);
    return this.tables.get(tenantId, primaryId);
  }

  /** Sépare une table fusionnée (donner la principale ou l'une des tables absorbées). Refusé tant que la table est occupée. */
  async split(acc: Account, id: string) {
    const tenantId = acc.tenantId!;
    let touched: string[] = [];
    let primaryId = id;
    await this.prisma.asTenant(tenantId, async (tx) => {
      const t0 = await tx.restaurantTable.findFirst({ where: { id, tenantId } });
      if (!t0) throw new NotFoundException("Table introuvable");
      primaryId = t0.mergedIntoId ?? t0.id;
      await tx.$queryRaw`SELECT id FROM "RestaurantTable" WHERE "tenantId" = ${tenantId} AND (id = ${primaryId} OR "mergedIntoId" = ${primaryId}) ORDER BY id FOR UPDATE`;
      const primary = await tx.restaurantTable.findFirst({ where: { id: primaryId, tenantId }, include: { mergedTables: { select: { id: true } } } });
      if (!primary || !primary.mergedTables.length) throw new ConflictException("Cette table n'est pas fusionnée");
      const open = await tx.order.count({ where: { tenantId, tableId: primaryId, closedAt: null, cancelledAt: null } });
      if (open || primary.status === "OCCUPIED") throw new ConflictException(`La table ${primary.label} est occupée : encaissez ou libérez-la avant de séparer les tables`);
      touched = [primaryId, ...primary.mergedTables.map((m) => m.id)];
      await tx.restaurantTable.updateMany({ where: { tenantId, mergedIntoId: primaryId }, data: { mergedIntoId: null, status: "FREE" } });
      await this.audit(tx, acc, "table.split", "RestaurantTable", primaryId, { primary: primary.label, tables: primary.mergedTables.length + 1 });
    });
    for (const x of touched) await this.tables.broadcast(tenantId, x);
    return this.tables.get(tenantId, primaryId);
  }
}
