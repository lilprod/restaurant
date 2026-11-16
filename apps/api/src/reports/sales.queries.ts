import type { Tx } from "../prisma/prisma.service";

/**
 * Requêtes d'agrégats des rapports. Les définitions sont celles du tableau de bord (`DashboardService`) :
 * - encaissé = paiements `PAID` par date de paiement ; pourboires idem ;
 * - commandes = non annulées, par date de création ; ticket moyen = total des commandes ÷ nombre de commandes ;
 * - heure / jour = fuseau du restaurant.
 * Les lignes (catégories, plats, TVA) sont rattachées à la date de création de leur commande : leur somme égale donc le sous-total des commandes.
 * Tout est agrégé par la base (groupBy / SQL groupé) : aucune commande n'est chargée en mémoire.
 */

export interface Range { start: Date; end: Date }
const big = (v: unknown) => Number(v ?? 0);

export interface Summary {
  revenue: number; tips: number; ordersCount: number; averageTicket: number;
  ordersTotal: number; subtotal: number; serviceCharge: number; deliveryFee: number; vat: number; discounts: number;
  cancelledOrders: { count: number; amount: number };
  cancelledItems: { count: number; amount: number };
  refunds: { count: number; amount: number };
}

export interface ItemRow { menuItemId: string | null; name: string; categoryId: string | null; category: string; vatRate: number; quantity: number; amount: number; discount: number }

/** Lignes vendues (hors lignes enfants de formule et lignes annulées) des commandes non annulées créées dans la période. */
export async function itemRows(tx: Tx, tenantId: string, r: Range): Promise<ItemRow[]> {
  const rows = await tx.$queryRaw<{ menuItemId: string | null; name: string; categoryId: string | null; category: string | null; vatRate: number; quantity: bigint; amount: bigint; discount: bigint }[]>`
    SELECT oi."menuItemId", oi.name, c.id AS "categoryId", c.name AS category, oi."vatRate"::float8 AS "vatRate",
           SUM(oi.quantity) AS quantity, SUM(oi."lineTotal") AS amount, SUM(oi.discount) AS discount
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    LEFT JOIN "MenuItem" mi ON mi.id = oi."menuItemId"
    LEFT JOIN "Category" c ON c.id = mi."categoryId"
    WHERE oi."tenantId" = ${tenantId} AND o."tenantId" = ${tenantId} AND o."cancelledAt" IS NULL
      AND o."createdAt" >= ${r.start} AND o."createdAt" < ${r.end}
      AND oi."parentItemId" IS NULL AND oi.status <> 'CANCELLED'
    GROUP BY oi."menuItemId", oi.name, c.id, c.name, oi."vatRate"`;
  return rows.map((x) => ({
    menuItemId: x.menuItemId, name: x.name, categoryId: x.categoryId, category: x.category ?? "Formules", vatRate: x.vatRate,
    quantity: big(x.quantity), amount: big(x.amount), discount: big(x.discount),
  }));
}

export async function summary(tx: Tx, tenantId: string, r: Range): Promise<Summary> {
  const [pay, orders, cancelled, refunds, cancelledItems, items] = await Promise.all([
    tx.payment.aggregate({ where: { tenantId, status: "PAID", paidAt: { gte: r.start, lt: r.end } }, _sum: { amount: true, tip: true } }),
    tx.order.aggregate({
      where: { tenantId, createdAt: { gte: r.start, lt: r.end }, cancelledAt: null },
      _count: { _all: true }, _sum: { total: true, subtotal: true, serviceCharge: true, deliveryFee: true, vat: true },
    }),
    tx.$queryRaw<{ count: bigint; amount: bigint }[]>`
      SELECT COUNT(DISTINCT o.id) AS count, COALESCE(SUM(oi."lineTotal"), 0) AS amount
      FROM "Order" o LEFT JOIN "OrderItem" oi ON oi."orderId" = o.id AND oi."parentItemId" IS NULL
      WHERE o."tenantId" = ${tenantId} AND o."cancelledAt" >= ${r.start} AND o."cancelledAt" < ${r.end}`,
    tx.payment.aggregate({ where: { tenantId, status: "REFUNDED", refundedAt: { gte: r.start, lt: r.end } }, _count: { _all: true }, _sum: { amount: true } }),
    tx.$queryRaw<{ count: bigint; amount: bigint }[]>`
      SELECT COUNT(*) AS count, COALESCE(SUM(oi."lineTotal"), 0) AS amount
      FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
      WHERE oi."tenantId" = ${tenantId} AND o."tenantId" = ${tenantId} AND oi.status = 'CANCELLED' AND oi."parentItemId" IS NULL
        AND o."cancelledAt" IS NULL AND o."createdAt" >= ${r.start} AND o."createdAt" < ${r.end}`,
    itemRows(tx, tenantId, r),
  ]);
  const count = orders._count._all;
  const total = orders._sum.total ?? 0;
  return {
    revenue: pay._sum.amount ?? 0, tips: pay._sum.tip ?? 0, ordersCount: count, averageTicket: count ? Math.round(total / count) : 0,
    ordersTotal: total, subtotal: orders._sum.subtotal ?? 0, serviceCharge: orders._sum.serviceCharge ?? 0, deliveryFee: orders._sum.deliveryFee ?? 0, vat: orders._sum.vat ?? 0,
    discounts: items.reduce((n, i) => n + i.discount, 0),
    cancelledOrders: { count: big(cancelled[0]?.count), amount: big(cancelled[0]?.amount) },
    cancelledItems: { count: big(cancelledItems[0]?.count), amount: big(cancelledItems[0]?.amount) },
    refunds: { count: refunds._count._all, amount: refunds._sum.amount ?? 0 },
  };
}

export interface GridCell { weekday: number; hour: number; orders: number; total: number }

/** Commandes par jour de semaine (1 = lundi … 7 = dimanche) × heure locale : carte de chaleur, ventes par heure et par jour de semaine. */
export async function grid(tx: Tx, tenantId: string, r: Range, tz: string): Promise<GridCell[]> {
  const rows = await tx.$queryRaw<{ wd: number; h: number; orders: bigint; total: bigint }[]>`
    SELECT EXTRACT(ISODOW FROM l)::int AS wd, EXTRACT(HOUR FROM l)::int AS h, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS total
    FROM (SELECT total, ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz} AS l FROM "Order"
          WHERE "tenantId" = ${tenantId} AND "cancelledAt" IS NULL AND "createdAt" >= ${r.start} AND "createdAt" < ${r.end}) x
    GROUP BY 1, 2`;
  return rows.map((x) => ({ weekday: x.wd, hour: x.h, orders: big(x.orders), total: big(x.total) }));
}

/** Série quotidienne (jour local) : commandes, total des commandes, encaissé. */
export async function daily(tx: Tx, tenantId: string, r: Range, tz: string) {
  const [orders, payments] = await Promise.all([
    tx.$queryRaw<{ day: string; orders: bigint; total: bigint }[]>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS total
      FROM "Order" WHERE "tenantId" = ${tenantId} AND "cancelledAt" IS NULL AND "createdAt" >= ${r.start} AND "createdAt" < ${r.end} GROUP BY 1`,
    tx.$queryRaw<{ day: string; revenue: bigint }[]>`
      SELECT to_char(("paidAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, SUM(amount) AS revenue
      FROM "Payment" WHERE "tenantId" = ${tenantId} AND status = 'PAID' AND "paidAt" >= ${r.start} AND "paidAt" < ${r.end} GROUP BY 1`,
  ]);
  const map = new Map<string, { day: string; orders: number; ordersTotal: number; revenue: number }>();
  const row = (day: string) => map.get(day) ?? map.set(day, { day, orders: 0, ordersTotal: 0, revenue: 0 }).get(day)!;
  for (const o of orders) { const x = row(o.day); x.orders = big(o.orders); x.ordersTotal = big(o.total); }
  for (const p of payments) row(p.day).revenue = big(p.revenue);
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * TVA collectée par taux : par commande et par taux, TVA incluse dans le TTC des lignes (même arrondi que `computeTotals`,
 * au franc, par commande), service et frais de livraison au taux par défaut. Le total égale la somme des `Order.vat`.
 */
export async function vatByRate(tx: Tx, tenantId: string, r: Range, defaultVatRate: number) {
  // Le service est rattaché au taux par défaut AVANT l'arrondi, avec les lignes de ce taux (comme `computeTotals`).
  const lines = await tx.$queryRaw<{ rate: number; ttc: bigint; vat: bigint }[]>`
    SELECT rate::float8 AS rate, SUM(ttc) AS ttc, SUM(ROUND(ttc * rate / (100 + rate))) AS vat
    FROM (SELECT "orderId", rate, SUM(ttc) AS ttc
          FROM (SELECT oi."orderId", oi."vatRate"::numeric AS rate, oi."lineTotal"::numeric AS ttc
                FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
                WHERE oi."tenantId" = ${tenantId} AND o."tenantId" = ${tenantId} AND o."cancelledAt" IS NULL
                  AND o."createdAt" >= ${r.start} AND o."createdAt" < ${r.end} AND oi."parentItemId" IS NULL AND oi.status <> 'CANCELLED'
                UNION ALL
                SELECT o.id, ${defaultVatRate}::numeric, (o."serviceCharge" + o."deliveryFee")::numeric
                FROM "Order" o
                WHERE o."tenantId" = ${tenantId} AND o."cancelledAt" IS NULL AND o."createdAt" >= ${r.start} AND o."createdAt" < ${r.end} AND o."serviceCharge" + o."deliveryFee" > 0) u
          GROUP BY "orderId", rate) per
    GROUP BY rate`;
  const byRate = new Map<number, { rate: number; ttc: number; vat: number }>();
  const add = (rate: number, ttc: number, vat: number) => {
    const x = byRate.get(rate) ?? byRate.set(rate, { rate, ttc: 0, vat: 0 }).get(rate)!;
    x.ttc += ttc; x.vat += vat;
  };
  for (const l of lines) add(l.rate, big(l.ttc), big(l.vat));
  const rows = [...byRate.values()].sort((a, b) => a.rate - b.rate).map((x) => ({ rate: x.rate, ttc: x.ttc, base: x.ttc - x.vat, vat: x.vat }));
  return { rows, totals: { ttc: rows.reduce((n, x) => n + x.ttc, 0), base: rows.reduce((n, x) => n + x.base, 0), vat: rows.reduce((n, x) => n + x.vat, 0) } };
}
