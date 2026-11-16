import type { Planning, PlanningAbsence, Shift } from "@restaurant/api-client";
import { addDays, shiftLocalDays } from "@restaurant/utils";
import { shiftInputSchema } from "@restaurant/validation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ChevronLeft, ChevronRight, Copy, Plus, Send, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { errorMessage, toastError } from "@/lib/errors";
import { ABSENCE_TYPE_LABEL } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useUrlParam } from "@/lib/use-url-state";
import { useTenant } from "../hooks";
import { dayLabel, dayOfIso, hoursLabel, instantOf, timeOfIso, useWeekStart } from "./hr-hooks";

const DAY_START = 6, DAY_END = 24; // plage horaire de la grille (glisser pour créer)
const snap = (h: number) => Math.round(h * 2) / 2;
const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${h % 1 ? "30" : "00"}`;

interface Draft { id?: string; staffId: string; day: string; start: string; end: string; position: string; notes: string }

/** Planning de la semaine par poste : créer en glissant dans une case, déplacer un créneau vers une autre case, copier, publier. */
export function PlanningTab() {
  const t = useTenant();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [param, setParam] = useUrlParam("semaine", "");
  const w = useWeekStart(param);
  const key = tenantKeys.hrPlanning(t.root, w.week, false);
  const q = useQuery({ queryKey: key, queryFn: () => t.api.staffHr.planning(w.week), placeholderData: keepPreviousData });
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const invalidate = () => void qc.invalidateQueries({ queryKey: tenantKeys.hrPlannings(t.root) });

  const move = useMutation({
    mutationFn: (v: { shift: Shift; staffId: string; dayDelta: number }) => t.api.staffHr.updateShift(v.shift.id, {
      staffId: v.staffId,
      startsAt: shiftLocalDays(new Date(v.shift.startsAt), v.dayDelta, w.tz) as unknown as Date,
      endsAt: shiftLocalDays(new Date(v.shift.endsAt), v.dayDelta, w.tz) as unknown as Date,
    }),
    onSuccess: invalidate,
    onError: (e) => toastError(e),
  });
  const copy = useMutation({
    mutationFn: () => t.api.staffHr.copyWeek({ fromWeek: w.week, toWeek: w.next }),
    onSuccess: (r) => {
      toast.success(`${r.copied} créneau${r.copied > 1 ? "x" : ""} copié${r.copied > 1 ? "s" : ""} en brouillon${r.skipped ? ` · ${r.skipped} ignoré${r.skipped > 1 ? "s" : ""} (chevauchement ou absence)` : ""}`);
      invalidate();
      setParam(w.next);
    },
    onError: (e) => toastError(e),
  });
  const publish = useMutation({
    mutationFn: () => t.api.staffHr.publish({ week: w.week }),
    onSuccess: (r) => { toast.success(r.published ? `Planning publié : ${r.people} personne${r.people > 1 ? "s" : ""} prévenue${r.people > 1 ? "s" : ""}` : "Aucun brouillon à publier"); invalidate(); },
    onError: (e) => toastError(e),
  });

  const data = q.data;
  const groups = React.useMemo(() => {
    const m = new Map<string, Planning["staff"]>();
    for (const s of data?.staff ?? []) m.set(s.position, [...(m.get(s.position) ?? []), s]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr"));
  }, [data?.staff]);

  const openNew = (staffId: string, day: string, start = "11:00", end = "19:00") => setDraft({ staffId, day, start, end, position: "", notes: "" });
  const openEdit = (s: Shift) => setDraft({ id: s.id, staffId: s.staffId, day: dayOfIso(s.startsAt, w.tz), start: timeOfIso(s.startsAt, w.tz), end: timeOfIso(s.endsAt, w.tz), position: s.position ?? "", notes: s.notes ?? "" });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" aria-label="Semaine précédente" onClick={() => setParam(w.prev)}><ChevronLeft /></Button>
          <Button variant="secondary" size="icon" aria-label="Semaine suivante" onClick={() => setParam(w.next)}><ChevronRight /></Button>
          <div className="ml-1 flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight">Semaine du {dayLabel(w.week, { day: "numeric", month: "long" })} au {dayLabel(addDays(w.week, 6), { day: "numeric", month: "long" })}</span>
            {!w.isCurrent && <button type="button" onClick={() => setParam(null)} className="w-fit text-[12.5px] text-brand-ink hover:underline">Revenir à cette semaine</button>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => copy.mutate()} loading={copy.isPending} disabled={!data?.shifts.length}><Copy /> Copier vers la semaine suivante</Button>
          <Button variant="primary" onClick={() => publish.mutate()} loading={publish.isPending} disabled={!data?.draftCount}>
            <Send /> Publier{data?.draftCount ? ` (${data.draftCount})` : ""}
          </Button>
        </div>
      </div>

      {!!data?.missingProfiles && (
        <Callout tone="warning" title={`${data.missingProfiles} membre${data.missingProfiles > 1 ? "s" : ""} sans fiche`}>
          Créez leur fiche (onglet Fiches) pour pouvoir les planifier.
        </Callout>
      )}

      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !data ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Chargement du planning">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : data.staff.length === 0 ? (
        <EmptyState icon={<CalendarClock />} title="Personne à planifier" description="Créez les fiches du personnel pour construire le planning." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <div className="min-w-[860px]" role="grid" aria-label="Planning de la semaine">
            <div className="grid grid-cols-[168px_repeat(7,minmax(0,1fr))] border-b border-border bg-subtle text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground" role="row">
              <div className="px-3 py-2.5">Personne</div>
              {data.days.map((d) => (
                <div key={d} role="columnheader" className={cn("border-l border-border px-2 py-2.5 text-center", d === w.today && "text-brand-ink")}>
                  {dayLabel(d, { weekday: "short", day: "numeric" })}
                </div>
              ))}
            </div>
            {groups.map(([position, people]) => (
              <div key={position}>
                <div className="border-b border-border bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{position}</div>
                {people.map((p) => {
                  const mine = data.shifts.filter((s) => s.staffId === p.staffId);
                  const total = mine.reduce((n, s) => n + (+new Date(s.endsAt) - +new Date(s.startsAt)) / 60_000, 0);
                  return (
                    <div key={p.staffId} role="row" className="grid grid-cols-[168px_repeat(7,minmax(0,1fr))] border-b border-border last:border-b-0">
                      <div className="flex min-w-0 flex-col justify-center px-3 py-2">
                        <span className="truncate text-sm font-medium">{p.name}</span>
                        <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{hoursLabel(total)}</span>
                      </div>
                      {data.days.map((d) => (
                        <DayCell
                          key={d} day={d} tz={w.tz} today={w.today}
                          shifts={mine.filter((s) => dayOfIso(s.startsAt, w.tz) === d)}
                          absence={data.absences.find((a) => a.staffId === p.staffId && a.fromDay <= d && d <= a.toDay)}
                          onCreate={(start, end) => openNew(p.staffId, d, start, end)}
                          onEdit={openEdit}
                          onDropShift={(s) => {
                            const delta = Math.round((Date.parse(d) - Date.parse(dayOfIso(s.startsAt, w.tz))) / 86_400_000);
                            if (delta || s.staffId !== p.staffId) move.mutate({ shift: s, staffId: p.staffId, dayDelta: delta });
                          }}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-[12.5px] text-muted-foreground">Glissez dans une case vide pour créer un créneau, ou faites glisser un créneau vers une autre case. Les créneaux en pointillés sont des brouillons : personne n'est prévenu avant la publication.</p>

      <ShiftDialog
        draft={draft} planning={data} tz={w.tz}
        onClose={() => setDraft(null)}
        onSaved={() => { setDraft(null); invalidate(); }}
        onDelete={(id) => confirm({
          title: "Supprimer ce créneau ?", description: "Le créneau disparaît du planning de la personne.", confirmLabel: "Supprimer le créneau",
          onConfirm: async () => { await t.api.staffHr.removeShift(id); setDraft(null); invalidate(); },
        })}
      />
    </div>
  );
}

function DayCell({ day, tz, today, shifts, absence, onCreate, onEdit, onDropShift }: {
  day: string; tz: string; today: string; shifts: Shift[]; absence?: PlanningAbsence;
  onCreate: (start: string, end: string) => void; onEdit: (s: Shift) => void; onDropShift: (s: Shift) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [drag, setDrag] = React.useState<{ a: number; b: number } | null>(null);
  const [over, setOver] = React.useState(false);
  const hourAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return snap(DAY_START + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (DAY_END - DAY_START));
  };
  const down = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const h = hourAt(e.clientX);
    setDrag({ a: h, b: h });
  };
  const up = (e: React.PointerEvent) => {
    if (!drag) return;
    const a = Math.min(drag.a, drag.b), b = Math.max(drag.a, drag.b);
    setDrag(null);
    // Un simple clic propose une journée standard ; un glissement fixe l'horaire.
    if (b - a >= 1) onCreate(hhmm(a), hhmm(b)); else onCreate("11:00", "19:00");
    void e;
  };
  return (
    <div
      ref={ref} role="gridcell" aria-label={dayLabel(day)}
      onPointerDown={down} onPointerMove={(e) => drag && setDrag({ ...drag, b: hourAt(e.clientX) })} onPointerUp={up} onPointerCancel={() => setDrag(null)}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const s = JSON.parse(e.dataTransfer.getData("application/x-shift") || "null") as Shift | null; if (s) onDropShift(s); }}
      className={cn("group relative flex min-h-[72px] cursor-crosshair touch-pan-y flex-col gap-1 border-l border-border p-1 transition-colors", day === today && "bg-brand-tint/40", over && "bg-brand-tint")}
    >
      {drag && (
        <span aria-hidden className="pointer-events-none absolute inset-y-1 rounded bg-brand/30 ring-1 ring-brand" style={{
          left: `${((Math.min(drag.a, drag.b) - DAY_START) / (DAY_END - DAY_START)) * 100}%`,
          width: `${(Math.abs(drag.b - drag.a) / (DAY_END - DAY_START)) * 100}%`,
        }} />
      )}
      {absence && (
        <span className="pointer-events-none rounded bg-[var(--tone-amber-bg)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--tone-amber-fg)]" title={`${ABSENCE_TYPE_LABEL[absence.type]} · ${absence.status === "PENDING" ? "en attente" : "validée"}`}>
          {ABSENCE_TYPE_LABEL[absence.type]}{absence.status === "PENDING" ? " ?" : ""}
        </span>
      )}
      {shifts.map((s) => (
        <button
          key={s.id} type="button" draggable
          onDragStart={(e) => { e.dataTransfer.setData("application/x-shift", JSON.stringify(s)); e.dataTransfer.effectAllowed = "move"; }}
          onClick={() => onEdit(s)}
          aria-label={`Créneau ${timeOfIso(s.startsAt, tz)} à ${timeOfIso(s.endsAt, tz)}${s.publishedAt ? "" : ", brouillon"}`}
          className={cn(
            "relative z-10 cursor-grab rounded px-1.5 py-1 text-left font-mono text-[12px] tabular-nums leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
            s.publishedAt ? "bg-foreground text-background hover:opacity-90" : "border border-dashed border-border-strong bg-background text-foreground hover:bg-hover",
          )}
        >
          {timeOfIso(s.startsAt, tz)}–{timeOfIso(s.endsAt, tz)}
        </button>
      ))}
      {!shifts.length && !absence && <Plus aria-hidden className="pointer-events-none m-auto size-4 text-faint opacity-0 transition-opacity group-hover:opacity-100" />}
    </div>
  );
}

function ShiftDialog({ draft, planning, tz, onClose, onSaved, onDelete }: {
  draft: Draft | null; planning?: Planning; tz: string; onClose: () => void; onSaved: () => void; onDelete: (id: string) => void;
}) {
  const t = useTenant();
  const [v, setV] = React.useState<Draft | null>(draft);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { setV(draft); setError(null); }, [draft]);
  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const body = { staffId: d.staffId, startsAt: instantOf(d.day, d.start, tz), endsAt: instantOf(d.day, d.end > d.start ? d.end : d.end, tz), position: d.position || undefined, notes: d.notes || null };
      // Fin avant le début : le créneau passe minuit.
      if (d.end <= d.start) body.endsAt = instantOf(addDays(d.day, 1), d.end, tz);
      const parsed = shiftInputSchema.safeParse({ ...body, startsAt: body.startsAt.toISOString(), endsAt: body.endsAt.toISOString() });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Créneau invalide");
      return d.id ? t.api.staffHr.updateShift(d.id, parsed.data) : t.api.staffHr.createShift(parsed.data);
    },
    onSuccess: () => { toast.success(draft?.id ? "Créneau modifié" : "Créneau ajouté"); onSaved(); },
    onError: (e) => setError(errorMessage(e)),
  });
  if (!v) return <Dialog open={false} onOpenChange={onClose} title="Créneau" />;
  const set = (patch: Partial<Draft>) => setV({ ...v, ...patch });
  return (
    <Dialog
      open={!!draft} onOpenChange={(o) => !o && onClose()} size="sm"
      title={v.id ? "Modifier le créneau" : "Nouveau créneau"} description={dayLabel(v.day, { weekday: "long", day: "numeric", month: "long" })}
      footer={
        <>
          {v.id && <Button variant="danger-ghost" className="mr-auto" onClick={() => onDelete(v.id!)}><Trash2 /> Supprimer</Button>}
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(v)}>{v.id ? "Enregistrer" : "Ajouter le créneau"}</Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(v); }}>
        {error && <Callout tone="danger">{error}</Callout>}
        <Field label="Personne">
          <NativeSelect value={v.staffId} onChange={(e) => set({ staffId: e.target.value })}>
            {(planning?.staff ?? []).map((p) => <option key={p.staffId} value={p.staffId}>{p.name} · {p.position}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Jour"><Input type="date" value={v.day} onChange={(e) => e.target.value && set({ day: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Début"><Input type="time" step={900} value={v.start} onChange={(e) => set({ start: e.target.value })} className="font-mono" /></Field>
          <Field label="Fin" hint={v.end <= v.start ? "Après minuit : le lendemain" : undefined}><Input type="time" step={900} value={v.end} onChange={(e) => set({ end: e.target.value })} className="font-mono" /></Field>
        </div>
        <Field label="Poste" hint="Laissez vide pour reprendre le poste de la fiche."><Input value={v.position} onChange={(e) => set({ position: e.target.value })} maxLength={60} /></Field>
        <Field label="Note"><Input value={v.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={300} placeholder="Ex. ouverture, banquet…" /></Field>
        {v.id && draft && <Badge tone="outline" className="w-fit">{planning?.shifts.find((s) => s.id === v.id)?.publishedAt ? "Publié" : "Brouillon"}</Badge>}
      </form>
    </Dialog>
  );
}
