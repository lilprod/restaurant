import type { Reservation, WaitlistEntry } from "@restaurant/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CalendarCheck, Clock, ExternalLink, Mail, Pencil, Phone, Users } from "lucide-react";
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { SwitchRow } from "@/components/ui/switch";
import { toastError } from "@/lib/errors";
import { RESERVATION_SOURCE_LABEL, RESERVATION_STATUS_LABEL } from "@/lib/labels";
import { applyWaitlistEvent } from "@/lib/realtime/reservation-cache";
import { tenantKeys } from "@/lib/tenant-keys";
import { useSpacePath } from "@/providers/space";
import { useTenant, useTimezone } from "../hooks";
import { useApplyReservation, useReservationAction, type ReservationAction } from "./hooks";
import { ReservationFormDialog } from "./reservation-form";
import { dayOf, fmtDay, fmtTime, reservationTone, todayIn } from "./time";

export function ReservationStatusBadge({ status }: { status: string }) {
  return <Badge tone={reservationTone(status)} dot>{RESERVATION_STATUS_LABEL[status] ?? status}</Badge>;
}

/** Fiche d'une réservation : informations, historique et actions selon le statut et le rôle. */
export function ReservationDetailDialog({ reservation, onClose }: { reservation: Reservation | null; onClose: () => void }) {
  return (
    <Dialog open={!!reservation} onOpenChange={(o) => { if (!o) onClose(); }} size="md"
      title={reservation ? <span className="flex items-center gap-2">{reservation.guestName}<ReservationStatusBadge status={reservation.status} /></span> : "Réservation"}
      description={reservation ? <>Code <span className="font-mono">{reservation.code}</span> · {RESERVATION_SOURCE_LABEL[reservation.source]}</> : undefined}>
      {reservation && <Detail id={reservation.id} initial={reservation} onClose={onClose} />}
    </Dialog>
  );
}

function Detail({ id, initial, onClose }: { id: string; initial: Reservation; onClose: () => void }) {
  const t = useTenant();
  const tz = useTimezone();
  const to = useSpacePath();
  const navigate = useNavigate();
  // Le cache est mis à jour par le temps réel : la fiche suit les changements faits ailleurs.
  const q = useQuery({ queryKey: tenantKeys.reservation(t.root, id), queryFn: () => t.api.reservations.get(id), initialData: initial, staleTime: 30_000 });
  const r = q.data;
  const [edit, setEdit] = React.useState(false);
  const [cancel, setCancel] = React.useState(false);
  const [matches, setMatches] = React.useState<WaitlistEntry[] | null>(null);

  const action = useReservationAction((a: ReservationAction, res) => {
    if (a === "confirm") toast.success("Réservation confirmée");
    if (a === "seat") {
      toast.success(`${res.guestName} est installé`, {
        description: res.tables.map((x) => x.label).join(" + "),
        action: { label: "Ouvrir la commande", onClick: () => navigate(orderUrl(res)) },
      });
    }
    if (a === "complete") toast.success("Réservation terminée");
    if (a === "no-show") toast.success("Marquée absente");
  });
  const matchesQ = useMutation({
    mutationFn: () => t.api.reservations.waitlistMatches(id),
    onSuccess: (list) => (list.length ? setMatches(list) : toast.info("Aucune entrée de la liste d'attente ne correspond.")),
    onError: (e) => toastError(e),
  });
  const orderUrl = (res: Reservation) => to(`/commandes/nouvelle?table=${res.tables[0]?.id ?? ""}&reservation=${res.id}`);
  const busy = action.isPending;
  const run = (a: ReservationAction) => action.mutate({ id, action: a });
  const started = Date.now() >= +new Date(r.startsAt);
  const canWrite = t.isFloor;

  return (
    <div className="flex flex-col gap-5">
      {r.noShowSuggested && r.status !== "NO_SHOW" && (
        <Callout tone="warning" title="Le client est en retard" action={canWrite ? <Button size="sm" variant="secondary" onClick={() => run("no-show")} loading={busy}>Marquer absent</Button> : undefined}>
          Le délai de tolérance est dépassé : confirmez l'absence pour libérer la table.
        </Callout>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
        <Info icon={<CalendarCheck />} label="Date" value={<span>{fmtDay(dayOf(r.startsAt, tz))}</span>} />
        <Info icon={<Clock />} label="Heure" value={<span className="font-mono tabular-nums">{fmtTime(r.startsAt, tz)} – {fmtTime(r.endsAt, tz)}</span>} />
        <Info icon={<Users />} label="Personnes" value={<span className="font-mono">{r.partySize}</span>} />
        <Info label="Table" value={r.tables.length ? r.tables.map((x) => x.label).join(" + ") : "Non attribuée"} />
        {r.guestPhone && <Info icon={<Phone />} label="Téléphone" value={<a className="font-mono underline-offset-4 hover:underline" href={`tel:${r.guestPhone}`}>{r.guestPhone}</a>} />}
        {r.guestEmail && <Info icon={<Mail />} label="Email" value={<span className="break-all">{r.guestEmail}</span>} />}
      </dl>
      {r.specialRequests && <Block title="Demandes du client">{r.specialRequests}</Block>}
      {r.notes && <Block title="Notes internes">{r.notes}</Block>}
      {r.overrideReason && <Block title="Réservation forcée">{r.overrideReason}</Block>}
      {r.cancelReason && <Block title="Motif d'annulation">{r.cancelReason}</Block>}
      <History r={r} tz={tz} />

      {canWrite ? (
        <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:flex-wrap sm:justify-end">
          {r.status === "PENDING" && <Button variant="primary" onClick={() => run("confirm")} loading={busy}>Confirmer</Button>}
          {r.status === "CONFIRMED" && <Button variant="primary" onClick={() => run("seat")} loading={busy}>Installer</Button>}
          {r.status === "SEATED" && (r.orderId
            ? <Button variant="primary" asChild><Link to={to(`/commandes/${r.orderId}`)} onClick={onClose}><ExternalLink /> Voir la commande</Link></Button>
            : <Button variant="primary" asChild><Link to={orderUrl(r)} onClick={onClose}><ExternalLink /> Ouvrir la commande</Link></Button>)}
          {r.status === "SEATED" && <Button onClick={() => run("complete")} loading={busy}>Terminer</Button>}
          {(r.status === "PENDING" || r.status === "CONFIRMED") && (
            <Button onClick={() => run("no-show")} loading={busy} disabled={!started} title={!started ? "Possible après l'heure prévue" : undefined}>Absent</Button>
          )}
          {["PENDING", "CONFIRMED", "SEATED"].includes(r.status) && <Button onClick={() => setEdit(true)}><Pencil /> Modifier</Button>}
          {(r.status === "PENDING" || r.status === "CONFIRMED") && <Button variant="danger-ghost" onClick={() => setCancel(true)}>Annuler</Button>}
          {r.status === "CANCELLED" && <Button onClick={() => matchesQ.mutate()} loading={matchesQ.isPending}><BellRing /> Liste d'attente</Button>}
        </div>
      ) : <p className="border-t border-border pt-4 text-[13px] text-muted-foreground">Lecture seule : la salle gère les réservations.</p>}

      <ReservationFormDialog open={edit} onOpenChange={setEdit} reservation={r} defaultDate={dayOf(r.startsAt, tz)} />
      <CancelDialog reservation={r} open={cancel} onOpenChange={setCancel} onCancelled={(list) => { onClose(); if (list.length) setMatches(list); }} />
      <WaitlistMatchesDialog entries={matches} onClose={() => setMatches(null)} freed={r} />
    </div>
  );
}

function Info({ icon, label, value }: { icon?: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground [&_svg]:size-3.5">{icon}{label}</dt>
      <dd className="min-w-0">{value}</dd>
    </div>
  );
}
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-subtle px-3.5 py-3">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{title}</p>
      <p className="whitespace-pre-wrap break-words text-sm">{children}</p>
    </div>
  );
}
function History({ r, tz }: { r: Reservation; tz: string }) {
  const rows = [
    ["Créée", r.createdAt], ["Confirmée", r.confirmedAt], ["Rappel envoyé", r.reminderSentAt], ["Installée", r.seatedAt],
    ["Terminée", r.completedAt], ["Annulée", r.cancelledAt], ["Absente", r.noShowAt],
  ].filter((x): x is [string, string] => !!x[1]);
  return (
    <ul className="flex flex-col gap-1 text-[12.5px] text-muted-foreground" aria-label="Historique">
      {rows.map(([l, d]) => <li key={l}>{l} le {fmtDay(dayOf(d, tz), { day: "numeric", month: "short" })} à <span className="font-mono">{fmtTime(d, tz)}</span></li>)}
    </ul>
  );
}

/** Annulation : motif facultatif, prévenir ou non le client ; propose ensuite les entrées compatibles de la liste d'attente. */
function CancelDialog({ reservation, open, onOpenChange, onCancelled }: {
  reservation: Reservation; open: boolean; onOpenChange: (o: boolean) => void; onCancelled: (matches: WaitlistEntry[]) => void;
}) {
  const t = useTenant();
  const apply = useApplyReservation();
  const [reason, setReason] = React.useState("");
  const [notify, setNotify] = React.useState(true);
  const reachable = !!(reservation.guestEmail || reservation.guestPhone);
  const cancel = useMutation({
    mutationFn: () => t.api.reservations.cancel(reservation.id, { reason: reason.trim() || undefined, notifyGuest: notify && reachable }),
    onSuccess: ({ waitlistMatches, ...r }) => {
      apply(r);
      toast.success("Réservation annulée");
      onOpenChange(false);
      onCancelled(waitlistMatches);
    },
    onError: (e) => toastError(e),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm" title="Annuler la réservation"
      description={`La table de ${reservation.guestName} sera libérée pour ce créneau.`}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Garder</Button><Button variant="danger" onClick={() => cancel.mutate()} loading={cancel.isPending}>Annuler la réservation</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Motif (facultatif)"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
        <SwitchRow label="Prévenir le client" description={reachable ? "Un message d'annulation lui est envoyé." : "Aucune coordonnée enregistrée."}
          checked={notify && reachable} onCheckedChange={setNotify} disabled={!reachable} />
      </div>
    </Dialog>
  );
}

/** Entrées de la liste d'attente compatibles avec un créneau libéré : prévenir ou convertir. */
export function WaitlistMatchesDialog({ entries, onClose, freed }: { entries: WaitlistEntry[] | null; onClose: () => void; freed?: Reservation }) {
  const t = useTenant();
  const tz = useTimezone();
  const qc = useQueryClient();
  const [convert, setConvert] = React.useState<WaitlistEntry | null>(null);
  const notify = useMutation({
    mutationFn: (id: string) => t.api.waitlist.notify(id),
    onSuccess: (w) => {
      applyWaitlistEvent(qc, t.root, w);
      toast.success(w.notifications.includes("queued") ? `${w.guestName} est prévenu` : "Aucun message envoyé : canal ou coordonnées indisponibles");
    },
    onError: (e) => toastError(e),
  });
  return (
    <>
      <Dialog open={!!entries && !convert} onOpenChange={(o) => { if (!o) onClose(); }} size="md"
        title="Une table s'est libérée"
        description={freed ? `Clients en attente compatibles avec ${fmtTime(freed.startsAt, tz)}, les plus anciens d'abord.` : "Clients en attente compatibles, les plus anciens d'abord."}>
        <ul className="flex flex-col divide-y divide-border">
          {(entries ?? []).map((w) => (
            <li key={w.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium">{w.guestName} <span className="font-normal text-muted-foreground">· {w.partySize} pers.</span></p>
                <p className="text-[13px] text-muted-foreground">Souhaite <span className="font-mono">{fmtTime(w.desiredAt, tz)}</span>{w.status === "NOTIFIED" && " · déjà prévenu"}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => notify.mutate(w.id)} loading={notify.isPending && notify.variables === w.id} disabled={!w.guestPhone && !w.guestEmail}><BellRing /> Prévenir</Button>
                <Button size="sm" variant="primary" onClick={() => setConvert(w)}>Réserver</Button>
              </div>
            </li>
          ))}
        </ul>
      </Dialog>
      {convert && <ReservationFormDialog open onOpenChange={(o) => { if (!o) { setConvert(null); onClose(); } }} fromWaitlist={convert} defaultDate={dayOf(convert.desiredAt, tz) || todayIn(tz)} />}
    </>
  );
}
