import type { DiningTable, Reservation } from "@restaurant/api-client";
import { localTimeToInstant, weekdayOf } from "@restaurant/utils";
import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { toneSurfaceClass } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { toastError } from "@/lib/errors";
import { useTenant, useTimezone } from "../hooks";
import { useApplyReservation, useOpeningHours } from "./hooks";
import { fmtTime, reservationTone } from "./time";

const PX_PER_HOUR = 80;
const ROW_H = 52;
const LABEL_W = 104;
const SNAP = 15;
const SHOWN = ["PENDING", "CONFIRMED", "SEATED", "COMPLETED"];

interface Drag { id: string; pointerId: number; x0: number; y0: number; dx: number; dy: number; moved: boolean }

/** Frise horaire par table : un bloc par réservation ; glisser (souris) pour décaler l'heure ou changer de table. */
export function Planning({ date, reservations, tables, onOpen }: {
  date: string; reservations: Reservation[]; tables: DiningTable[]; onOpen: (r: Reservation) => void;
}) {
  const t = useTenant();
  const tz = useTimezone();
  const apply = useApplyReservation();
  const hours = useOpeningHours();
  const [drag, setDrag] = React.useState<Drag | null>(null);
  const rowsRef = React.useRef<HTMLDivElement>(null);
  const scroller = React.useRef<HTMLDivElement>(null);

  const dayStart = React.useMemo(() => localTimeToInstant(date, "00:00", tz) ?? new Date(`${date}T00:00:00Z`), [date, tz]);
  const offset = (iso: string) => (+new Date(iso) - +dayStart) / 60_000;
  const shown = reservations.filter((r) => SHOWN.includes(r.status));

  // Plage affichée : horaires d'ouverture du jour et réservations, arrondie à l'heure.
  const { lo, hi } = React.useMemo(() => {
    const wd = weekdayOf(date);
    let lo = Infinity, hi = -Infinity;
    for (const r of hours.data?.ranges ?? []) {
      if (r.weekday !== wd) continue;
      const o = toMin(r.opensAt); let c = toMin(r.closesAt); if (c <= o) c += 1440;
      lo = Math.min(lo, o); hi = Math.max(hi, c);
    }
    for (const r of shown) { lo = Math.min(lo, offset(r.startsAt)); hi = Math.max(hi, offset(r.endsAt)); }
    if (!Number.isFinite(lo)) { lo = 11 * 60; hi = 23 * 60; }
    return { lo: Math.max(0, Math.floor(lo / 60) * 60), hi: Math.ceil(hi / 60) * 60 };
  }, [hours.data, date, shown]); // eslint-disable-line react-hooks/exhaustive-deps
  const ppm = PX_PER_HOUR / 60;
  const width = Math.max(1, (hi - lo)) * ppm;

  const rows: { id: string; label: string; sub: string }[] = tables.map((x) => ({ id: x.id, label: x.label, sub: `${x.capacity} pl.` }));
  if (shown.some((r) => r.tables.length === 0)) rows.push({ id: "none", label: "Sans table", sub: "" });

  const move = useMutation({
    mutationFn: (v: { r: Reservation; startsAt: Date; tableId?: string }) =>
      t.api.reservations.update(v.r.id, { startsAt: v.startsAt.toISOString() as never, ...(v.tableId ? { tableIds: [v.tableId] } : {}) }),
    onSuccess: (r) => { apply(r); toast.success(`Réservation déplacée à ${fmtTime(r.startsAt, tz)}`); },
    onError: (e) => toastError(e),
  });

  const canDrag = (r: Reservation) => t.isFloor && (r.status === "PENDING" || r.status === "CONFIRMED");
  const onDown = (e: React.PointerEvent, r: Reservation) => {
    if (!canDrag(r) || e.pointerType === "touch" || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: r.id, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, moved: false });
  };
  const onMove = (e: React.PointerEvent) => {
    setDrag((d) => (d && d.pointerId === e.pointerId ? { ...d, dx: e.clientX - d.x0, dy: e.clientY - d.y0, moved: d.moved || Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 5 } : d));
  };
  const onUp = (e: React.PointerEvent, r: Reservation, rowId: string) => {
    const d = drag;
    setDrag(null);
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.moved) { onOpen(r); return; }
    const mins = Math.round(d.dx / ppm / SNAP) * SNAP;
    const rowIdx = rows.findIndex((x) => x.id === rowId);
    const target = rows[Math.min(rows.length - 1, Math.max(0, rowIdx + Math.round(d.dy / ROW_H)))];
    const tableChanged = target && target.id !== rowId && target.id !== "none" && r.tables.length <= 1;
    if (mins === 0 && !tableChanged) return;
    move.mutate({ r, startsAt: new Date(+new Date(r.startsAt) + mins * 60_000), tableId: tableChanged ? target!.id : undefined });
  };

  const now = offset(new Date().toISOString());
  // Au changement de jour : on amène la prochaine réservation (ou la première) dans la vue.
  const anchorKey = `${date}|${lo}`;
  React.useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const upcoming = shown.map((r) => offset(r.startsAt)).filter((m) => m >= now - 30).sort((a, b) => a - b)[0] ?? shown.map((r) => offset(r.startsAt)).sort((a, b) => a - b)[0];
    el.scrollLeft = upcoming === undefined ? 0 : Math.max(0, (upcoming - lo) * ppm - 24);
  }, [anchorKey, shown.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const ticks = Array.from({ length: Math.ceil((hi - lo) / 60) + 1 }, (_, i) => lo + i * 60);

  if (rows.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
      <div ref={scroller} className="overflow-x-auto" role="region" aria-label="Planning des tables" tabIndex={0}>
        <div style={{ width: width + LABEL_W }} className="relative">
          <div className="sticky top-0 z-10 flex h-8 border-b border-border bg-subtle text-[11px] text-muted-foreground">
            <div style={{ width: LABEL_W }} className="sticky left-0 z-20 shrink-0 border-r border-border bg-subtle" />
            <div className="relative flex-1">
              {ticks.map((m) => <span key={m} style={{ left: (m - lo) * ppm }} className="absolute top-2 -translate-x-1/2 font-mono tabular-nums first:translate-x-1">{String(Math.floor(m / 60) % 24).padStart(2, "0")}h</span>)}
            </div>
          </div>
          <div ref={rowsRef}>
            {rows.map((row) => (
              <div key={row.id} style={{ height: ROW_H }} className="flex border-b border-border last:border-b-0">
                <div style={{ width: LABEL_W }} className="sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r border-border bg-card px-3">
                  <span className="text-sm font-medium leading-tight">{row.label}</span>
                  {row.sub && <span className="font-mono text-[11px] text-muted-foreground">{row.sub}</span>}
                </div>
                <div className="relative flex-1" style={{ backgroundImage: "linear-gradient(to right, var(--border) 1px, transparent 1px)", backgroundSize: `${PX_PER_HOUR}px 100%` }}>
                  {shown.filter((r) => (row.id === "none" ? r.tables.length === 0 : r.tables.some((x) => x.id === row.id))).map((r) => {
                    const dragging = drag?.id === r.id && drag.moved;
                    const left = (offset(r.startsAt) - lo) * ppm;
                    const w = (offset(r.endsAt) - offset(r.startsAt)) * ppm;
                    return (
                      <button key={r.id} type="button"
                        onPointerDown={(e) => onDown(e, r)} onPointerMove={onMove} onPointerUp={(e) => onUp(e, r, row.id)} onPointerCancel={() => setDrag(null)}
                        onClick={(e) => { if (e.detail === 0 || !canDrag(r)) onOpen(r); }}
                        aria-label={`${r.guestName}, ${r.partySize} personnes, ${fmtTime(r.startsAt, tz)}, ${row.label}`}
                        style={{
                          left, width: Math.max(w - 2, 28), top: 4, height: ROW_H - 9,
                          transform: dragging ? `translate(${drag!.dx}px, ${drag!.dy}px)` : undefined,
                        }}
                        className={cn(
                          "absolute flex flex-col justify-center overflow-hidden rounded-md border border-[color-mix(in_oklab,currentColor_25%,transparent)] px-2 text-left text-[12px] leading-tight",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          toneSurfaceClass[reservationTone(r.status)],
                          r.status === "COMPLETED" && "opacity-60",
                          canDrag(r) && "cursor-grab touch-pan-x select-none",
                          dragging && "z-30 cursor-grabbing shadow-md",
                        )}>
                        <span className="truncate font-medium">{r.guestName}</span>
                        <span className="truncate font-mono text-[11px] opacity-80">{fmtTime(r.startsAt, tz)} · {r.partySize} pers.</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {now > lo && now < hi && (
            <div aria-hidden style={{ left: LABEL_W + (now - lo) * ppm }} className="pointer-events-none absolute bottom-0 top-0 z-[5] w-px bg-danger">
              <span className="absolute -top-0 left-1 rounded bg-danger px-1 font-mono text-[10px] text-danger-foreground">{fmtTime(new Date(), tz)}</span>
            </div>
          )}
        </div>
      </div>
      <p className="border-t border-border bg-subtle px-4 py-2 text-[12px] text-muted-foreground">
        {t.isFloor ? "Cliquez sur une réservation pour la gérer ; à la souris, glissez-la pour changer l'heure (pas de 15 min) ou de table." : "Cliquez sur une réservation pour voir sa fiche."}
      </p>
    </div>
  );
}

const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h! * 60 + m!; };
