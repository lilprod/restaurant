import { ApiError, type PublicReservation } from "@restaurant/api-client";
import { publicUpdateReservationSchema } from "@restaurant/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CalendarX2, Clock, Phone, Users } from "lucide-react";
import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { publicSpace } from "@/app/spaces";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { useConfirm } from "@/components/ui/confirm";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Stepper } from "@/components/ui/stepper";
import { errorMessage, toastError } from "@/lib/errors";
import { RESERVATION_STATUS_LABEL } from "@/lib/labels";
import { dayOf, fmtDay, fmtTime, reservationTone, todayIn } from "../tenant/reservations/time";
import { DayChips, PublicShell, PublicSlots, usePublicSlug } from "./shared";

/** Gestion d'une réservation par lien (sans compte) : consulter, modifier (nombre, créneau, demandes), annuler. */
export function ManageReservationPage() {
  const { token = "" } = useParams();
  const slug = usePublicSlug();
  const qc = useQueryClient();
  const key = ["public", "reservation", token];
  const q = useQuery({ queryKey: key, queryFn: () => publicSpace.reservation(token), retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 });
  const [editing, setEditing] = React.useState(false);
  const confirm = useConfirm();
  const r = q.data;

  if (q.isError && q.error instanceof ApiError && q.error.status === 404) {
    return <PublicShell title="Réservation"><EmptyState icon={<CalendarX2 />} title="Lien invalide" description="Cette réservation est introuvable. Vérifiez le lien reçu par email ou contactez le restaurant." /></PublicShell>;
  }
  if (q.isError) return <PublicShell title="Réservation"><ErrorState error={q.error} onRetry={() => q.refetch()} /></PublicShell>;
  if (!r) return <PublicShell title="Réservation"><div className="flex flex-col gap-4" aria-busy="true"><Skeleton className="h-8 w-48" /><Skeleton className="h-52 rounded-xl" /></div></PublicShell>;

  const tz = r.restaurant.timezone;
  const closed = !["PENDING", "CONFIRMED"].includes(r.status);
  const cancel = () => confirm({
    title: "Annuler votre réservation ?",
    description: `Votre table du ${fmtDay(dayOf(r.startsAt, tz), { weekday: "long", day: "numeric", month: "long" })} à ${fmtTime(r.startsAt, tz)} sera libérée. Cette action est définitive.`,
    confirmLabel: "Annuler la réservation", cancelLabel: "Garder ma table", tone: "danger",
    onConfirm: async () => {
      try { qc.setQueryData(key, await publicSpace.cancelReservation(token)); toast.success("Réservation annulée"); } catch (e) { toastError(e); throw e; }
    },
  });

  return (
    <PublicShell title="Ma réservation">
      <div className="flex flex-col gap-6" data-testid="manage-reservation">
        <div className="flex flex-col gap-2">
          <Badge tone={reservationTone(r.status)} dot className="w-fit">{RESERVATION_STATUS_LABEL[r.status] ?? r.status}</Badge>
          <h1 className="font-brand text-[28px] font-semibold leading-tight tracking-tight">Bonjour {r.guestName}</h1>
          <p className="text-[15px] text-muted-foreground">
            {r.status === "PENDING" ? "Le restaurant doit encore confirmer votre demande."
              : r.status === "CONFIRMED" ? "Votre table est réservée."
              : r.status === "CANCELLED" ? "Cette réservation est annulée."
              : "Cette réservation est close."}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Code de réservation</p>
          <p className="mt-1 font-mono text-3xl font-semibold tracking-[0.18em]">{r.code}</p>
          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
            <div className="col-span-2 flex items-center gap-2"><CalendarCheck className="size-4 text-muted-foreground" /><span className="font-medium">{fmtDay(dayOf(r.startsAt, tz), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span></div>
            <div className="flex items-center gap-2"><Clock className="size-4 text-muted-foreground" /><span className="font-mono">{fmtTime(r.startsAt, tz)}</span></div>
            <div className="flex items-center gap-2"><Users className="size-4 text-muted-foreground" /><span>{r.partySize} personne{r.partySize > 1 ? "s" : ""}</span></div>
            {r.specialRequests && <div className="col-span-2 text-muted-foreground">« {r.specialRequests} »</div>}
          </dl>
          <p className="mt-4 border-t border-border pt-3 text-[13px] text-muted-foreground">{r.restaurant.name}{r.restaurant.phone && <> · <Phone className="inline size-3" /> <a className="font-mono underline-offset-4 hover:underline" href={`tel:${r.restaurant.phone}`}>{r.restaurant.phone}</a></>}</p>
        </div>

        {!closed && !editing && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button size="lg" onClick={() => setEditing(true)} disabled={!r.canModify} className="sm:flex-1">Modifier</Button>
            <Button size="lg" variant="danger-ghost" onClick={cancel} disabled={!r.canCancel} className="sm:flex-1">Annuler la réservation</Button>
          </div>
        )}
        {!closed && !editing && (!r.canModify || !r.canCancel) && (
          <Callout tone="info">{!r.canCancel ? "Cette réservation a déjà commencé." : "Le délai pour modifier en ligne est dépassé."} Contactez directement le restaurant{r.restaurant.phone ? ` au ${r.restaurant.phone}` : ""}.</Callout>
        )}
        {editing && <EditForm r={r} slug={slug || r.restaurant.slug} token={token} onDone={(next) => { if (next) qc.setQueryData(key, next); setEditing(false); }} />}
        {closed && <Button asChild variant="secondary" size="lg" className="w-fit"><Link to={`/r/${r.restaurant.slug}/reserver`}>Réserver une autre table</Link></Button>}
      </div>
    </PublicShell>
  );
}

function EditForm({ r, slug, token, onDone }: { r: PublicReservation; slug: string; token: string; onDone: (r?: PublicReservation) => void }) {
  const tz = r.restaurant.timezone;
  const today = todayIn(tz);
  const [party, setParty] = React.useState(r.partySize);
  const [date, setDate] = React.useState(dayOf(r.startsAt, tz));
  const [startsAt, setStartsAt] = React.useState<string | null>(r.startsAt);
  const [requests, setRequests] = React.useState(r.specialRequests ?? "");
  const avail = useQuery({
    queryKey: ["public", "availability", slug, date, party],
    queryFn: () => publicSpace.availability(slug, { date, partySize: party }),
    placeholderData: (p) => p,
  });
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      if (party !== r.partySize) body.partySize = party;
      if (startsAt && startsAt !== r.startsAt) body.startsAt = new Date(startsAt);
      if (requests.trim() !== (r.specialRequests ?? "")) body.specialRequests = requests;
      const parsed = publicUpdateReservationSchema.safeParse(body);
      if (!parsed.success) throw new Error("Aucune modification à enregistrer.");
      return publicSpace.updateReservation(token, { ...parsed.data, startsAt: parsed.data.startsAt?.toISOString() } as never);
    },
    onSuccess: (next) => { toast.success("Réservation modifiée"); onDone(next); },
    onError: (e) => { if (e instanceof ApiError && e.status === 409) void avail.refetch(); },
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="flex flex-col gap-5 rounded-xl border border-border bg-card p-5 shadow-sm">
      <h2 className="text-base font-semibold">Modifier ma réservation</h2>
      <Field label="Personnes"><div><Stepper label="personnes" size="lg" value={party} min={1} max={30} onChange={setParty} /></div></Field>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Jour</span>
        <DayChips value={date} onChange={(d) => { setDate(d); setStartsAt(null); }} today={today} tz={tz} />
        <Input type="date" aria-label="Autre date" min={today} value={date} onChange={(e) => { if (e.target.value) { setDate(e.target.value); setStartsAt(null); } }} className="font-mono sm:w-48" />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Heure</span>
        <PublicSlots data={avail.data} loading={avail.isLoading} error={avail.error} value={startsAt} onChange={setStartsAt} onRetry={() => avail.refetch()} extra={r.startsAt} />
      </div>
      <Field label="Demandes particulières"><Textarea rows={2} value={requests} onChange={(e) => setRequests(e.target.value)} maxLength={500} /></Field>
      {save.isError && <Callout tone="danger" title={errorMessage(save.error)} />}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={() => onDone()}>Fermer</Button>
        <Button type="submit" variant="primary" loading={save.isPending} disabled={!startsAt}>Enregistrer</Button>
      </div>
    </form>
  );
}
