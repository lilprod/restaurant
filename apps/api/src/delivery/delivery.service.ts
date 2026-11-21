import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { canDeliveryTransition, normalizePhone, zonedDay, zonedDayRange } from "@restaurant/utils";
import type { CompleteDeliveryInput, DeliveryZoneInput, DeliveryZoneUpdate, ListDeliveriesQuery } from "@restaurant/validation";
import { Clock } from "../common/clock";
import { NotificationsService } from "../notifications/notifications.service";
import type { TemplateDataMap } from "../notifications/templates";
import { PrismaService, Tx } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import { OrdersService } from "../restaurant/orders.service";
import type { Account } from "../security/accounts.repo";
import { TenantSettingsService } from "../settings/tenant-settings.service";
import { DeliveryRow, deliveryInclude, deliveryView } from "./delivery.views";

const withOrder = { ...deliveryInclude, order: { include: { items: true } } } satisfies Prisma.DeliveryInclude;
type FullRow = Prisma.DeliveryGetPayload<{ include: typeof withOrder }>;
const view = (d: FullRow) => deliveryView(d as DeliveryRow, d.order);
const OPEN: ("PENDING" | "ASSIGNED" | "ON_THE_WAY")[] = ["PENDING", "ASSIGNED", "ON_THE_WAY"];
const STATUS_LABEL: Record<string, string> = { PENDING: "en attente d'un livreur", ASSIGNED: "attribuée", ON_THE_WAY: "en route", DELIVERED: "livrée", FAILED: "en échec" };

const zoneView = (z: { id: string; name: string; neighborhoods: string[]; landmarks: string[]; fee: number; minOrder: number; etaMinutes: number; isActive: boolean }) => ({
  id: z.id, name: z.name, neighborhoods: z.neighborhoods, landmarks: z.landmarks, fee: z.fee, minOrder: z.minOrder, etaMinutes: z.etaMinutes, isActive: z.isActive,
});

/** X2 — Livraison : zones, dispatch, parcours du livreur, paiement à la livraison et rapprochement. */
@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: TenantSettingsService,
    private readonly orders: OrdersService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
  ) {}

  // ── Zones ──

  async zones(tenantId: string) {
    return this.prisma.asTenant(tenantId, async (tx) =>
      (await tx.deliveryZone.findMany({ where: { tenantId }, orderBy: [{ isActive: "desc" }, { name: "asc" }] })).map(zoneView));
  }

  async createZone(acc: Account, input: DeliveryZoneInput) {
    const tenantId = acc.tenantId!;
    return this.prisma.asTenant(tenantId, async (tx) => {
      await this.assertUniqueName(tx, tenantId, input.name);
      const z = await tx.deliveryZone.create({ data: { tenantId, ...input } });
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "delivery.zone.create", entity: "DeliveryZone", entityId: z.id, metadata: { name: z.name, fee: z.fee } } });
      return zoneView(z);
    });
  }

  async updateZone(acc: Account, id: string, patch: DeliveryZoneUpdate) {
    const tenantId = acc.tenantId!;
    return this.prisma.asTenant(tenantId, async (tx) => {
      const z = await tx.deliveryZone.findFirst({ where: { id, tenantId } });
      if (!z) throw new NotFoundException("Zone introuvable");
      if (patch.name) await this.assertUniqueName(tx, tenantId, patch.name, id);
      const u = await tx.deliveryZone.update({ where: { id }, data: patch });
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "delivery.zone.update", entity: "DeliveryZone", entityId: id, metadata: { ...patch, before: { fee: z.fee, minOrder: z.minOrder } } } });
      return zoneView(u);
    });
  }

  async deleteZone(acc: Account, id: string) {
    const tenantId = acc.tenantId!;
    return this.prisma.asTenant(tenantId, async (tx) => {
      const z = await tx.deliveryZone.findFirst({ where: { id, tenantId } });
      if (!z) throw new NotFoundException("Zone introuvable");
      if (await tx.delivery.count({ where: { zoneId: id, tenantId } })) throw new ConflictException("Cette zone a déjà servi pour des livraisons : désactivez-la plutôt que de la supprimer");
      await tx.deliveryZone.delete({ where: { id } });
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "delivery.zone.delete", entity: "DeliveryZone", entityId: id, metadata: { name: z.name } } });
      return { id, deleted: true as const };
    });
  }

  private async assertUniqueName(tx: Tx, tenantId: string, name: string, exceptId?: string) {
    const dup = await tx.deliveryZone.findFirst({ where: { tenantId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
    if (dup) throw new ConflictException(`Une zone « ${dup.name} » existe déjà`);
  }

  // ── Dispatch (salle et responsables) ──

  /** Livreurs actifs avec leur charge du moment. */
  async drivers(tenantId: string) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      const users = await tx.user.findMany({ where: { tenantId, role: "DRIVER", isActive: true }, orderBy: { firstName: "asc" }, include: { staffProfile: { select: { id: true } } } });
      const load = await tx.delivery.groupBy({ by: ["driverId", "status"], where: { tenantId, status: { in: ["ASSIGNED", "ON_THE_WAY"] }, order: { cancelledAt: null } }, _count: { _all: true } });
      return users.map((u) => {
        const mine = load.filter((l) => l.driverId && l.driverId === u.staffProfile?.id);
        return {
          id: u.id, name: `${u.firstName} ${u.lastName}`.trim(), phone: u.phone,
          assigned: mine.find((l) => l.status === "ASSIGNED")?._count._all ?? 0, onTheWay: mine.find((l) => l.status === "ON_THE_WAY")?._count._all ?? 0,
        };
      });
    });
  }

  /** Tableau de dispatch : livraisons en cours, en échec, terminées du jour et livrées non rapprochées. */
  async board(tenantId: string, q: ListDeliveriesQuery) {
    const tz = (await this.settings.tenant(tenantId)).timezone;
    const { start, end } = zonedDayRange(q.date ?? zonedDay(this.clock.now(), tz), tz);
    return this.prisma.asTenant(tenantId, async (tx) => {
      const rows = await tx.delivery.findMany({
        where: {
          tenantId, order: { cancelledAt: null },
          OR: [
            { status: { in: [...OPEN, "FAILED"] } },
            { status: "DELIVERED", OR: [{ deliveredAt: { gte: start, lt: end } }, { codPaymentId: { not: null }, settledAt: null }] },
          ],
        },
        include: withOrder, orderBy: { createdAt: "asc" }, take: 300,
      });
      return { items: rows.map(view), day: q.date ?? zonedDay(this.clock.now(), tz) };
    });
  }

  async get(tenantId: string, id: string) {
    return this.prisma.asTenant(tenantId, async (tx) => view(await this.load(tx, tenantId, id)));
  }

  async assign(acc: Account, id: string, driverUserId: string) {
    const tenantId = acc.tenantId!;
    let previous: string | null = null;
    const row = await this.prisma.asTenant(tenantId, async (tx) => {
      await this.lock(tx, tenantId, id);
      const d = await this.load(tx, tenantId, id);
      if (d.order.cancelledAt) throw new ConflictException("Cette commande est annulée");
      if (!canDeliveryTransition(d.status, "ASSIGNED")) throw new ConflictException(`Cette livraison est déjà ${STATUS_LABEL[d.status]} : elle ne peut plus changer de livreur`);
      const driver = await tx.user.findFirst({ where: { id: driverUserId, tenantId, role: "DRIVER", isActive: true } });
      if (!driver) throw new NotFoundException("Livreur introuvable");
      previous = d.driver?.user.id ?? null;
      const profile = await this.profileFor(tx, tenantId, driver.id);
      await tx.delivery.update({ where: { id }, data: { driverId: profile.id, status: "ASSIGNED", assignedAt: new Date(), failReason: null, failedAt: null } });
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "delivery.assign", entity: "Delivery", entityId: id, metadata: { orderNumber: d.order.number, driverId: driver.id, previousDriverId: previous } } });
      return this.load(tx, tenantId, id);
    });
    this.emit(tenantId, row, previous);
    // X5B : alerte push du nouveau livreur ; l'ancien est prévenu que la livraison lui est retirée (réattribution).
    if (previous !== driverUserId) {
      const stamp = row.assignedAt?.getTime() ?? Date.now();
      const data = { orderId: row.orderId, number: row.order.number, deliveryId: row.id };
      void this.notifications.sendPush({ template: "push.delivery-assigned", data, tenantId, audience: { userIds: [driverUserId] }, excludeUserId: acc.id, dedupeKey: `delivery:${id}:assigned:${stamp}` });
      if (previous) void this.notifications.sendPush({ template: "push.delivery-unassigned", data, tenantId, audience: { userIds: [previous] }, excludeUserId: acc.id, dedupeKey: `delivery:${id}:unassigned:${stamp}:${previous}` });
    }
    return view(row);
  }

  // ── Livreur : « Mes livraisons » ──

  async mine(acc: Account, q: ListDeliveriesQuery) {
    const tenantId = acc.tenantId!;
    const tz = (await this.settings.tenant(tenantId)).timezone;
    const day = q.date ?? zonedDay(this.clock.now(), tz);
    const { start, end } = zonedDayRange(day, tz);
    return this.prisma.asTenant(tenantId, async (tx) => {
      const rows = await tx.delivery.findMany({
        where: {
          tenantId, driver: { userId: acc.id }, order: { cancelledAt: null },
          OR: [{ status: { in: ["ASSIGNED", "ON_THE_WAY"] } }, { status: { in: ["DELIVERED", "FAILED"] }, updatedAt: { gte: start, lt: end } }],
        },
        include: withOrder, orderBy: { createdAt: "asc" }, take: 100,
      });
      return { items: rows.map(view), day };
    });
  }

  async mineGet(acc: Account, id: string) {
    return this.prisma.asTenant(acc.tenantId!, async (tx) => view(await this.own(tx, acc, id)));
  }

  /** « Récupéré » : la livraison part, le client est prévenu par SMS (avec le numéro du livreur). */
  async pickup(acc: Account, id: string) {
    const tenantId = acc.tenantId!;
    const row = await this.prisma.asTenant(tenantId, async (tx) => {
      await this.lock(tx, tenantId, id);
      const d = await this.own(tx, acc, id);
      if (d.status === "ON_THE_WAY") throw new ConflictException("Cette livraison est déjà en route");
      if (!canDeliveryTransition(d.status, "ON_THE_WAY")) throw new ConflictException(`Cette livraison est ${STATUS_LABEL[d.status]}`);
      if (d.order.status !== "READY" && d.order.status !== "DELIVERED") throw new ConflictException("La commande n'est pas encore prête : attendez la cuisine");
      await tx.delivery.update({ where: { id }, data: { status: "ON_THE_WAY", pickedUpAt: new Date() } });
      return this.load(tx, tenantId, id);
    });
    this.emit(tenantId, row);
    const driver = row.driver!.user;
    await this.sms(tenantId, row, "delivery.on_the_way", { number: row.order.number, driverName: `${driver.firstName}`.trim(), driverPhone: driver.phone ? normalizePhone(driver.phone) ?? driver.phone : null }, `delivery:${id}:on_the_way:${row.pickedUpAt!.getTime()}`);
    return view(row);
  }

  /** Échec de livraison (client injoignable, adresse introuvable…) : la salle reprend la main (nouvelle attribution ou annulation). */
  async fail(acc: Account, id: string, reason: string) {
    const tenantId = acc.tenantId!;
    const row = await this.prisma.asTenant(tenantId, async (tx) => {
      await this.lock(tx, tenantId, id);
      const d = await this.own(tx, acc, id);
      if (!canDeliveryTransition(d.status, "FAILED")) throw new ConflictException(`Cette livraison est ${STATUS_LABEL[d.status]}`);
      await tx.delivery.update({ where: { id }, data: { status: "FAILED", failReason: reason, failedAt: new Date() } });
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "delivery.fail", entity: "Delivery", entityId: id, metadata: { orderNumber: d.order.number, reason } } });
      return this.load(tx, tenantId, id);
    });
    this.emit(tenantId, row);
    return view(row);
  }

  /**
   * Remise au client. S'il reste à payer, le livreur encaisse la totalité (espèces, Flooz, TMoney) : le paiement est créé sur la commande
   * (donc réglée et clôturée, articles servis) mais n'entre en caisse qu'au rapprochement (`settle`). Verrou de la commande : une seule remise.
   */
  async complete(acc: Account, id: string, input: CompleteDeliveryInput) {
    const tenantId = acc.tenantId!;
    const pre = await this.prisma.asTenant(tenantId, (tx) => this.own(tx, acc, id));
    await this.orders.mutate(acc, pre.orderId, async (tx, o) => {
      const d = o.delivery;
      if (!d || d.id !== id || d.driver?.user.id !== acc.id) throw new NotFoundException("Livraison introuvable");
      if (d.status !== "ON_THE_WAY") throw new ConflictException(d.status === "DELIVERED" ? "Cette livraison est déjà marquée livrée" : "Marquez d'abord la commande comme récupérée");
      const live = o.items.filter((i) => !i.parentItemId && !i.formulaId && i.status !== "CANCELLED");
      if (live.some((i) => i.status !== "READY" && i.status !== "SERVED")) throw new ConflictException("Des articles ne sont pas encore prêts");
      const remaining = o.total - o.paidAmount;
      let paymentId: string | null = null;
      if (remaining > 0) {
        if (!input.method) throw new BadRequestException("Indiquez le moyen d'encaissement");
        if (input.method === "CASH" && input.tendered !== undefined && input.tendered < remaining) throw new BadRequestException("La somme remise est inférieure au montant à payer");
        const p = await this.orders.recordPayment(tx, acc, o, tenantId, { method: input.method, amount: remaining, tip: 0, tendered: input.tendered, reference: input.reference }, { deferRegister: true });
        paymentId = p.id;
      }
      const now = new Date();
      await tx.orderItem.updateMany({ where: { orderId: o.id, status: "READY", formulaId: null }, data: { status: "SERVED", servedAt: now } });
      await tx.delivery.update({ where: { id }, data: { status: "DELIVERED", deliveredAt: now, codPaymentId: paymentId } });
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "delivery.complete", entity: "Delivery", entityId: id, metadata: { orderNumber: o.number, collected: remaining > 0 ? remaining : 0, method: remaining > 0 ? input.method : null } } });
    });
    const row = await this.prisma.asTenant(tenantId, (tx) => this.load(tx, tenantId, id));
    await this.sms(tenantId, row, "delivery.delivered", { number: row.order.number }, `delivery:${id}:delivered`);
    return view(row);
  }

  // ── Rapprochement à son retour (responsables) ──

  async settlements(tenantId: string) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      const [rows, session] = await Promise.all([this.unsettled(tx, tenantId), tx.registerSession.findFirst({ where: { tenantId, closedAt: null }, select: { id: true } })]);
      const byDriver = new Map<string, { driver: { id: string; name: string; phone: string | null }; count: number; total: number; byMethod: Record<string, number>; deliveries: { id: string; orderNumber: number; amount: number; method: string; deliveredAt: Date | null }[] }>();
      for (const { d, p } of rows) {
        const u = d.driver!.user;
        const g = byDriver.get(u.id) ?? byDriver.set(u.id, { driver: { id: u.id, name: `${u.firstName} ${u.lastName}`.trim(), phone: u.phone }, count: 0, total: 0, byMethod: {}, deliveries: [] }).get(u.id)!;
        g.count += 1; g.total += p.amount; g.byMethod[p.method] = (g.byMethod[p.method] ?? 0) + p.amount;
        g.deliveries.push({ id: d.id, orderNumber: d.order.number, amount: p.amount, method: p.method, deliveredAt: d.deliveredAt });
      }
      return { registerOpen: !!session, drivers: [...byDriver.values()] };
    });
  }

  /** Rattache les encaissements du livreur à la caisse ouverte (les espèces deviennent « attendues » dans le tiroir). */
  async settle(acc: Account, driverUserId: string) {
    const tenantId = acc.tenantId!;
    const out = await this.prisma.asTenant(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"register:" + tenantId}))`;
      const session = await tx.registerSession.findFirst({ where: { tenantId, closedAt: null } });
      if (!session) throw new ConflictException("Ouvrez la caisse avant de rapprocher les encaissements d'un livreur");
      const rows = (await this.unsettled(tx, tenantId)).filter(({ d }) => d.driver?.user.id === driverUserId);
      if (!rows.length) throw new ConflictException("Rien à rapprocher pour ce livreur");
      const now = new Date();
      await tx.payment.updateMany({ where: { id: { in: rows.map((r) => r.p.id) }, tenantId, status: "PAID", registerSessionId: null }, data: { registerSessionId: session.id } });
      await tx.delivery.updateMany({ where: { id: { in: rows.map((r) => r.d.id) }, tenantId }, data: { settledAt: now, settledById: acc.id } });
      const byMethod: Record<string, number> = {};
      for (const { p } of rows) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
      const total = rows.reduce((n, r) => n + r.p.amount, 0);
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "delivery.settle", entity: "RegisterSession", entityId: session.id, metadata: { driverId: driverUserId, count: rows.length, total, byMethod } } });
      const ids = rows.map((r) => r.d.id);
      return { count: rows.length, total, byMethod, rows: await tx.delivery.findMany({ where: { id: { in: ids }, tenantId }, include: withOrder }) };
    });
    for (const r of out.rows) this.emit(tenantId, r);
    return { count: out.count, total: out.total, byMethod: out.byMethod };
  }

  private async unsettled(tx: Tx, tenantId: string) {
    const ds = await tx.delivery.findMany({
      where: { tenantId, status: "DELIVERED", codPaymentId: { not: null }, settledAt: null, driverId: { not: null } },
      include: withOrder, orderBy: { deliveredAt: "asc" },
    });
    const pays = await tx.payment.findMany({ where: { tenantId, id: { in: ds.map((d) => d.codPaymentId!) }, status: "PAID" } });
    return ds.flatMap((d) => { const p = pays.find((x) => x.id === d.codPaymentId); return p ? [{ d, p }] : []; });
  }

  // ── interne ──

  private async lock(tx: Tx, tenantId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM "Delivery" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
  }

  private async load(tx: Tx, tenantId: string, id: string): Promise<FullRow> {
    const d = await tx.delivery.findFirst({ where: { id, tenantId }, include: withOrder });
    if (!d) throw new NotFoundException("Livraison introuvable");
    return d;
  }

  /** Livraison attribuée à ce livreur (404 pour celle d'un autre : un livreur ne voit que les siennes). */
  private async own(tx: Tx, acc: Account, id: string): Promise<FullRow> {
    const d = await this.load(tx, acc.tenantId!, id);
    if (d.driver?.user.id !== acc.id) throw new NotFoundException("Livraison introuvable");
    if (d.order.cancelledAt) throw new ConflictException("Cette commande a été annulée");
    return d;
  }

  /** Fiche de personnel du livreur (créée à la première attribution : poste « Livreur », sans taux horaire). */
  private async profileFor(tx: Tx, tenantId: string, userId: string) {
    return (await tx.staffProfile.findUnique({ where: { userId } }))
      ?? tx.staffProfile.create({ data: { tenantId, userId, position: "Livreur", hourlyRate: 0, hiredAt: new Date() } });
  }

  /** `delivery.updated` pour la salle et, en privé, le livreur concerné (et l'ancien en cas de changement). */
  private emit(tenantId: string, d: FullRow, previousDriverUserId?: string | null) {
    const payload = view(d);
    this.realtime.emit(tenantId, "delivery.updated", payload);
    const users = [d.driver?.user.id, previousDriverUserId].filter((x): x is string => !!x);
    this.realtime.emitToUsers(tenantId, [...new Set(users)], "delivery.updated", payload);
  }

  /** SMS au client de la livraison (réglages du restaurant et préférence « SMS de commande » du compte respectés) ; n'échoue jamais. */
  private async sms<K extends "delivery.on_the_way" | "delivery.delivered">(tenantId: string, d: FullRow, template: K, data: TemplateDataMap[K], dedupeKey: string) {
    try {
      if (d.order.customerId) {
        const u = await this.prisma.asTenant(tenantId, (tx) => tx.user.findFirst({ where: { id: d.order.customerId!, tenantId }, select: { notificationPrefs: true } }));
        if ((u?.notificationPrefs as { orderReadySms?: boolean } | null)?.orderReadySms === false) return;
      }
      await this.notifications.send({ channel: "SMS", to: d.phone, template, data, tenantId, dedupeKey });
    } catch { /* un SMS qui échoue ne doit jamais faire échouer la livraison */ }
  }
}
