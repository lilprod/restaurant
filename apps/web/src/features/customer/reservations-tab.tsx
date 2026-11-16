import type { CustomerReservation } from "@restaurant/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CalendarPlus, CalendarX2, Clock, Users } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toastError } from "@/lib/errors";
import { RESERVATION_STATUS_LABEL } from "@/lib/labels";
import { useSpacePath } from "@/providers/space";
import { dayOf, fmtDay, fmtTime, reservationTone } from "../tenant/reservations/time";
import { EditForm } from "../public-reservation/manage-page";
import { useCustomer } from "./hooks";

/** Mes réservations : à venir (modifier, annuler) puis passées. */
export function ReservationsTab() {
  const c = useCustomer();
  const to = useSpacePath();
  const q = useQuery({ queryKey: c.key("reservations"), queryFn: () => c.api.reservations() });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <div className="flex flex-col gap-3" aria-busy="true"><Skeleton className="h-36 rounded-xl" /><Skeleton className="h-36 rounded-xl" /></div>;
  const now = Date.now();
  const upcoming = q.data.filter((r) => new Date(r.endsAt).getTime() >= now && ["PENDING", "CONFIRMED", "SEATED"].includes(r.status)).reverse();
  const past = q.data.filter((r) => !upcoming.includes(r));
  const book = <Button asChild variant="primary" size="lg"><Link to={to("/reserver")}><CalendarPlus /> Réserver une table</Link></Button>;
  if (!q.data.length) {
    return <EmptyState icon={<CalendarCheck />} title="Aucune réservation pour le moment" description="Réservez une table : vos réservations apparaîtront ici, avec la possibilité de les modifier ou de les annuler." action={book} />;
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex">{book}</div>
      <Group title="À venir" items={upcoming} empty="Aucune réservation à venir." />
      {past.length > 0 && <Group title="Passées" items={past} />}
    </div>
  );
}

function Group({ title, items, empty }: { title: string; items: CustomerReservation[]; empty?: string }) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{title}</h2>
      {items.length === 0 && empty ? <p className="text-sm text-muted-foreground">{empty}</p> : items.map((r) => <ReservationCard key={r.id} r={r} />)}
    </section>
  );
}

function ReservationCard({ r }: { r: CustomerReservation }) {
  const c = useCustomer();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = React.useState(false);
  const tz = r.restaurant.timezone;
  const open = ["PENDING", "CONFIRMED"].includes(r.status);
  const replace = (next: CustomerReservation) => qc.setQueryData<CustomerReservation[]>(c.key("reservations"), (list) => list?.map((x) => (x.id === next.id ? next : x)));
  const cancel = useMutation({ mutationFn: () => c.api.cancelReservation(r.id), onSuccess: (n) => { replace(n); toast.success("Réservation annulée"); }, onError: (e) => toastError(e) });
  const ask = () => confirm({
    title: "Annuler cette réservation ?",
    description: `Votre table du ${fmtDay(dayOf(r.startsAt, tz), { weekday: "long", day: "numeric", month: "long" })} à ${fmtTime(r.startsAt, tz)} sera libérée.`,
    confirmLabel: "Annuler la réservation", cancelLabel: "Garder ma table", tone: "danger", onConfirm: () => cancel.mutateAsync(),
  });
  return (
    <article className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5" data-testid="customer-reservation">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex items-center gap-2 font-medium"><CalendarCheck className="size-4 shrink-0 text-muted-foreground" />{fmtDay(dayOf(r.startsAt, tz), { weekday: "long", day: "numeric", month: "long" })}</p>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Clock className="size-3.5" /><span className="font-mono">{fmtTime(r.startsAt, tz)}</span></span>
            <span className="inline-flex items-center gap-1.5"><Users className="size-3.5" />{r.partySize} personne{r.partySize > 1 ? "s" : ""}</span>
            <span className="font-mono tracking-wider">{r.code}</span>
          </p>
          {r.specialRequests && <p className="text-sm text-muted-foreground">« {r.specialRequests} »</p>}
        </div>
        <Badge tone={reservationTone(r.status)} dot className="shrink-0">{RESERVATION_STATUS_LABEL[r.status] ?? r.status}</Badge>
      </div>
      {open && !editing && (r.canModify || r.canCancel) && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" size="lg" onClick={() => setEditing(true)} disabled={!r.canModify} className="sm:flex-1">Modifier</Button>
          <Button variant="danger-ghost" size="lg" onClick={ask} disabled={!r.canCancel} loading={cancel.isPending} className="sm:flex-1"><CalendarX2 /> Annuler</Button>
        </div>
      )}
      {open && !editing && !r.canModify && r.canCancel && <p className="text-[13px] text-muted-foreground">Le délai pour modifier en ligne est dépassé : appelez le restaurant{r.restaurant.phone ? ` au ${r.restaurant.phone}` : ""}.</p>}
      {editing && (
        <EditForm r={r} cacheKey={`account-${r.id}`} slots={(q) => c.api.reservationAvailability(r.id, q)} update={(b) => c.api.updateReservation(r.id, b)}
          onDone={(n) => { if (n) replace(n); setEditing(false); }} />
      )}
    </article>
  );
}
