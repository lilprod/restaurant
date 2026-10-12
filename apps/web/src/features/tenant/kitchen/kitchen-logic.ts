import type { Order, OrderItem, OrderItemStatus } from "@restaurant/api-client";

export type ElapsedTone = "normal" | "amber" | "red";

/** Temps de référence d'une commande : le plat le plus long encore en cuisine (15 min par défaut). */
export function referencePrepMinutes(items: Pick<OrderItem, "prepMinutes" | "status">[]): number {
  const active = items.filter((i) => i.status === "PENDING" || i.status === "IN_PROGRESS");
  const pool = active.length ? active : items;
  const max = pool.reduce((m, i) => Math.max(m, i.prepMinutes || 0), 0);
  return max > 0 ? max : 15;
}

/**
 * Couleur du chronomètre : ambre à partir de 75 % du temps de préparation du plat le plus long,
 * rouge une fois ce temps dépassé.
 */
export function elapsedTone(elapsedMs: number, prepMinutes: number): ElapsedTone {
  const ref = Math.max(1, prepMinutes) * 60_000;
  if (elapsedMs > ref) return "red";
  if (elapsedMs >= ref * 0.75) return "amber";
  return "normal";
}

/** 7:05, 1:02:09 */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Étape suivante d'un article en cuisine (tap) ; null quand il est prêt. */
export function nextKitchenStatus(s: OrderItemStatus): "IN_PROGRESS" | "READY" | null {
  if (s === "PENDING") return "IN_PROGRESS";
  if (s === "IN_PROGRESS") return "READY";
  return null;
}

/** Retour d'un cran (erreur de manipulation). */
export function previousKitchenStatus(s: OrderItemStatus): "PENDING" | "IN_PROGRESS" | null {
  if (s === "IN_PROGRESS") return "PENDING";
  if (s === "READY") return "IN_PROGRESS";
  return null;
}

export type BoardFilter = "all" | "todo" | "ready";

/** Une commande est « prête » en cuisine quand tous ses articles affichés sont prêts. */
export const isOrderReady = (o: Pick<Order, "items">) => o.items.length > 0 && o.items.every((i) => i.status === "READY");

export function boardCounts(orders: Pick<Order, "items">[]) {
  let pending = 0, inProgress = 0, ready = 0;
  for (const o of orders) for (const i of o.items) {
    if (i.status === "PENDING") pending += i.quantity;
    else if (i.status === "IN_PROGRESS") inProgress += i.quantity;
    else if (i.status === "READY") ready += i.quantity;
  }
  return { pending, inProgress, ready };
}
