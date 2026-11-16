import { ArrowRight, CalendarClock } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSpacePath } from "@/providers/space";
import { useTimezone } from "../hooks";
import { useReservations } from "./hooks";
import { ReservationDetailDialog, ReservationStatusBadge } from "./reservation-detail";
import type { Reservation } from "@restaurant/api-client";
import { fmtTime } from "./time";

/** « Arrivées de l'heure » (accueil serveur) : réservations à venir dans l'heure ou en retard de moins de 30 min. */
export function ArrivalsCard() {
  const to = useSpacePath();
  const tz = useTimezone();
  // Fenêtre arrondie à 5 min : la clé de cache reste stable entre deux rafraîchissements.
  const [tick, setTick] = React.useState(() => Math.floor(Date.now() / 300_000));
  React.useEffect(() => { const id = setInterval(() => setTick(Math.floor(Date.now() / 300_000)), 60_000); return () => clearInterval(id); }, []);
  const from = new Date(tick * 300_000 - 30 * 60_000).toISOString();
  const until = new Date(tick * 300_000 + 65 * 60_000).toISOString();
  const q = useReservations({ from, to: until });
  const [open, setOpen] = React.useState<Reservation | null>(null);
  const list = (q.data ?? []).filter((r) => r.status === "PENDING" || r.status === "CONFIRMED");
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">Arrivées de l'heure</h2>
        <Button asChild variant="ghost" size="sm"><Link to={to("/reservations")}>Planning <ArrowRight /></Link></Button>
      </div>
      {q.isLoading ? <Skeleton className="h-24 rounded-lg" /> : (
        <Card className="overflow-hidden">
          {list.length === 0 ? (
            <p className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground"><CalendarClock className="size-4" /> Aucune arrivée prévue dans l'heure.</p>
          ) : (
            <ul className="divide-y divide-border">
              {list.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setOpen(r)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <span className="w-12 shrink-0 font-mono text-sm font-semibold tabular-nums">{fmtTime(r.startsAt, tz)}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{r.guestName}</span>
                      <span className="block truncate text-[12.5px] text-muted-foreground">{r.partySize} pers. · {r.tables.map((x) => x.label).join(" + ") || "sans table"}</span></span>
                    <ReservationStatusBadge status={r.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <ReservationDetailDialog reservation={open ? list.find((r) => r.id === open.id) ?? open : null} onClose={() => setOpen(null)} />
    </section>
  );
}
