import type { Attendance } from "@restaurant/api-client";
import { presenceTone } from "@restaurant/ui-tokens";
import { attendanceCorrectionSchema } from "@restaurant/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Pencil, Plus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { SkeletonRows } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/errors";
import { formatTime } from "@/lib/format";
import { ATTENDANCE_SOURCE_LABEL, PRESENCE_LABEL } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { addDays } from "@restaurant/utils";
import { useTenant } from "../hooks";
import { dayLabel, dayOfIso, hoursLabel, instantOf, timeOfIso, useWeekStart } from "./hr-hooks";

/** Présents maintenant, pointages d'une période, corrections et saisies manuelles (toujours avec un motif, audité). */
export function AttendanceTab() {
  const t = useTenant();
  const w = useWeekStart("");
  const [range, setRange] = React.useState<"today" | "week">("today");
  const from = range === "today" ? w.today : addDays(w.today, -6);
  const qc = useQueryClient();
  const present = useQuery({ queryKey: tenantKeys.hrPresent(t.root), queryFn: () => t.api.staffHr.present(), refetchInterval: 30_000 });
  const list = useQuery({ queryKey: tenantKeys.hrAttendance(t.root, { from, to: w.today }), queryFn: () => t.api.staffHr.attendance({ from, to: w.today }) });
  const [edit, setEdit] = React.useState<Attendance | "new" | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: [...tenantKeys.hr(t.root), "attendance"] }); void qc.invalidateQueries({ queryKey: tenantKeys.hrPresent(t.root) }); };

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="present-title" className="flex flex-col gap-3">
        <h2 id="present-title" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">En service maintenant</h2>
        {present.isLoading ? <SkeletonRows rows={2} className="rounded-lg border border-border" /> : present.data?.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {present.data.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4 shadow-xs">
                <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{a.staffName}</span><StatusBadge status={a.state} labels={PRESENCE_LABEL} toneOf={presenceTone} /></div>
                <span className="text-[13px] text-muted-foreground">{a.position}</span>
                <span className="font-mono text-[13px] tabular-nums">depuis {formatTime(a.clockIn)} · {hoursLabel(a.workedMinutes)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Personne n'a pointé pour l'instant.</p>}
      </section>

      <section aria-labelledby="hist-title" className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="hist-title" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pointages</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented ariaLabel="Période" value={range} onChange={setRange} options={[{ value: "today", label: "Aujourd'hui" }, { value: "week", label: "7 jours" }]} />
            <Button variant="secondary" onClick={() => setEdit("new")}><Plus /> Ajouter un pointage</Button>
          </div>
        </div>
        {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : list.isLoading ? <SkeletonRows rows={4} className="rounded-lg border border-border" /> : !list.data?.length ? (
          <EmptyState icon={<Clock />} title="Aucun pointage sur la période" description="Les arrivées et départs apparaissent ici dès qu'ils sont pointés." />
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-lg border border-border bg-card shadow-sm md:block">
              <table className="w-full text-sm">
                <thead className="bg-subtle text-left text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  <tr><th className="px-4 py-2.5">Personne</th><th className="px-3">Jour</th><th className="px-3">Arrivée</th><th className="px-3">Départ</th><th className="px-3 text-right">Pause</th><th className="px-3 text-right">Heures</th><th className="px-3">Origine</th><th className="px-3"><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {list.data.map((a) => (
                    <tr key={a.id} className="h-12 hover:bg-hover">
                      <td className="px-4"><span className="font-medium">{a.staffName}</span><span className="block text-[12.5px] text-muted-foreground">{a.position}</span></td>
                      <td className="px-3 text-muted-foreground">{dayLabel(dayOfIso(a.clockIn, w.tz))}</td>
                      <td className="px-3 font-mono tabular-nums">{timeOfIso(a.clockIn, w.tz)}</td>
                      <td className="px-3 font-mono tabular-nums">{a.clockOut ? timeOfIso(a.clockOut, w.tz) : <Badge tone="green" dot>En cours</Badge>}</td>
                      <td className="px-3 text-right font-mono tabular-nums">{a.breakMinutes} min</td>
                      <td className="px-3 text-right font-mono tabular-nums">{hoursLabel(a.workedMinutes)}</td>
                      <td className="px-3"><Badge tone="outline" title={a.note ?? undefined}>{ATTENDANCE_SOURCE_LABEL[a.source]}{a.correctedAt ? " · corrigé" : ""}</Badge></td>
                      <td className="px-3 text-right"><Button variant="ghost" size="icon-sm" aria-label={`Corriger le pointage de ${a.staffName}`} onClick={() => setEdit(a)}><Pencil /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="flex flex-col gap-2 md:hidden">
              {list.data.map((a) => (
                <li key={a.id} className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4 shadow-xs">
                  <div className="flex items-start justify-between gap-2"><span className="font-medium">{a.staffName}</span><Button variant="ghost" size="icon-sm" aria-label="Corriger" onClick={() => setEdit(a)}><Pencil /></Button></div>
                  <span className="font-mono text-[13px] tabular-nums text-muted-foreground">{dayLabel(dayOfIso(a.clockIn, w.tz))} · {timeOfIso(a.clockIn, w.tz)} → {a.clockOut ? timeOfIso(a.clockOut, w.tz) : "en cours"}</span>
                  <span className="font-mono text-[13px] tabular-nums">{hoursLabel(a.workedMinutes)} (pause {a.breakMinutes} min) · {ATTENDANCE_SOURCE_LABEL[a.source]}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <AttendanceDialog target={edit} tz={w.tz} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} />
    </div>
  );
}

function AttendanceDialog({ target, tz, onClose, onSaved }: { target: Attendance | "new" | null; tz: string; onClose: () => void; onSaved: () => void }) {
  const t = useTenant();
  const staff = useQuery({ queryKey: tenantKeys.hrProfiles(t.root), queryFn: () => t.api.staffHr.profiles(), enabled: target === "new" });
  const w = useWeekStart("");
  const [v, setV] = React.useState({ staffId: "", day: w.today, inTime: "09:00", outTime: "17:00", brk: "0", note: "", open: false });
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setError(null);
    if (target && target !== "new") setV({ staffId: target.staffId, day: dayOfIso(target.clockIn, tz), inTime: timeOfIso(target.clockIn, tz), outTime: target.clockOut ? timeOfIso(target.clockOut, tz) : "", brk: String(target.breakMinutes), note: "", open: !target.clockOut });
    else if (target === "new") setV({ staffId: "", day: w.today, inTime: "09:00", outTime: "17:00", brk: "0", note: "", open: false });
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: async () => {
      const brk = Number(v.brk || 0);
      const clockIn = instantOf(v.day, v.inTime, tz);
      let clockOut: Date | null = v.outTime ? instantOf(v.day, v.outTime, tz) : null;
      if (clockOut && clockOut <= clockIn) clockOut = instantOf(addDays(v.day, 1), v.outTime, tz); // service de nuit
      if (target === "new") {
        if (!v.staffId) throw new Error("Choisissez une personne");
        if (!clockOut) throw new Error("Indiquez l'heure de départ");
        return t.api.staffHr.createAttendance({ staffId: v.staffId, clockIn, clockOut, breakMinutes: brk, note: v.note });
      }
      const parsed = attendanceCorrectionSchema.safeParse({ clockIn, clockOut, breakMinutes: brk, note: v.note });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Correction invalide");
      return t.api.staffHr.correctAttendance((target as Attendance).id, parsed.data);
    },
    onSuccess: () => { toast.success("Pointage enregistré (consigné dans l'historique)"); onSaved(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const isNew = target === "new";
  return (
    <Dialog
      open={!!target} onOpenChange={(o) => !o && onClose()} size="sm"
      title={isNew ? "Ajouter un pointage" : "Corriger le pointage"} description="La correction est enregistrée avec votre nom et le motif."
      footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Enregistrer</Button></>}
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {error && <Callout tone="danger">{error}</Callout>}
        {isNew && (
          <Field label="Personne" required>
            <NativeSelect value={v.staffId} onChange={(e) => setV({ ...v, staffId: e.target.value })}>
              <option value="">Choisir…</option>
              {(staff.data ?? []).filter((s) => s.profile && s.isActive).map((s) => <option key={s.userId} value={s.profile!.id}>{s.name}</option>)}
            </NativeSelect>
          </Field>
        )}
        <Field label="Jour d'arrivée"><Input type="date" value={v.day} onChange={(e) => e.target.value && setV({ ...v, day: e.target.value })} disabled={!isNew} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Arrivée"><Input type="time" value={v.inTime} onChange={(e) => setV({ ...v, inTime: e.target.value })} className="font-mono" /></Field>
          <Field label="Départ" hint={v.open ? "Laissez vide : toujours en service" : undefined}><Input type="time" value={v.outTime} onChange={(e) => setV({ ...v, outTime: e.target.value })} className="font-mono" /></Field>
        </div>
        <Field label="Pause (minutes)"><Input inputMode="numeric" value={v.brk} onChange={(e) => setV({ ...v, brk: e.target.value.replace(/\D/g, "") })} className="font-mono" /></Field>
        <Field label="Motif" required hint="3 caractères minimum"><Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} maxLength={300} placeholder="Ex. oubli de pointage, pause non saisie" /></Field>
      </form>
    </Dialog>
  );
}
