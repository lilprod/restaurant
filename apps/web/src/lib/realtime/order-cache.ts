import type { DiningTable, Order, OrdersQuery, Paginated, TableOpenOrder } from "@restaurant/api-client";
import type { QueryClient } from "@tanstack/react-query";
import { zonedDay } from "@restaurant/utils";
import { tenantKeys } from "../tenant-keys";

type Root = readonly unknown[];

const KITCHEN_STATES = new Set(["PENDING", "IN_PROGRESS", "READY"]);
const isOpen = (o: Pick<Order, "closedAt" | "cancelledAt">) => !o.closedAt && !o.cancelledAt;
const time = (d: string | null | undefined) => (d ? new Date(d).getTime() : 0);

/** Vrai si `next` est plus ancienne que `current` (événement arrivé en retard) : on l'ignore. */
export function isStale(current: Pick<Order, "updatedAt"> | undefined, next: Pick<Order, "updatedAt">): boolean {
  return !!current && time(next.updatedAt) < time(current.updatedAt);
}

/** La commande correspond-elle aux filtres d'une liste (mêmes règles que GET /tenant/orders) ? */
export function matchesOrderQuery(o: Order, q: OrdersQuery, timeZone = "Africa/Lome"): boolean {
  if (q.status && o.status !== q.status) return false;
  if (q.paymentStatus && o.paymentStatus !== q.paymentStatus) return false;
  if (q.type && o.type !== q.type) return false;
  if (q.tableId && o.table?.id !== q.tableId) return false;
  if (q.open === true && !isOpen(o)) return false;
  if (q.open === false && isOpen(o)) return false;
  if (q.date && zonedDay(new Date(o.createdAt), timeZone) !== q.date) return false;
  return true;
}

/** Vue « cuisine » d'une commande : seuls les articles à préparer ou prêts ; null si rien à afficher. */
export function kitchenView(o: Order): Order | null {
  if (o.cancelledAt) return null;
  const items = o.items.filter((i) => KITCHEN_STATES.has(i.status));
  return items.length ? { ...o, items } : null;
}

export function tableSummary(o: Order): TableOpenOrder {
  return { id: o.id, number: o.number, status: o.status, total: o.total, paidAmount: o.paidAmount, paymentStatus: o.paymentStatus, createdAt: o.createdAt };
}

function upsertList(page: Paginated<Order>, o: Order, q: OrdersQuery, timeZone: string): Paginated<Order> | "refetch" {
  const idx = page.items.findIndex((x) => x.id === o.id);
  const matches = matchesOrderQuery(o, q, timeZone);
  if (idx >= 0) {
    if (isStale(page.items[idx], o)) return page;
    if (matches) return { ...page, items: page.items.map((x, i) => (i === idx ? o : x)) };
    return { ...page, total: Math.max(0, page.total - 1), items: page.items.filter((_, i) => i !== idx) };
  }
  if (!matches) return page;
  // Nouvelle entrée : on l'insère à sa place (plus récentes d'abord) sur la première page seulement.
  if ((q.page ?? 1) > 1) return "refetch";
  const items = [...page.items, o].sort((a, b) => time(b.createdAt) - time(a.createdAt));
  const size = q.pageSize ?? page.pageSize;
  return { ...page, total: page.total + 1, items: items.slice(0, size) };
}

function upsertKitchen(board: Order[], o: Order): Order[] {
  const view = kitchenView(o);
  const idx = board.findIndex((x) => x.id === o.id);
  if (idx >= 0 && isStale(board[idx], o)) return board;
  const rest = board.filter((x) => x.id !== o.id);
  if (!view) return idx >= 0 ? rest : board;
  return [...rest, view].sort((a, b) => time(a.createdAt) - time(b.createdAt));
}

function upsertTables(tables: DiningTable[], o: Order): DiningTable[] {
  return tables.map((t) => {
    const had = t.openOrders.some((x) => x.id === o.id);
    const belongs = o.table?.id === t.id;
    if (!had && !belongs) return t;
    let openOrders = t.openOrders.filter((x) => x.id !== o.id);
    if (belongs && isOpen(o)) {
      openOrders = [...openOrders, tableSummary(o)].sort((a, b) => time(a.createdAt) - time(b.createdAt));
    }
    // Même règle que l'API (TablesService.syncStatus) : occupée tant qu'une commande est ouverte.
    let status = t.status;
    if (openOrders.length > 0) status = "OCCUPIED";
    else if (t.status === "OCCUPIED") status = "FREE";
    return { ...t, openOrders, status };
  });
}

/**
 * Applique un événement `order.created` / `order.updated` aux caches : détail, listes filtrées, écran cuisine,
 * tables. Les vues agrégées (tableau de bord, caisse) sont simplement invalidées (rechargées si affichées).
 */
export function applyOrderEvent(qc: QueryClient, root: Root, order: Order, opts: { timeZone?: string } = {}) {
  const tz = opts.timeZone ?? "Africa/Lome";

  const detailKey = tenantKeys.order(root, order.id);
  const current = qc.getQueryData<Order>(detailKey);
  if (current && !isStale(current, order)) qc.setQueryData(detailKey, order);

  for (const [key, data] of qc.getQueriesData<Paginated<Order>>({ queryKey: tenantKeys.orderLists(root) })) {
    if (!data) continue;
    const q = (key[key.length - 1] ?? {}) as OrdersQuery;
    const next = upsertList(data, order, q, tz);
    if (next === "refetch") void qc.invalidateQueries({ queryKey: key, exact: true });
    else if (next !== data) qc.setQueryData(key, next);
  }

  const board = qc.getQueryData<Order[]>(tenantKeys.kitchen(root));
  if (board) qc.setQueryData(tenantKeys.kitchen(root), upsertKitchen(board, order));

  const tables = qc.getQueryData<DiningTable[]>(tenantKeys.tables(root));
  if (tables) qc.setQueryData(tenantKeys.tables(root), upsertTables(tables, order));

  void qc.invalidateQueries({ queryKey: tenantKeys.dashboard(root) });
  void qc.invalidateQueries({ queryKey: tenantKeys.register(root) });
}

/** Après une reconnexion : on a pu manquer des événements, on recharge les vues de service. */
export function resyncServiceQueries(qc: QueryClient, root: Root) {
  for (const key of [tenantKeys.orders(root), tenantKeys.kitchen(root), tenantKeys.tables(root), tenantKeys.menu(root), tenantKeys.register(root), tenantKeys.dashboard(root)]) {
    void qc.invalidateQueries({ queryKey: key });
  }
}
