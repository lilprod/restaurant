import type { WaitlistEntry } from "@restaurant/api-client";
import { localTimeToInstant } from "@restaurant/utils";
import { waitlistInputSchema } from "@restaurant/validation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellRing, ListPlus, Trash2, UserRound } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Stepper } from "@/components/ui/stepper";
import { toastError } from "@/lib/errors";
import { WAITLIST_STATUS_LABEL } from "@/lib/labels";
import { applyWaitlistEvent } from "@/lib/realtime/reservation-cache";
import { useTenant, useTimezone } from "../hooks";
import { useWaitlist } from "./hooks";
import { ReservationFormDialog } from "./reservation-form";
import { dayOf, fmtDay, fmtTime, todayIn, waitlistTone } from "./time";

/** Liste d'attente : ajout, « une table s'est libérée » (prévenir), conversion en réservation, retrait. */
export function WaitlistPanel({ date }: { date: string }) {
  const t = useTenant();
  const tz = useTimezone();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const list = useWaitlist();
  const [adding, setAdding] = React.useState(false);
  const [convert, setConvert] = React.useState<WaitlistEntry | null>(null);

  const notify = useMutation({
    mutationFn: (id: string) => t.api.waitlist.notify(id),
    onSuccess: (w) => {
      applyWaitlistEvent(qc, t.root, w);
      if (w.notifications.includes("queued")) toast.success(`${w.guestName} est prévenu`);
      else toast.warning(`${w.guestName} est marqué prévenu, mais aucun message n'a été envoyé`, { description: "Vérifiez les canaux de notification (email, SMS)." });
    },
    onError: (e) => toastError(e),
  });
  const remove = (w: WaitlistEntry) => confirm({
    title: "Retirer de la liste d'attente", description: `${w.guestName} (${w.partySize} pers.) ne sera plus proposé pour une table libérée.`,
    confirmLabel: "Retirer", tone: "danger",
    onConfirm: async () => { applyWaitlistEvent(qc, t.root, await t.api.waitlist.remove(w.id)); toast.success("Retiré de la liste d'attente"); },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Clients sans table pour l'heure souhaitée. Quand une réservation est annulée, les entrées compatibles sont proposées.</p>
        {t.isFloor && <Button variant="primary" onClick={() => setAdding(true)} className="shrink-0"><ListPlus /> Ajouter</Button>}
      </div>
      {list.isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}</div>
      ) : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} />
      : !list.data?.length ? (
        <div className="rounded-lg border border-dashed border-border">
          <EmptyState icon={<UserRound />} title="Personne en attente" description="Ajoutez les clients qui attendent une table : vous pourrez les prévenir dès qu'une place se libère."
            action={t.isFloor ? <Button variant="primary" onClick={() => setAdding(true)}><ListPlus /> Ajouter un client</Button> : undefined} />
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.data.map((w) => (
            <li key={w.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">{w.guestName}
                  <Badge tone={waitlistTone(w.status)} dot>{WAITLIST_STATUS_LABEL[w.status]}</Badge></p>
                <p className="text-[13px] text-muted-foreground">
                  {w.partySize} pers. · <span>{fmtDay(dayOf(w.desiredAt, tz), { weekday: "short", day: "numeric", month: "short" })}</span> à <span className="font-mono">{fmtTime(w.desiredAt, tz)}</span>
                  {w.guestPhone && <> · <span className="font-mono">{w.guestPhone}</span></>}
                </p>
                {w.notes && <p className="text-[13px] text-muted-foreground">{w.notes}</p>}
              </div>
              {t.isFloor && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => notify.mutate(w.id)} loading={notify.isPending && notify.variables === w.id}
                    disabled={!w.guestPhone && !w.guestEmail} title={!w.guestPhone && !w.guestEmail ? "Aucune coordonnée" : undefined}><BellRing /> {w.status === "NOTIFIED" ? "Prévenir à nouveau" : "Prévenir"}</Button>
                  <Button size="sm" variant="primary" onClick={() => setConvert(w)}>Réserver</Button>
                  <Button size="icon-sm" variant="danger-ghost" aria-label={`Retirer ${w.guestName}`} onClick={() => remove(w)}><Trash2 /></Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <WaitlistDialog open={adding} onOpenChange={setAdding} date={date >= todayIn(tz) ? date : todayIn(tz)} />
      {convert && <ReservationFormDialog open onOpenChange={(o) => { if (!o) setConvert(null); }} fromWaitlist={convert} defaultDate={dayOf(convert.desiredAt, tz)} />}
    </div>
  );
}

function WaitlistDialog({ open, onOpenChange, date }: { open: boolean; onOpenChange: (o: boolean) => void; date: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Ajouter à la liste d'attente" size="md" dismissable={false}>
      {open && <WaitlistForm date={date} close={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function WaitlistForm({ date, close }: { date: string; close: () => void }) {
  const t = useTenant();
  const tz = useTimezone();
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [party, setParty] = React.useState(2);
  const [day, setDay] = React.useState(date);
  const [time, setTime] = React.useState("20:00");
  const [notes, setNotes] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const add = useMutation({
    mutationFn: async () => {
      const parsed = waitlistInputSchema.safeParse({ guestName: name, guestPhone: phone, guestEmail: email, partySize: party, desiredAt: localTimeToInstant(day, time, tz) ?? undefined, notes });
      if (!parsed.success) { setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]))); throw new Error("invalid"); }
      setErrors({});
      return t.api.waitlist.create({ ...parsed.data, desiredAt: parsed.data.desiredAt.toISOString() } as never);
    },
    onSuccess: (w) => { applyWaitlistEvent(qc, t.root, w); toast.success(`${w.guestName} ajouté à la liste d'attente`); close(); },
    onError: (e) => { if (!(e instanceof Error && e.message === "invalid")) toastError(e); },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom" required error={errors.guestName}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Téléphone" error={errors.guestPhone} hint="Pour le prévenir par SMS."><Input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Email" error={errors.guestEmail}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Personnes" error={errors.partySize}><div><Stepper label="personnes" value={party} min={1} max={100} onChange={setParty} /></div></Field>
        <Field label="Jour souhaité" error={errors.desiredAt}><Input type="date" value={day} min={todayIn(tz)} onChange={(e) => setDay(e.target.value)} className="font-mono" /></Field>
        <Field label="Heure souhaitée"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="font-mono" /></Field>
      </div>
      <Field label="Notes" error={errors.notes}><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} /></Field>
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={close}>Annuler</Button>
        <Button type="submit" variant="primary" loading={add.isPending}>Ajouter</Button>
      </div>
    </form>
  );
}
