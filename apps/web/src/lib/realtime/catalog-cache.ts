import type { DiningTable, MenuCategory, MenuItem } from "@restaurant/api-client";
import type { QueryClient } from "@tanstack/react-query";
import { tenantKeys } from "../tenant-keys";

type Root = readonly unknown[];

/** Charge utile de `menu.updated` : le plat (`menuItemView`), ou `{ id, deleted: true }` quand il est supprimé. */
export type MenuEvent = MenuItem | { id: string; deleted: true };
/** Charge utile de `table.updated` : un élément de `GET /tenant/tables`, ou `{ id, deleted: true }`. */
export type TableEvent = DiningTable | { id: string; deleted: true };

const byOrder = (a: MenuItem, b: MenuItem) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "fr");
const isDeleted = (e: MenuEvent | TableEvent): e is { id: string; deleted: true } => "deleted" in e && e.deleted === true;

/** Remplace, déplace, insère ou retire un plat dans la carte en cache ; `null` si la catégorie est inconnue (recharger). */
export function applyMenuItem(cats: MenuCategory[], e: MenuEvent): MenuCategory[] | null {
  const without = cats.map((c) => (c.items.some((i) => i.id === e.id) ? { ...c, items: c.items.filter((i) => i.id !== e.id) } : c));
  if (isDeleted(e) || e.archived) return without;
  if (!without.some((c) => c.id === e.categoryId)) return null;
  return without.map((c) => (c.id === e.categoryId ? { ...c, items: [...c.items, e].sort(byOrder) } : c));
}

/** Même règle que l'API : les tables sont triées par libellé (ordre naturel). */
export function applyTable(tables: DiningTable[], e: TableEvent): DiningTable[] {
  const rest = tables.filter((t) => t.id !== e.id);
  if (isDeleted(e)) return rest;
  return [...rest, e].sort((a, b) => a.label.localeCompare(b.label, "fr", { numeric: true }));
}

export function applyMenuEvent(qc: QueryClient, root: Root, e: MenuEvent) {
  const key = tenantKeys.menu(root);
  const cats = qc.getQueryData<MenuCategory[]>(key);
  if (!cats) return;
  const next = applyMenuItem(cats, e);
  if (next) qc.setQueryData(key, next);
  else void qc.invalidateQueries({ queryKey: key, exact: true });   // nouvelle catégorie : on recharge
}

export function applyTableEvent(qc: QueryClient, root: Root, e: TableEvent) {
  const key = tenantKeys.tables(root);
  const tables = qc.getQueryData<DiningTable[]>(key);
  if (!tables) return;
  // Table désactivée : selon le rôle, la liste la montre (grisée) ou non → on laisse l'API trancher.
  if (!isDeleted(e) && !e.isActive) void qc.invalidateQueries({ queryKey: key, exact: true });
  else qc.setQueryData(key, applyTable(tables, e));
}
