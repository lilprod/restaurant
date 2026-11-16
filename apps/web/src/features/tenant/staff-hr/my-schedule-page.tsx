import type { PlanningAbsence, PunchAction } from "@restaurant/api-client";
import { absenceStatusTone, presenceTone } from "@restaurant/ui-tokens";
import { addDays } from "@restaurant/utils";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Coffee, LogIn, LogOut, Plane, Plus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { errorMessage, toastError } from "@/lib/errors";
import { formatTime } from "@/lib/format";
import { ABSENCE_STATUS_LABEL, ABSENCE_TYPE_LABEL, PRESENCE_LABEL } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useUrlParam } from "@/lib/use-url-state";
import { useTenant } from "../hooks";
import { dayLabel, dayOfIso, hoursLabel, timeOfIso, useMyAttendance, useWeekStart } from "./hr-hooks";
import { ModuleLocked } from "./module-locked";

/** « Mon planning » : pointage personnel, créneaux publiés de la semaine, demandes d'absence et solde de congés. Pensé pour le téléphone. */
export function MySchedulePage() {
  const t = useTenant();
  const me = useMyAttendance();
  if (!me.moduleEnabled) return <><PageHeader title="Mon planning" /><ModuleLocked /></>;
  return (
    <>
      <PageHeader title="Mon planning" description="Vos horaires, votre pointage et vos demandes d'absence." />
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {me.data && !me.data.hasProfile && (
          <Callout tone="warning" title="Votre fiche personnel n'est pas encore créée">Un responsable doit la créer pour que vous puissiez pointer et recevoir un planning.</Callout>
        )}
        {me.data?.hasProfile && <PunchCard />}
        <WeekShifts />
        {me.data?.hasProfile && <AbsenceSection />}
        {t.isManager && <p className="text-[13px] text-muted-foreground">Le planning de toute l'équipe se gère dans « Personnel ».</p>}
      </div>
    </>
  );
}

function PunchCard() {
  const t = useTenant();
  const qc = useQueryClient();
  const me = useMyAttendance();
  const w = useWeekStart("");
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(i); }, []);
  const punch = useMutation({
    mutationFn: (a: PunchAction) => t.api.staffHr.punch(a),
    onSuccess: (r, a) => {
      toast.success(a === "IN" ? "Arrivée pointée" : a === "OUT" ? `Départ pointé · ${hoursLabel(r.workedMinutes)} travaillées` : a === "BREAK_START" ? "Bonne pause" : "Pause terminée");
      void qc.invalidateQueries({ queryKey: tenantKeys.hrMe(t.root) });
    },
    onError: (e) => toastError(e),
  });
  const d = me.data;
  if (!d) return <Skeleton className="h-40" />;
  const run = (a: PunchAction, label: string, icon: React.ReactNode, primary = false) => (
    <Button key={a} variant={primary ? "primary" : "secondary"} size="lg" className="h-14 text-base sm:flex-1" loading={punch.isPending && punch.variables === a} disabled={punch.isPending} onClick={() => punch.mutate(a)}>{icon}{label}</Button>
  );
  const worked = d.open ? Math.max(0, Math.round((now - +new Date(d.open.clockIn)) / 60_000) - d.open.breakMinutes) : 0;
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 shadow-sm" aria-labelledby="punch-title">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="punch-title" className="text-[17px] font-semibold tracking-tight">Pointage</h2>
          <p className="text-[13px] text-muted-foreground">
            {d.open ? <>Arrivé à <span className="font-mono tabular-nums">{timeOfIso(d.open.clockIn, w.tz)}</span> · <span className="font-mono tabular-nums">{hoursLabel(worked)}</span> travaillées</> : d.shift ? <>Prochain créneau : <span className="font-mono tabular-nums">{timeOfIso(d.shift.startsAt, w.tz)}–{timeOfIso(d.shift.endsAt, w.tz)}</span></> : "Aucun créneau publié aujourd'hui"}
          </p>
        </div>
        <StatusBadge status={d.state} labels={PRESENCE_LABEL} toneOf={presenceTone} />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        {d.state === "OFF" && run("IN", "Pointer mon arrivée", <LogIn />, true)}
        {d.state === "CLOCKED_IN" && <>{run("BREAK_START", "Commencer ma pause", <Coffee />)}{run("OUT", "Pointer mon départ", <LogOut />, true)}</>}
        {d.state === "ON_BREAK" && <>{run("BREAK_END", "Reprendre mon service", <Coffee />, true)}{run("OUT", "Pointer mon départ", <LogOut />)}</>}
      </div>
      {d.today.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-[13px]">
          {d.today.map((a) => <li key={a.id} className="flex items-center justify-between px-3 py-2 font-mono tabular-nums"><span>{formatTime(a.clockIn)} → {a.clockOut ? formatTime(a.clockOut) : "en cours"}</span><span className="text-muted-foreground">{hoursLabel(a.workedMinutes)}</span></li>)}
        </ul>
      )}
    </section>
  );
}

function WeekShifts() {
  const t = useTenant();
  const [param, setParam] = useUrlParam("semaine", "");
  const w = useWeekStart(param);
  const q = useQuery({ queryKey: tenantKeys.hrPlanning(t.root, w.week, true), queryFn: () => t.api.staffHr.myPlanning(w.week), placeholderData: keepPreviousData });
  const d = q.data;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="week-title">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col leading-tight">
          <h2 id="week-title" className="text-[17px] font-semibold tracking-tight">Ma semaine</h2>
          <span className="text-[13px] text-muted-foreground">{dayLabel(w.week, { day: "numeric", month: "long" })} – {dayLabel(addDays(w.week, 6), { day: "numeric", month: "long" })}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="icon" aria-label="Semaine précédente" onClick={() => setParam(w.prev)}><ChevronLeft /></Button>
          <Button variant="secondary" size="icon" aria-label="Semaine suivante" onClick={() => setParam(w.next)}><ChevronRight /></Button>
        </div>
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !d ? <div className="flex flex-col gap-2">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div> : (
        <>
          <ul className="flex flex-col gap-2">
            {d.days.map((day) => {
              const shifts = d.shifts.filter((s) => dayOfIso(s.startsAt, w.tz) === day);
              const absence = d.absences.find((a) => a.fromDay <= day && day <= a.toDay);
              return (
                <li key={day} className={cn("flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3 shadow-xs", day === w.today && "border-brand-ink")}>
                  <span className={cn("w-20 shrink-0 text-sm font-medium capitalize", !shifts.length && !absence && "text-muted-foreground")}>{dayLabel(day, { weekday: "short", day: "numeric" })}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {shifts.map((s) => (
                      <span key={s.id} className="font-mono text-sm tabular-nums">{timeOfIso(s.startsAt, w.tz)}–{timeOfIso(s.endsAt, w.tz)}<span className="ml-2 font-sans text-[13px] text-muted-foreground">{s.position}{s.notes ? ` · ${s.notes}` : ""}</span></span>
                    ))}
                    {absence && <span className="text-[13px] text-[var(--tone-amber-fg)]">{ABSENCE_TYPE_LABEL[absence.type]}{absence.status === "PENDING" ? " (en attente)" : ""}</span>}
                    {!shifts.length && !absence && <span className="text-[13px] text-muted-foreground">Repos</span>}
                  </div>
                </li>
              );
            })}
          </ul>
          {!d.shifts.length && <p className="text-[13px] text-muted-foreground">Aucun créneau publié cette semaine. Vous êtes prévenu dès que le planning est publié.</p>}
        </>
      )}
    </section>
  );
}

function AbsenceSection() {
  const t = useTenant();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [open, setOpen] = React.useState(false);
  const balance = useQuery({ queryKey: tenantKeys.hrBalance(t.root), queryFn: () => t.api.staffHr.balance() });
  const list = useQuery({ queryKey: tenantKeys.hrAbsences(t.root, { mine: true }), queryFn: () => t.api.staffHr.absences({ mine: true }) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: [...tenantKeys.hr(t.root), "absences"] }); void qc.invalidateQueries({ queryKey: tenantKeys.hrBalance(t.root) }); void qc.invalidateQueries({ queryKey: tenantKeys.hrPlannings(t.root) }); };
  const b = balance.data;
  const row = (a: PlanningAbsence) => (
    <li key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-xs">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{ABSENCE_TYPE_LABEL[a.type]} · {a.days} jour{a.days > 1 ? "s" : ""}</span>
        <span className="text-[13px] text-muted-foreground">{a.fromDay === a.toDay ? dayLabel(a.fromDay) : `${dayLabel(a.fromDay)} → ${dayLabel(a.toDay)}`}</span>
        {a.decisionNote && <span className="text-[13px] text-muted-foreground">Réponse : {a.decisionNote}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge status={a.status} labels={ABSENCE_STATUS_LABEL} toneOf={absenceStatusTone} />
        {a.status === "PENDING" && <Button variant="ghost" size="sm" onClick={() => confirm({ title: "Retirer cette demande ?", confirmLabel: "Retirer la demande", onConfirm: async () => { await t.api.staffHr.cancelAbsence(a.id); refresh(); } })}>Retirer</Button>}
      </div>
    </li>
  );
  return (
    <section className="flex flex-col gap-3" aria-labelledby="abs-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="abs-title" className="text-[17px] font-semibold tracking-tight">Absences et congés</h2>
        <Button variant="secondary" onClick={() => setOpen(true)}><Plus /> Demander</Button>
      </div>
      {b && (
        <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-card p-4 text-center shadow-xs">
          {[["Restants", b.remaining], ["Pris", b.taken], ["En attente", b.pending]].map(([l, n]) => (
            <div key={l as string} className="flex flex-col gap-0.5"><span className="font-mono text-2xl font-semibold tabular-nums">{n}</span><span className="text-[12px] uppercase tracking-wide text-muted-foreground">{l} · jours</span></div>
          ))}
        </div>
      )}
      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} compact /> : list.isLoading ? <Skeleton className="h-16" /> : list.data?.length ? <ul className="flex flex-col gap-2">{list.data.map(row)}</ul> : (
        <p className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground"><Plane className="size-4" aria-hidden /> Aucune demande. {b ? `Vous disposez de ${b.remaining} jour${b.remaining > 1 ? "s" : ""} de congés payés en ${b.year}.` : ""}</p>
      )}
      <AbsenceDialog open={open} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); refresh(); }} />
    </section>
  );
}

function AbsenceDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useTenant();
  const w = useWeekStart("");
  const [v, setV] = React.useState({ type: "PAID_LEAVE" as PlanningAbsence["type"], from: w.today, to: w.today, reason: "" });
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) { setError(null); setV((s) => ({ ...s, from: w.today, to: w.today, reason: "" })); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => t.api.staffHr.requestAbsence({ type: v.type, from: v.from, to: v.to, reason: v.reason || undefined }),
    onSuccess: () => { toast.success("Demande envoyée à un responsable"); onSaved(); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} size="sm" title="Demander une absence" description="Un responsable valide ou refuse votre demande."
      footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Envoyer la demande</Button></>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {error && <Callout tone="danger">{error}</Callout>}
        <Field label="Type"><NativeSelect value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as typeof v.type })}>{Object.entries(ABSENCE_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Du"><Input type="date" value={v.from} onChange={(e) => e.target.value && setV({ ...v, from: e.target.value, to: e.target.value > v.to ? e.target.value : v.to })} /></Field>
          <Field label="Au (inclus)"><Input type="date" value={v.to} min={v.from} onChange={(e) => e.target.value && setV({ ...v, to: e.target.value })} /></Field>
        </div>
        <Field label="Motif (facultatif)"><Input value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} maxLength={300} /></Field>
      </form>
    </Dialog>
  );
}
