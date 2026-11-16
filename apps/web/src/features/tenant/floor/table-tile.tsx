import type { DiningTable, Reservation, TableLayoutEntry } from "@restaurant/api-client";
import { Brush, Clock, Link2, Users } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/cn";
import { formatFcfa } from "@/lib/format";
import { elapsedLabel } from "../hooks";
import { fmtTime } from "../reservations/time";
import type { TileState } from "./floor-geometry";

/** Couleurs par état (jetons de ton : jamais de couleur en dur). Le texte de l'état reste toujours écrit. */
export const TILE_SURFACE: Record<TileState, string> = {
  free: "border-[var(--tone-green-dot)] bg-[var(--tone-green-bg)] text-[var(--tone-green-fg)]",
  occupied: "border-[var(--tone-blue-dot)] bg-[var(--tone-blue-bg)] text-[var(--tone-blue-fg)]",
  cleaning: "border-[var(--tone-amber-dot)] bg-[var(--tone-amber-bg)] text-[var(--tone-amber-fg)]",
  soon: "border-dashed border-[var(--tone-gray-dot)] bg-[var(--tone-gray-bg)] text-[var(--tone-gray-fg)]",
};
export const TILE_DOT: Record<TileState, string> = {
  free: "bg-[var(--tone-green-dot)]", occupied: "bg-[var(--tone-blue-dot)]", cleaning: "bg-[var(--tone-amber-dot)]", soon: "bg-[var(--tone-gray-dot)]",
};
export const TILE_LABEL: Record<TileState, string> = { free: "Libre", occupied: "Occupée", cleaning: "À débarrasser", soon: "Réservée bientôt" };

export const shapeRadius = (shape: TableLayoutEntry["shape"]) => (shape === "round" ? "9999px" : shape === "square" ? "12px" : "10px");

/** Corps d'une tuile : boîte positionnée, tournée ; le contenu reste droit. */
export function TileFrame({ geo, scale, minSize = 56, className, style, children, ...rest }: {
  geo: TableLayoutEntry; scale: number; minSize?: number;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "style"> & { style?: React.CSSProperties }) {
  const w = Math.max(geo.width * scale, minSize), h = Math.max(geo.height * scale, minSize);
  // Une tuile agrandie au minimum tactile reste centrée sur son emplacement.
  const left = geo.posX * scale - (w - geo.width * scale) / 2, top = geo.posY * scale - (h - geo.height * scale) / 2;
  return (
    <button
      type="button"
      style={{ left, top, width: w, height: h, borderRadius: shapeRadius(geo.shape), transform: geo.rotation ? `rotate(${geo.rotation}deg)` : undefined, ...style }}
      className={cn("absolute flex items-center justify-center border-2 p-1 text-center shadow-xs transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background", className)}
      {...rest}
    >
      <span className="flex min-w-0 max-w-full flex-col items-center justify-center leading-tight" style={{ transform: geo.rotation ? `rotate(${-geo.rotation}deg)` : undefined }}>
        {children}
      </span>
    </button>
  );
}

/** Tuile du plan de service : numéro, état en toutes lettres, montant et durée, réservation proche. */
export function ServiceTile({ table, geo, scale, state, soon, group, now, tz, selected, onOpen }: {
  table: DiningTable; geo: TableLayoutEntry; scale: number; state: TileState; soon: Reservation | null;
  /** Table absorbée : affichée comme rattachée à sa principale. */
  group?: DiningTable; now: number; tz: string; selected?: boolean; onOpen: () => void;
}) {
  const order = (group ?? table).openOrders[0];
  const label = group ? `${table.label} (avec ${group.label})` : table.label;
  const heightPx = Math.max(geo.height * scale, 56);
  const roomy = heightPx >= 60;
  const name = [
    `Table ${label}`, TILE_LABEL[state], `${(group ?? table).capacity} places`,
    order ? `commande n°${order.number}, ${formatFcfa(order.total)}` : null,
    state === "soon" && soon ? `${soon.guestName} à ${fmtTime(soon.startsAt, tz)}` : null,
    group ? "tables fusionnées" : table.mergedTables.length ? `fusionnée avec ${table.mergedTables.map((m) => m.label).join(", ")}` : null,
  ].filter(Boolean).join(", ");
  return (
    <TileFrame
      geo={geo} scale={scale} onClick={onOpen} aria-label={name} aria-haspopup="dialog"
      className={cn(TILE_SURFACE[state], "hover:shadow-md active:scale-[0.98]", group && "border-dashed opacity-80", selected && "ring-2 ring-ring")}
    >
      <span className="flex items-center gap-1 text-[15px] font-semibold tracking-tight">
        {(group || table.mergedTables.length > 0) && <Link2 className="size-3.5 shrink-0" aria-hidden />}{table.label}
      </span>
      {roomy && !group && (
        <>
          {state === "occupied" && order ? (
            <>
              <span className="font-mono text-[12px] font-medium tabular-nums">{formatFcfa(order.total)}</span>
              <span className="font-mono text-[11px] tabular-nums opacity-80">{elapsedLabel(order.createdAt, now)}</span>
            </>
          ) : state === "cleaning" ? (
            <span className="flex items-center gap-1 text-[11px]"><Brush className="size-3" aria-hidden />À débarrasser</span>
          ) : state === "soon" && soon ? (
            <span className="flex items-center gap-1 font-mono text-[11px] tabular-nums"><Clock className="size-3" aria-hidden />{fmtTime(soon.startsAt, tz)}</span>
          ) : (
            <span className="flex items-center gap-1 text-[11px]"><Users className="size-3" aria-hidden />{table.capacity}</span>
          )}
        </>
      )}
    </TileFrame>
  );
}

