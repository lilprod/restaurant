import type { DiningTable, Reservation, TableLayoutEntry, TableShape } from "@restaurant/api-client";

/** Pas de la grille aimantée (unités du plan). */
export const GRID = 10;
export const MIN_SIZE = 40;
export const MAX_SIZE = 400;
/** Une réservation non installée est « bientôt » quand elle commence dans ce délai (même seuil que l'installation anticipée de l'API). */
export const SOON_MINUTES = 60;

export const DEFAULT_SIZE: Record<TableShape, { width: number; height: number }> = {
  round: { width: 90, height: 90 },
  square: { width: 90, height: 90 },
  rect: { width: 140, height: 90 },
};

export const snap = (v: number, grid = GRID) => Math.round(v / grid) * grid;
export const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

/** Position aimantée à la grille et gardée à l'intérieur de la salle. */
export function snapPosition(x: number, y: number, size: { width: number; height: number }, plan: { width: number; height: number }) {
  return { posX: clamp(snap(x), 0, plan.width - size.width), posY: clamp(snap(y), 0, plan.height - size.height) };
}

export const layoutOf = (t: Pick<DiningTable, keyof TableLayoutEntry>): TableLayoutEntry => ({
  id: t.id, posX: t.posX, posY: t.posY, width: t.width, height: t.height, shape: t.shape, rotation: t.rotation,
});

export const sameLayout = (a: TableLayoutEntry, b: TableLayoutEntry) =>
  a.posX === b.posX && a.posY === b.posY && a.width === b.width && a.height === b.height && a.shape === b.shape && a.rotation === b.rotation;

/** Changement de forme : rond et carré sont isométriques, le rectangle reprend une proportion 3:2. */
export function reshape(e: TableLayoutEntry, shape: TableShape): TableLayoutEntry {
  if (shape === e.shape) return e;
  if (shape === "rect") return { ...e, shape, width: clamp(Math.round(e.width * 1.5), MIN_SIZE, MAX_SIZE) };
  const side = Math.max(e.width, e.height) === e.width && e.shape === "rect" ? Math.round(e.width / 1.5) : Math.min(e.width, e.height);
  const s = clamp(side, MIN_SIZE, MAX_SIZE);
  return { ...e, shape, width: s, height: s };
}

export const rotate = (deg: number, by: number) => (((deg + by) % 360) + 360) % 360;

/** Chevauchement des boîtes (hors rotation) : sert à avertir dans l'éditeur. */
export const overlaps = (a: TableLayoutEntry, b: TableLayoutEntry) =>
  a.posX < b.posX + b.width && b.posX < a.posX + a.width && a.posY < b.posY + b.height && b.posY < a.posY + a.height;

export function overlappingIds(entries: TableLayoutEntry[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    if (overlaps(entries[i]!, entries[j]!)) { out.add(entries[i]!.id); out.add(entries[j]!.id); }
  }
  return out;
}

/** Prochain libellé libre : « T » + le plus grand numéro + 1. */
export function nextLabel(labels: string[]): string {
  const max = labels.reduce((m, l) => { const n = /^T(\d+)$/i.exec(l.trim()); return n ? Math.max(m, Number(n[1])) : m; }, 0);
  return `T${max + 1}`;
}

/** Premier emplacement libre (balayage par pas de 110) ; à défaut, le coin haut gauche. */
export function freeSpot(entries: TableLayoutEntry[], size: { width: number; height: number }, plan: { width: number; height: number }) {
  for (let y = 40; y + size.height <= plan.height; y += 110) {
    for (let x = 40; x + size.width <= plan.width; x += 110) {
      const probe = { id: "", posX: x, posY: y, ...size, shape: "rect" as const, rotation: 0 };
      if (!entries.some((e) => overlaps(probe, e))) return { posX: x, posY: y };
    }
  }
  return { posX: 40, posY: 40 };
}

/** Prochaine réservation à installer sur une table (en attente ou confirmée, dans l'heure ou en retard de moins de 30 min). */
export function nextReservationFor(tableIds: string[], reservations: Reservation[], now: number): Reservation | null {
  const limit = now + SOON_MINUTES * 60_000;
  return reservations
    .filter((r) => (r.status === "PENDING" || r.status === "CONFIRMED") && r.tables.some((t) => tableIds.includes(t.id)))
    .filter((r) => +new Date(r.startsAt) <= limit && +new Date(r.endsAt) > now)
    .sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt))[0] ?? null;
}

export type TileState = "free" | "occupied" | "cleaning" | "soon";

export function tileState(table: Pick<DiningTable, "status" | "openOrders">, soon: Reservation | null): TileState {
  if (table.status === "CLEANING") return "cleaning";
  if (table.status === "OCCUPIED" || table.openOrders.length) return "occupied";
  return soon ? "soon" : "free";
}

/** Tables à afficher sur un plan : actives de la salle. */
export const planTables = (tables: DiningTable[], planId: string) => tables.filter((t) => t.floorPlanId === planId && t.isActive);

/** Échelle d'affichage : le plan occupe la largeur disponible (jamais agrandi au-delà de `max`). */
export const fitScale = (available: number, planWidth: number, max = 1.5) => (available > 0 ? Math.min(available / planWidth, max) : 1);
