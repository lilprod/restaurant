import type { Reservation } from "@restaurant/api-client";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Search } from "lucide-react";
import * as React from "react";
import { toneDotClass } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { RESERVATION_SOURCE_LABEL } from "@/lib/labels";
import { useDebounced, useUrlParam } from "@/lib/use-url-state";
import { LiveIndicator } from "@/components/live-indicator";
import { useTenant, useTimezone } from "../hooks";
import { useTables } from "../tables/tables-page";
import { useReservationAction, useReservations, useWaitlist } from "./hooks";
import { Planning } from "./planning";
import { ReservationDetailDialog, ReservationStatusBadge } from "./reservation-detail";
import { ReservationFormDialog } from "./reservation-form";
import { addDays, fmtDay, fmtTime, reservationTone, todayIn } from "./time";
import { WaitlistPanel } from "./waitlist-panel";

type Filter = "all" | "todo" | "seated" | "done";
const FILTERS: Record<Filter, string[] | null> = { all: null, todo: ["PENDING", "CONFIRMED"], seated: ["SEATED"], done: ["COMPLETED", "CANCELLED", "NO_SHOW"] };

/** Réservations : planning du jour (frise par table), liste et liste d'attente. */
export function ReservationsPage() {
  const t = useTenant();
  const tz = useTimezone();
  const today = todayIn(tz);
  const [date, setDate] = useUrlParam("date", today);
  const [view, setView] = useUrlParam("vue", "planning");
  const [filter, setFilter] = useUrlParam("statut", "all");
  const [search, setSearch] = React.useState("");
  const q = useDebounced(search.trim().toLowerCase());
  const [creating, setCreating] = React.useState(false);
  const [open, setOpen] = React.useState<Reservation | null>(null);

  const res = useReservations({ date });
  const tables = useTables();
  const waitlist = useWaitlist();
  const activeTables = (tables.data ?? []).filter((x) => x.isActive);
  const all = res.data ?? [];
  const live = all.filter((r) => ["PENDING", "CONFIRMED", "SEATED"].includes(r.status));
  const covers = live.reduce((n, r) => n + r.partySize, 0);
  const toConfirm = all.filter((r) => r.status === "PENDING").length;
  const waiting = waitlist.data?.length ?? 0;

  // La fiche ouverte suit la liste (temps réel) ; si la réservation disparaît de la liste on garde la dernière version.
  const openLive = open ? all.find((r) => r.id === open.id) ?? open : null;

  const listed = all.filter((r) => {
    const f = FILTERS[filter as Filter];
    if (f && !f.includes(r.status)) return false;
    if (!q) return true;
    return [r.guestName, r.guestPhone ?? "", r.code].some((v) => v.toLowerCase().includes(q));
  });

  return (
    <>
      <PageHeader
        eyebrow={<LiveIndicator className="w-fit" />}
        title="Réservations"
        description={`${live.length} réservation${live.length > 1 ? "s" : ""} · ${covers} couvert${covers > 1 ? "s" : ""}${toConfirm ? ` · ${toConfirm} à confirmer` : ""}`}
        actions={t.isFloor ? <Button variant="primary" onClick={() => setCreating(true)}><CalendarPlus /> Nouvelle réservation</Button> : undefined}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="icon" aria-label="Jour précédent" onClick={() => setDate(addDays(date, -1))}><ChevronLeft /></Button>
        <Input type="date" aria-label="Jour affiché" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-40 font-mono" />
        <Button variant="secondary" size="icon" aria-label="Jour suivant" onClick={() => setDate(addDays(date, 1))}><ChevronRight /></Button>
        {date !== today && <Button variant="ghost" onClick={() => setDate(today)}>Aujourd'hui</Button>}
        <p className="ml-1 w-full text-sm font-medium text-muted-foreground sm:ml-2 sm:w-auto">{fmtDay(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
      </div>

      <Tabs value={view} onValueChange={setView}>
        <TabsList>
          <TabsTrigger value="planning">Planning</TabsTrigger>
          <TabsTrigger value="liste" count={all.length || undefined}>Liste</TabsTrigger>
          <TabsTrigger value="attente" count={waiting || undefined}>Liste d'attente</TabsTrigger>
        </TabsList>

        <TabsContent value="planning" className="pt-5">
          {res.isLoading || tables.isLoading ? <Skeleton className="h-64 rounded-lg" />
            : res.isError ? <ErrorState error={res.error} onRetry={() => res.refetch()} />
            : activeTables.length === 0 ? (
              <EmptyState icon={<CalendarDays />} title="Aucune table" description="Ajoutez des tables pour construire le planning." />
            ) : (
              <>
                {live.length === 0 && <p className="mb-3 text-sm text-muted-foreground">Aucune réservation ce jour-là.</p>}
                <Planning date={date} reservations={all} tables={activeTables} onOpen={setOpen} />
              </>
            )}
        </TabsContent>

        <TabsContent value="liste" className="flex flex-col gap-4 pt-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Segmented ariaLabel="Filtrer par statut" value={filter as Filter} onChange={setFilter} size="sm"
              options={[{ value: "all", label: "Toutes" }, { value: "todo", label: "À venir" }, { value: "seated", label: "Installées" }, { value: "done", label: "Closes" }]} />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom, téléphone ou code" aria-label="Rechercher une réservation" leading={<Search className="size-4" />} className="sm:w-72" />
          </div>
          {res.isLoading ? <div className="flex flex-col gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
            : res.isError ? <ErrorState error={res.error} onRetry={() => res.refetch()} />
            : listed.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border">
                <EmptyState icon={<CalendarDays />} title={all.length ? "Aucun résultat" : "Aucune réservation ce jour-là"}
                  description={all.length ? "Changez de filtre ou de recherche." : "Les réservations en ligne et par téléphone apparaissent ici."}
                  action={t.isFloor && !all.length ? <Button variant="primary" onClick={() => setCreating(true)}><CalendarPlus /> Nouvelle réservation</Button> : undefined} />
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {listed.map((r) => <ReservationRow key={r.id} r={r} tz={tz} onOpen={() => setOpen(r)} />)}
              </ul>
            )}
        </TabsContent>

        <TabsContent value="attente" className="pt-5"><WaitlistPanel date={date} /></TabsContent>
      </Tabs>

      <ReservationFormDialog open={creating} onOpenChange={setCreating} defaultDate={date >= today ? date : today} onSaved={(r) => setOpen(r)} />
      <ReservationDetailDialog reservation={openLive} onClose={() => setOpen(null)} />
    </>
  );
}

function ReservationRow({ r, tz, onOpen }: { r: Reservation; tz: string; onOpen: () => void }) {
  const t = useTenant();
  const action = useReservationAction();
  const next = !t.isFloor ? null : r.status === "PENDING" ? { a: "confirm" as const, l: "Confirmer" } : r.status === "CONFIRMED" ? { a: "seat" as const, l: "Installer" } : r.status === "SEATED" ? { a: "complete" as const, l: "Terminer" } : null;
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-xs sm:flex-row sm:items-center sm:gap-4 sm:p-4">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-4 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex w-14 shrink-0 flex-col items-center gap-1">
          <span className="font-mono text-base font-semibold tabular-nums">{fmtTime(r.startsAt, tz)}</span>
          <span aria-hidden className={cn("h-1 w-8 rounded-full", toneDotClass[reservationTone(r.status)])} />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium">{r.guestName}</span>
          <span className="truncate text-[13px] text-muted-foreground">
            {r.partySize} pers. · {r.tables.length ? r.tables.map((x) => x.label).join(" + ") : "sans table"} · {RESERVATION_SOURCE_LABEL[r.source]} · <span className="font-mono">{r.code}</span>
          </span>
        </span>
      </button>
      <div className="flex items-center justify-between gap-2 sm:justify-end">
        <ReservationStatusBadge status={r.status} />
        {r.noShowSuggested && <span className="text-[12px] font-medium text-danger">En retard</span>}
        {next && <Button size="sm" variant={r.status === "CONFIRMED" || r.status === "PENDING" ? "primary" : "secondary"} loading={action.isPending} onClick={() => action.mutate({ id: r.id, action: next.a })}>{next.l}</Button>}
      </div>
    </li>
  );
}
