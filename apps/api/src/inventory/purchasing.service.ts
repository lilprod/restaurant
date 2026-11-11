import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { purchaseLineTotal } from "@restaurant/utils";
import type {
  ListPurchaseOrdersQuery, PurchaseOrderInput, PurchaseOrderUpdate, ReceivePurchaseInput, SupplierInput, SupplierUpdate,
} from "@restaurant/validation";
import { PrismaService, Tx } from "../prisma/prisma.service";
import type { Account } from "../security/accounts.repo";
import { StockChange, StockService } from "./stock.service";

const D = Prisma.Decimal;

const poInclude = {
  supplier: { select: { id: true, name: true, phone: true, email: true } },
  lines: { include: { ingredient: { select: { id: true, name: true, unit: true } } }, orderBy: { id: "asc" } },
} satisfies Prisma.PurchaseOrderInclude;
type PoRow = Prisma.PurchaseOrderGetPayload<{ include: typeof poInclude }>;

export function purchaseOrderView(p: PoRow) {
  const lines = p.lines
    .map((l) => ({
      id: l.id, ingredient: l.ingredient, quantity: Number(l.quantity), receivedQty: Number(l.receivedQty), unitCost: l.unitCost,
      total: purchaseLineTotal(Number(l.quantity), l.unitCost),
    }))
    .sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name, "fr"));
  return {
    id: p.id, status: p.status, supplier: p.supplier, expectedAt: p.expectedAt, sentAt: p.sentAt, receivedAt: p.receivedAt,
    cancelledAt: p.cancelledAt, notes: p.notes, total: p.total, createdAt: p.createdAt, updatedAt: p.updatedAt, lines,
    receivedValue: lines.reduce((s, l) => s + purchaseLineTotal(l.receivedQty, l.unitCost), 0),
  };
}

const supplierView = (s: Prisma.SupplierGetPayload<{ include: { _count: { select: { ingredients: true } } } }>) => ({
  id: s.id, name: s.name, contact: s.contact, email: s.email, phone: s.phone, address: s.address, notes: s.notes,
  isActive: s.isActive, ingredientCount: s._count.ingredients, createdAt: s.createdAt,
});

/** Fournisseurs et commandes fournisseurs (brouillon → envoyée → reçue partiellement / totalement). */
@Injectable()
export class PurchasingService {
  constructor(private readonly prisma: PrismaService, private readonly stock: StockService) {}

  // ── Fournisseurs ──

  async suppliers(tenantId: string, all: boolean) {
    const rows = await this.prisma.asTenant(tenantId, (tx) => tx.supplier.findMany({
      where: { tenantId, ...(all ? {} : { isActive: true }) }, orderBy: { name: "asc" }, include: { _count: { select: { ingredients: true } } },
    }));
    return rows.map(supplierView);
  }

  async createSupplier(tenantId: string, input: SupplierInput) {
    return this.prisma.asTenant(tenantId, async (tx) => supplierView(await tx.supplier.create({ data: { tenantId, ...input }, include: { _count: { select: { ingredients: true } } } })));
  }

  async updateSupplier(tenantId: string, id: string, patch: SupplierUpdate) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      await this.supplier(tx, tenantId, id);
      return supplierView(await tx.supplier.update({ where: { id }, data: patch, include: { _count: { select: { ingredients: true } } } }));
    });
  }

  /** Fournisseur référencé (ingrédients, commandes) → archivé ; sinon supprimé. */
  async removeSupplier(tenantId: string, id: string) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      await this.supplier(tx, tenantId, id);
      const used = await tx.ingredient.count({ where: { supplierId: id } }) + await tx.purchaseOrder.count({ where: { supplierId: id } });
      if (used) {
        await tx.supplier.update({ where: { id }, data: { isActive: false } });
        return { archived: true };
      }
      await tx.supplier.delete({ where: { id } });
      return { deleted: true };
    });
  }

  // ── Commandes fournisseurs ──

  async list(tenantId: string, q: ListPurchaseOrdersQuery) {
    const rows = await this.prisma.asTenant(tenantId, (tx) => tx.purchaseOrder.findMany({
      where: { tenantId, ...(q.status ? { status: q.status } : {}), ...(q.supplierId ? { supplierId: q.supplierId } : {}) },
      include: poInclude, orderBy: { createdAt: "desc" }, take: 200,
    }));
    return rows.map(purchaseOrderView);
  }

  async get(tenantId: string, id: string) {
    return this.prisma.asTenant(tenantId, async (tx) => purchaseOrderView(await this.load(tx, tenantId, id)));
  }

  async create(acc: Account, input: PurchaseOrderInput) {
    const tenantId = acc.tenantId!;
    return this.prisma.asTenant(tenantId, async (tx) => {
      await this.supplier(tx, tenantId, input.supplierId, true);
      await this.checkIngredients(tx, tenantId, input.lines.map((l) => l.ingredientId));
      const po = await tx.purchaseOrder.create({
        data: {
          tenantId, supplierId: input.supplierId, createdById: acc.id, expectedAt: input.expectedAt, notes: input.notes,
          total: input.lines.reduce((s, l) => s + purchaseLineTotal(l.quantity, l.unitCost), 0),
          lines: { create: input.lines.map((l) => ({ tenantId, ingredientId: l.ingredientId, quantity: l.quantity, unitCost: l.unitCost })) },
        },
      });
      return purchaseOrderView(await this.load(tx, tenantId, po.id));
    });
  }

  async update(acc: Account, id: string, patch: PurchaseOrderUpdate) {
    const tenantId = acc.tenantId!;
    return this.prisma.asTenant(tenantId, async (tx) => {
      const po = await this.lock(tx, tenantId, id);
      if (po.status !== "DRAFT") throw new ConflictException("Seul un brouillon peut être modifié");
      if (patch.supplierId) await this.supplier(tx, tenantId, patch.supplierId, true);
      const { lines, ...fields } = patch;
      if (lines) {
        await this.checkIngredients(tx, tenantId, lines.map((l) => l.ingredientId));
        await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
        await tx.purchaseOrderLine.createMany({ data: lines.map((l) => ({ tenantId, purchaseOrderId: id, ingredientId: l.ingredientId, quantity: l.quantity, unitCost: l.unitCost })) });
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: { ...fields, ...(lines ? { total: lines.reduce((s, l) => s + purchaseLineTotal(l.quantity, l.unitCost), 0) } : {}) },
      });
      return purchaseOrderView(await this.load(tx, tenantId, id));
    });
  }

  async send(acc: Account, id: string) {
    const tenantId = acc.tenantId!;
    return this.prisma.asTenant(tenantId, async (tx) => {
      const po = await this.lock(tx, tenantId, id);
      if (po.status !== "DRAFT") throw new ConflictException("Cette commande a déjà été envoyée");
      await tx.purchaseOrder.update({ where: { id }, data: { status: "SENT", sentAt: new Date() } });
      return purchaseOrderView(await this.load(tx, tenantId, id));
    });
  }

  /**
   * Réception (partielle ou totale), sous verrou de la commande : mouvements PURCHASE, stock et coût moyen pondéré
   * (prix réel éventuellement corrigé), quantités reçues cumulées ; statut PARTIAL tant qu'une ligne n'est pas soldée.
   */
  async receive(acc: Account, id: string, input: ReceivePurchaseInput) {
    const tenantId = acc.tenantId!;
    let effects;
    const view = await this.prisma.asTenant(tenantId, async (tx) => {
      const po = await this.lock(tx, tenantId, id);
      if (!["DRAFT", "SENT", "PARTIAL"].includes(po.status)) throw new ConflictException(po.status === "RECEIVED" ? "Cette commande est déjà entièrement reçue" : "Cette commande est annulée");
      const full = await this.load(tx, tenantId, id);
      const changes: StockChange[] = [];
      for (const r of input.lines) {
        const line = full.lines.find((l) => l.id === r.lineId);
        if (!line) throw new BadRequestException("Ligne absente de cette commande");
        if (r.quantity <= 0) continue;
        const unitCost = r.unitCost ?? line.unitCost;
        changes.push({
          ingredientId: line.ingredientId, delta: new D(r.quantity), type: "PURCHASE", purchaseOrderId: id, purchaseUnitCost: unitCost,
          reason: `Réception — ${full.supplier.name}`,
        });
        await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQty: { increment: r.quantity }, unitCost } });
      }
      effects = await this.stock.apply(tx, tenantId, acc.id, changes);
      const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: id } });
      const done = lines.every((l) => new D(l.receivedQty).gte(l.quantity));
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: done ? "RECEIVED" : "PARTIAL", receivedAt: new Date(), sentAt: po.sentAt ?? new Date(),
          total: lines.reduce((s, l) => s + purchaseLineTotal(Number(l.quantity), l.unitCost), 0),
        },
      });
      await tx.auditLog.create({
        data: { tenantId, userId: acc.id, action: "purchase.receive", entity: "PurchaseOrder", entityId: id, metadata: { supplier: full.supplier.name, lines: changes.length, complete: done } },
      });
      return purchaseOrderView(await this.load(tx, tenantId, id));
    });
    await this.stock.publish(tenantId, effects);
    return view;
  }

  async cancel(acc: Account, id: string) {
    const tenantId = acc.tenantId!;
    return this.prisma.asTenant(tenantId, async (tx) => {
      const po = await this.lock(tx, tenantId, id);
      if (po.status === "RECEIVED" || po.status === "CANCELLED") throw new ConflictException("Cette commande ne peut plus être annulée");
      await tx.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "purchase.cancel", entity: "PurchaseOrder", entityId: id, metadata: { status: po.status } } });
      return purchaseOrderView(await this.load(tx, tenantId, id));
    });
  }

  // ── interne ──

  private async load(tx: Tx, tenantId: string, id: string) {
    const po = await tx.purchaseOrder.findFirst({ where: { id, tenantId }, include: poInclude });
    if (!po) throw new NotFoundException("Commande fournisseur introuvable");
    return po;
  }

  private async lock(tx: Tx, tenantId: string, id: string) {
    const rows = await tx.$queryRaw<{ id: string; status: string; sentAt: Date | null }[]>`
      SELECT id, status, "sentAt" FROM "PurchaseOrder" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException("Commande fournisseur introuvable");
    return rows[0];
  }

  private async supplier(tx: Tx, tenantId: string, id: string, activeOnly = false) {
    const s = await tx.supplier.findFirst({ where: { id, tenantId, ...(activeOnly ? { isActive: true } : {}) } });
    if (!s) throw new NotFoundException("Fournisseur introuvable");
    return s;
  }

  private async checkIngredients(tx: Tx, tenantId: string, ids: string[]) {
    const n = await tx.ingredient.count({ where: { tenantId, isActive: true, id: { in: ids } } });
    if (n !== new Set(ids).size) throw new NotFoundException("Ingrédient introuvable");
  }
}
