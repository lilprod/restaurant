import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/cn";
import { SkeletonRows } from "./skeleton";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  className?: string;
  /** Alignement (montants à droite). */
  align?: "left" | "right";
  /** Masqué dans la vue « cartes » sur mobile. */
  hideOnMobile?: boolean;
}

interface DataTableProps<T> {
  rows: T[] | undefined;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: React.ReactNode;
  onRowClick?: (row: T) => void;
  /** Rendu personnalisé en carte sur petit écran ; par défaut : colonnes empilées. */
  mobileCard?: (row: T) => React.ReactNode;
  rowActions?: (row: T) => React.ReactNode;
  className?: string;
  footer?: React.ReactNode;
  caption?: string;
}

/**
 * Tableau responsive : vrai <table> à partir de `md`, cartes empilées en dessous.
 * Les lignes apparaissent en cascade et s'animent à l'ajout / au retrait (layout).
 */
export function DataTable<T>({ rows, columns, rowKey, loading, empty, onRowClick, mobileCard, rowActions, className, footer, caption }: DataTableProps<T>) {
  const isEmpty = !loading && rows && rows.length === 0;
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-card shadow-sm", className)}>
      {loading && !rows ? (
        <SkeletonRows rows={6} />
      ) : isEmpty ? (
        empty
      ) : (
        <>
          {/* Bureau */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              {caption && <caption className="sr-only">{caption}</caption>}
              <thead>
                <tr className="border-b border-border bg-subtle">
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className={cn("h-10 whitespace-nowrap px-4 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground", c.align === "right" && "text-right", c.className)}
                    >
                      {c.header}
                    </th>
                  ))}
                  {rowActions && <th className="w-12"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {rows?.map((row, i) => (
                    <motion.tr
                      key={rowKey(row)}
                      layout="position"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0, transition: { duration: 0.18, delay: Math.min(i, 12) * 0.018 } }}
                      exit={{ opacity: 0, transition: { duration: 0.12 } }}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={cn("group border-b border-border last:border-0 transition-colors", onRowClick && "cursor-pointer hover:bg-hover")}
                    >
                      {columns.map((c) => (
                        <td key={c.key} className={cn("h-14 whitespace-nowrap px-4 align-middle", c.align === "right" && "text-right", c.className)}>
                          {c.cell(row)}
                        </td>
                      ))}
                      {rowActions && (
                        <td className="px-2 text-right" onClick={(e) => e.stopPropagation()}>{rowActions(row)}</td>
                      )}
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
          {/* Mobile */}
          <ul className="divide-y divide-border md:hidden">
            {rows?.map((row) => (
              <li key={rowKey(row)} className="relative">
                <div
                  role={onRowClick ? "button" : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (e) => { if (e.key === "Enter") onRowClick(row); } : undefined}
                  className={cn("flex items-start gap-3 px-4 py-3.5", onRowClick && "active:bg-hover")}
                >
                  <div className="min-w-0 flex-1">
                    {mobileCard ? mobileCard(row) : (
                      <dl className="flex flex-col gap-1.5">
                        {columns.filter((c) => !c.hideOnMobile).map((c) => (
                          <div key={c.key} className="flex items-center justify-between gap-3 text-sm">
                            <dt className="shrink-0 text-xs text-muted-foreground">{c.header}</dt>
                            <dd className="min-w-0 truncate text-right">{c.cell(row)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                  {rowActions && <div className="-mr-2 -mt-1" onClick={(e) => e.stopPropagation()}>{rowActions(row)}</div>}
                </div>
              </li>
            ))}
          </ul>
          {footer}
        </>
      )}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border bg-subtle px-4 py-2.5 text-[13px] text-muted-foreground">
      <span className="tabular">{from}–{to} sur {total}</span>
      <div className="flex items-center gap-1">
        <button
          type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}
          className="h-10 rounded-md border border-border bg-background px-3 font-medium text-foreground shadow-xs disabled:opacity-40 sm:h-8"
        >
          Précédent
        </button>
        <span className="px-2 tabular">{page}/{pages}</span>
        <button
          type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}
          className="h-10 rounded-md border border-border bg-background px-3 font-medium text-foreground shadow-xs disabled:opacity-40 sm:h-8"
        >
          Suivant
        </button>
      </div>
    </div>
  );
}
