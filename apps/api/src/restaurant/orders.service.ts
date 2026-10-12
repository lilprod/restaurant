import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ItemStatus, canTransition, computeTotals, deriveOrderStatus, lineTotal, paymentStatusFor, vatIncluded, zonedDayRange,
} from "@restaurant/utils";
import type { CreateOrderInput, ListOrdersQuery, OrderItemInput, OrderPaymentInput } from "@restaurant/validation";
import { PrismaService, Tx } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import type { Account } from "../security/accounts.repo";
import { TenantSettingsService } from "../settings/tenant-settings.service";
import { FLOOR, KITCHEN, isManager } from "./common";
import { TablesService } from "./tables.service";

export const orderInclude = {
  table: { select: { id: true, label: true } },
  waiter: { select: { id: true, firstName: true, lastName: true } },
  items: {
    orderBy: [{ course: "asc" }, { createdAt: "asc" }],
    include: {
      options: { select: { optionId: true, name: true, extra: true } },
      allocations: { select: { quantity: true, payment: { select: { status: true } } } },
      menuItem: { select: { prepMinutes: true, imageUrl: true } },
    },
  },
  payments: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;
type Ops = { serviceChargePercent: number; defaultVatRate: number; takeawayEnabled: boolean };

/** Forme publique d'une commande (API et événements temps réel). */
export function orderView(o: OrderRow) {
  return {
    id: o.id, number: o.number, type: o.type, status: o.status, paymentStatus: o.paymentStatus,
    table: o.table, customerName: o.customerName, notes: o.notes, waiter: o.waiter,
    subtotal: o.subtotal, serviceCharge: o.serviceCharge, vat: o.vat, total: o.total, tip: o.tip,
    paidAmount: o.paidAmount, remaining: o.total - o.paidAmount,
    createdAt: o.createdAt, updatedAt: o.updatedAt, closedAt: o.closedAt, cancelledAt: o.cancelledAt, cancelReason: o.cancelReason,
    items: o.items.map((i) => ({
      id: i.id, menuItemId: i.menuItemId, name: i.name, quantity: i.quantity, unitPrice: i.unitPrice,
      optionsExtra: i.optionsExtra, lineTotal: i.lineTotal, vatRate: Number(i.vatRate), status: i.status,
      instructions: i.instructions, course: i.course, options: i.options, prepMinutes: i.menuItem.prepMinutes,
      imageUrl: i.menuItem.imageUrl, createdAt: i.createdAt, startedAt: i.startedAt, readyAt: i.readyAt,
      servedAt: i.servedAt, cancelReason: i.cancelReason,
      paidQuantity: i.allocations.filter((a) => a.payment.status === "PAID").reduce((n, a) => n + a.quantity, 0),
    })),
    payments: o.payments.map((p) => ({
      id: p.id, method: p.method, status: p.status, amount: p.amount, tip: p.tip, tendered: p.tendered, change: p.change,
      reference: p.reference, paidAt: p.paidAt, refundedAt: p.refundedAt, refundReason: p.refundReason,
    })),
  };
}
export type OrderView = ReturnType<typeof orderView>;

const KITCHEN_STATES: ItemStatus[] = ["PENDING", "IN_PROGRESS", "READY"];

/** Commandes : prise de commande, avancement cuisine, service, annulations, encaissement. */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: TenantSettingsService,
    private readonly tables: TablesService,
    private readonly realtime: RealtimeService,
  ) {}

  private async ops(tenantId: string): Promise<Ops> {
    return this.settings.getSection("operations", await this.settings.tenant(tenantId));
  }

  // ── Lecture ──

  async list(tenantId: string, q: ListOrdersQuery, timezone?: string) {
    const where: Prisma.OrderWhereInput = {
      tenantId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.paymentStatus ? { paymentStatus: q.paymentStatus } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.tableId ? { tableId: q.tableId } : {}),
      ...(q.open === true ? { closedAt: null, cancelledAt: null } : q.open === false ? { OR: [{ closedAt: { not: null } }, { cancelledAt: { not: null } }] } : {}),
    };
    if (q.date) {
      const tz = timezone ?? (await this.settings.tenant(tenantId)).timezone;
      const { start, end } = zonedDayRange(q.date, tz);
      where.createdAt = { gte: start, lt: end };
    }
    return this.prisma.asTenant(tenantId, async (tx) => {
      const [total, rows] = await Promise.all([
        tx.order.count({ where }),
        tx.order.findMany({ where, include: orderInclude, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      ]);
      return { total, page: q.page, pageSize: q.pageSize, items: rows.map(orderView) };
    });
  }

  async get(tenantId: string, id: string) {
    return this.prisma.asTenant(tenantId, async (tx) => orderView(await this.load(tx, tenantId, id)));
  }

  /** Écran cuisine : commandes ouvertes avec des articles à préparer ou prêts à servir. */
  async kitchen(tenantId: string) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      const rows = await tx.order.findMany({
        where: { tenantId, cancelledAt: null, items: { some: { status: { in: KITCHEN_STATES } } } },
        include: orderInclude, orderBy: { createdAt: "asc" }, take: 200,
      });
      return rows.map((o) => {
        const v = orderView(o);
        return { ...v, items: v.items.filter((i) => KITCHEN_STATES.includes(i.status as ItemStatus)) };
      });
    });
  }

  // ── Prise de commande ──

  async create(acc: Account, input: CreateOrderInput) {
    const tenantId = acc.tenantId!;
    const ops = await this.ops(tenantId);
    if (input.type === "TAKEAWAY" && !ops.takeawayEnabled) throw new ConflictException("La vente à emporter est désactivée dans les paramètres");
    const view = await this.prisma.asTenant(tenantId, async (tx) => {
      if (input.tableId) {
        const table = await tx.restaurantTable.findFirst({ where: { id: input.tableId, tenantId, isActive: true } });
        if (!table) throw new NotFoundException("Table introuvable");
      }
      const lines = await this.buildLines(tx, tenantId, input.items);
      const counter = await tx.tenant.update({ where: { id: tenantId }, data: { nextOrderNumber: { increment: 1 } }, select: { nextOrderNumber: true } });
      const order = await tx.order.create({
        data: {
          tenantId, number: counter.nextOrderNumber - 1, type: input.type, tableId: input.type === "DINE_IN" ? input.tableId : null,
          customerName: input.customerName, notes: input.notes, waiterId: acc.id,
        },
      });
      await this.insertLines(tx, tenantId, order.id, lines);
      await this.recompute(tx, order.id, ops);
      await this.tables.syncStatus(tx, order.tableId);
      return orderView(await this.load(tx, tenantId, order.id));
    });
    this.realtime.emit(tenantId, "order.created", view);
    return view;
  }

  async addItems(acc: Account, orderId: string, items: OrderItemInput[]) {
    return this.mutate(acc, orderId, async (tx, o, tenantId) => {
      this.assertOpen(o);
      await this.insertLines(tx, tenantId, o.id, await this.buildLines(tx, tenantId, items));
    });
  }

  async updateItem(acc: Account, orderId: string, itemId: string, patch: { quantity?: number; instructions?: string }) {
    return this.mutate(acc, orderId, async (tx, o) => {
      this.assertOpen(o);
      const item = this.findItem(o, itemId);
      if (item.status !== "PENDING") throw new ConflictException("Cet article est déjà en préparation : il ne peut plus être modifié");
      if (item.allocations.some((a) => a.payment.status === "PAID")) throw new ConflictException("Cet article a déjà été encaissé");
      const quantity = patch.quantity ?? item.quantity;
      await tx.orderItem.update({
        where: { id: itemId },
        data: { quantity, instructions: patch.instructions ?? item.instructions, lineTotal: lineTotal(item.unitPrice, item.optionsExtra, quantity) },
      });
    });
  }

  // ── Cuisine et service ──

  /** Avance (ou recule d'un cran) un article. Cuisine : en préparation / prêt. Salle : servi. */
  async setItemStatus(acc: Account, orderId: string, itemId: string, to: ItemStatus) {
    return this.mutate(acc, orderId, async (tx, o) => {
      if (o.cancelledAt) throw new ConflictException("Cette commande est annulée");
      const item = this.findItem(o, itemId);
      this.assertRoleFor(acc, item.status as ItemStatus, to);
      if (item.status === to) return;
      if (!canTransition(item.status as ItemStatus, to)) throw new ConflictException(`Passage impossible : ${item.status} → ${to}`);
      await tx.orderItem.update({ where: { id: itemId }, data: this.timestamps(item.status as ItemStatus, to) });
    });
  }

  /** Avance tous les articles éligibles d'une commande (ex. « Tout est prêt », « Tout servi »). */
  async advanceAll(acc: Account, orderId: string, to: "IN_PROGRESS" | "READY" | "SERVED") {
    const from: Record<string, ItemStatus[]> = { IN_PROGRESS: ["PENDING"], READY: ["PENDING", "IN_PROGRESS"], SERVED: ["READY"] };
    return this.mutate(acc, orderId, async (tx, o) => {
      if (o.cancelledAt) throw new ConflictException("Cette commande est annulée");
      this.assertRoleFor(acc, from[to][0], to);
      const targets = o.items.filter((i) => from[to].includes(i.status as ItemStatus));
      if (!targets.length) throw new ConflictException("Aucun article à faire avancer");
      for (const i of targets) await tx.orderItem.update({ where: { id: i.id }, data: this.timestamps(i.status as ItemStatus, to) });
    });
  }

  async cancelItem(acc: Account, orderId: string, itemId: string, reason: string) {
    return this.mutate(acc, orderId, async (tx, o) => {
      if (o.cancelledAt) throw new ConflictException("Cette commande est déjà annulée");
      const item = this.findItem(o, itemId);
      if (item.status === "CANCELLED") throw new ConflictException("Cet article est déjà annulé");
      if (!isManager(acc) && item.status !== "PENDING") {
        throw new ForbiddenException("Article déjà lancé en cuisine : seul un responsable peut l'annuler");
      }
      if (item.allocations.some((a) => a.payment.status === "PAID")) throw new ConflictException("Cet article a déjà été encaissé : remboursez d'abord le paiement");
      await tx.orderItem.update({ where: { id: itemId }, data: { status: "CANCELLED", cancelReason: reason } });
      await tx.auditLog.create({ data: { tenantId: o.tenantId, userId: acc.id, action: "order.item.cancel", entity: "OrderItem", entityId: itemId, metadata: { orderNumber: o.number, reason } } });
    });
  }

  async cancelOrder(acc: Account, orderId: string, reason: string) {
    return this.mutate(acc, orderId, async (tx, o) => {
      if (o.cancelledAt) throw new ConflictException("Cette commande est déjà annulée");
      if (o.payments.some((p) => p.status === "PAID")) throw new ConflictException("Des paiements ont été encaissés : remboursez-les avant d'annuler");
      const now = new Date();
      await tx.orderItem.updateMany({ where: { orderId: o.id, status: { not: "CANCELLED" } }, data: { status: "CANCELLED", cancelReason: reason } });
      await tx.order.update({ where: { id: o.id }, data: { cancelledAt: now, cancelReason: reason, closedAt: now } });
      await tx.auditLog.create({ data: { tenantId: o.tenantId, userId: acc.id, action: "order.cancel", entity: "Order", entityId: o.id, metadata: { number: o.number, reason } } });
    });
  }

  // ── Encaissement ──

  async pay(acc: Account, orderId: string, input: OrderPaymentInput) {
    let created: { id: string; change: number | null } | null = null;
    const order = await this.mutate(acc, orderId, async (tx, o, tenantId) => {
      if (o.cancelledAt) throw new ConflictException("Cette commande est annulée");
      const remaining = o.total - o.paidAmount;
      if (remaining <= 0) throw new ConflictException("Cette commande est déjà réglée");
      if (input.amount > remaining) throw new ConflictException(`Le montant dépasse le reste à payer (${remaining} FCFA)`);

      for (const a of input.allocations ?? []) {
        const item = o.items.find((i) => i.id === a.orderItemId);
        if (!item || item.status === "CANCELLED") throw new BadRequestException("Article à encaisser introuvable dans cette commande");
        const already = item.allocations.filter((x) => x.payment.status === "PAID").reduce((n, x) => n + x.quantity, 0);
        if (already + a.quantity > item.quantity) throw new ConflictException(`« ${item.name} » : quantité déjà encaissée`);
      }
      const session = await tx.registerSession.findFirst({ where: { tenantId, closedAt: null } });
      const change = input.method === "CASH" && input.tendered !== undefined ? input.tendered - input.amount - input.tip : null;
      const p = await tx.payment.create({
        data: {
          tenantId, orderId: o.id, method: input.method, status: "PAID", amount: input.amount, tip: input.tip,
          tendered: input.method === "CASH" ? input.tendered : null, change, reference: input.reference,
          registerSessionId: session?.id, paidAt: new Date(), recordedById: acc.id,
          allocations: input.allocations?.length ? {
            create: input.allocations.map((a) => {
              const item = o.items.find((i) => i.id === a.orderItemId)!;
              return { tenantId, orderItemId: a.orderItemId, quantity: a.quantity, amount: (item.unitPrice + item.optionsExtra) * a.quantity };
            }),
          } : undefined,
        },
      });
      created = { id: p.id, change };
    });
    return { order, paymentId: created!.id, change: created!.change };
  }

  async refund(acc: Account, orderId: string, paymentId: string, reason: string) {
    return this.mutate(acc, orderId, async (tx, o) => {
      const p = o.payments.find((x) => x.id === paymentId);
      if (!p) throw new NotFoundException("Paiement introuvable");
      if (p.status !== "PAID") throw new ConflictException("Ce paiement n'est pas remboursable");
      await tx.payment.update({ where: { id: paymentId }, data: { status: "REFUNDED", refundedAt: new Date(), refundReason: reason } });
      await tx.auditLog.create({ data: { tenantId: o.tenantId, userId: acc.id, action: "order.payment.refund", entity: "Payment", entityId: paymentId, metadata: { orderNumber: o.number, amount: p.amount, reason } } });
    });
  }

  /** Ticket : informations du restaurant, lignes, TVA par taux, paiements. */
  async receipt(tenantId: string, orderId: string) {
    const tenant = await this.settings.tenant(tenantId);
    const [business, branding, ops] = await Promise.all([
      this.settings.getSection("business", tenant), this.settings.get(tenantId, "branding"), this.ops(tenantId),
    ]);
    const order = await this.get(tenantId, orderId);
    // TVA par taux : lignes non annulées + service (au taux par défaut), tel qu'enregistré sur la commande.
    const byRate = new Map<number, number>();
    for (const i of order.items) if (i.status !== "CANCELLED") byRate.set(i.vatRate, (byRate.get(i.vatRate) ?? 0) + i.lineTotal);
    if (order.serviceCharge) byRate.set(ops.defaultVatRate, (byRate.get(ops.defaultVatRate) ?? 0) + order.serviceCharge);
    const vatBreakdown = [...byRate.entries()].sort(([a], [b]) => a - b).map(([rate, ttc]) => {
      const vat = vatIncluded(ttc, rate);
      return { rate, base: ttc - vat, vat };
    });
    return {
      restaurant: {
        name: business.tradeName, legalName: business.legalName ?? null, address: tenant.address, phone: business.phone ?? tenant.phone,
        email: business.email ?? tenant.email, taxId: business.receipt?.showTaxId ? business.taxId ?? null : null,
        registrationNumber: business.registrationNumber ?? null,
        logoUrl: business.receipt?.showLogo ? (branding as { assets?: { logo?: string | null } }).assets?.logo ?? null : null,
        headerText: business.receipt?.headerText ?? null, footerText: business.receipt?.footerText ?? null,
      },
      currency: tenant.currency,
      order,
      vatBreakdown,
      printedAt: new Date(),
    };
  }

  // ── interne ──

  private async load(tx: Tx, tenantId: string, id: string): Promise<OrderRow> {
    const o = await tx.order.findFirst({ where: { id, tenantId }, include: orderInclude });
    if (!o) throw new NotFoundException("Commande introuvable");
    return o;
  }

  /**
   * Verrouille la commande (SELECT … FOR UPDATE : deux encaissements simultanés ne peuvent pas dépasser le total),
   * applique la modification, recalcule totaux et statuts, met à jour la table puis diffuse la commande.
   */
  private async mutate(acc: Account, orderId: string, fn: (tx: Tx, o: OrderRow, tenantId: string) => Promise<void>) {
    const tenantId = acc.tenantId!;
    const ops = await this.ops(tenantId);
    const view = await this.prisma.asTenant(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const o = await this.load(tx, tenantId, orderId);
      await fn(tx, o, tenantId);
      await this.recompute(tx, o.id, ops);
      await this.tables.syncStatus(tx, o.tableId);
      return orderView(await this.load(tx, tenantId, o.id));
    });
    this.realtime.emit(tenantId, "order.updated", view);
    return view;
  }

  /** Totaux, statut et état de paiement ; clôture quand tout est servi et réglé (réouverture après remboursement). */
  private async recompute(tx: Tx, orderId: string, ops: Ops) {
    const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, payments: true } });
    const totals = computeTotals({
      items: o.items.map((i) => ({ lineTotal: i.lineTotal, vatRate: Number(i.vatRate), status: i.status as ItemStatus })),
      serviceChargePercent: ops.serviceChargePercent,
      defaultVatRate: ops.defaultVatRate,
    });
    const paid = o.payments.filter((p) => p.status === "PAID");
    const paidAmount = paid.reduce((n, p) => n + p.amount, 0);
    const status = o.cancelledAt ? "CANCELLED" : deriveOrderStatus(o.items.map((i) => i.status as ItemStatus));
    const paymentStatus = paymentStatusFor(paidAmount, totals.total);
    const closedAt = o.cancelledAt ? o.closedAt : paymentStatus === "PAID" && status === "DELIVERED" ? o.closedAt ?? new Date() : null;
    await tx.order.update({
      where: { id: orderId },
      data: {
        subtotal: totals.subtotal, serviceCharge: totals.serviceCharge, vat: totals.vat, total: totals.total,
        tip: paid.reduce((n, p) => n + p.tip, 0), paidAmount, paymentStatus, status, closedAt,
      },
    });
  }

  /** Valide les plats (disponibles) et les options choisies, et fige prix, noms et TVA. */
  private async buildLines(tx: Tx, tenantId: string, items: OrderItemInput[]) {
    const ids = [...new Set(items.map((i) => i.menuItemId))];
    const menu = await tx.menuItem.findMany({
      where: { id: { in: ids }, tenantId, archivedAt: null },
      include: { optionGroups: { where: { archivedAt: null }, include: { options: true } } },
    });
    return items.map((input) => {
      const m = menu.find((x) => x.id === input.menuItemId);
      if (!m) throw new NotFoundException("Plat introuvable");
      if (!m.isAvailable) throw new ConflictException(`« ${m.name} » n'est plus disponible`);
      const chosen = [...new Set(input.optionIds)];
      const options = chosen.map((oid) => {
        for (const g of m.optionGroups) {
          const opt = g.options.find((x) => x.id === oid);
          if (opt) return { group: g, opt };
        }
        throw new BadRequestException(`Option inconnue pour « ${m.name} »`);
      });
      for (const g of m.optionGroups) {
        const n = options.filter((x) => x.group.id === g.id).length;
        if (n < g.minChoices) throw new BadRequestException(`« ${m.name} » : choisissez ${g.minChoices === 1 ? "une option" : `${g.minChoices} options`} pour « ${g.name} »`);
        if (n > g.maxChoices) throw new BadRequestException(`« ${m.name} » : ${g.maxChoices} choix maximum pour « ${g.name} »`);
      }
      const optionsExtra = options.reduce((s, x) => s + x.opt.extra, 0);
      return {
        menuItemId: m.id, name: m.name, quantity: input.quantity, unitPrice: m.price, optionsExtra, vatRate: m.vatRate,
        lineTotal: lineTotal(m.price, optionsExtra, input.quantity), instructions: input.instructions, course: input.course,
        options: options.map((x) => ({ optionId: x.opt.id, name: x.opt.name, extra: x.opt.extra })),
      };
    });
  }

  private async insertLines(tx: Tx, tenantId: string, orderId: string, lines: Awaited<ReturnType<OrdersService["buildLines"]>>) {
    for (const { options, ...l } of lines) {
      await tx.orderItem.create({
        data: { tenantId, orderId, ...l, options: { create: options.map((o) => ({ tenantId, ...o })) } },
      });
    }
  }

  private findItem(o: OrderRow, itemId: string) {
    const item = o.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException("Article introuvable");
    return item;
  }

  private assertOpen(o: OrderRow) {
    if (o.cancelledAt) throw new ConflictException("Cette commande est annulée");
    if (o.closedAt) throw new ConflictException("Cette commande est clôturée");
  }

  /** La cuisine fait avancer les préparations ; la salle marque « servi » (et peut l'annuler). */
  private assertRoleFor(acc: Account, from: ItemStatus, to: ItemStatus) {
    const floorMove = to === "SERVED" || (from === "SERVED" && to === "READY");
    const allowed: readonly string[] = floorMove ? FLOOR : KITCHEN;
    if (!allowed.includes(acc.role)) {
      throw new ForbiddenException(floorMove ? "Seule la salle peut marquer un plat comme servi" : "Seule la cuisine fait avancer les préparations");
    }
  }

  private timestamps(from: ItemStatus, to: ItemStatus): Prisma.OrderItemUpdateInput {
    const now = new Date();
    switch (to) {
      case "PENDING": return { status: to, startedAt: null, readyAt: null };
      case "IN_PROGRESS": return { status: to, startedAt: from === "PENDING" ? now : undefined, readyAt: null };
      case "READY": return { status: to, readyAt: now, servedAt: null, ...(from === "PENDING" ? { startedAt: now } : {}) };
      case "SERVED": return { status: to, servedAt: now };
      default: return { status: to };
    }
  }
}
