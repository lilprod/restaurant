import type { ClosureCreated, OpeningRange } from "@restaurant/api-client";
import { openingHoursSchema } from "@restaurant/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarOff, Copy, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { useConfirm } from "@/components/ui/confirm";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { SettingsSection } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { toastError } from "@/lib/errors";
import { tenantKeys } from "@/lib/tenant-keys";
import { useTenant, useTimezone } from "../hooks";
import { useOpeningHours } from "./hooks";
import { fmtDay, fmtTime, todayIn, WEEKDAYS } from "./time";

interface Row { key: number; weekday: number; opensAt: string; closesAt: string; slotMinutes: number }
let seq = 0;
const toRows = (ranges: OpeningRange[]): Row[] => ranges.map((r) => ({ ...r, key: ++seq }));

/** Horaires d'ouverture de la semaine : plusieurs plages par jour (midi, soir). Réservé aux responsables pour l'écriture. */
export function OpeningHoursPanel() {
  const t = useTenant();
  const qc = useQueryClient();
  const q = useOpeningHours();
  const [rows, setRows] = React.useState<Row[]>([]);
  const [errors, setErrors] = React.useState<Record<number, string>>({});
  const [dirty, setDirty] = React.useState(false);
  React.useEffect(() => { if (q.data) { setRows(toRows(q.data.ranges)); setDirty(false); setErrors({}); } }, [q.data]);
  const canWrite = t.isManager;
  const edit = (fn: (r: Row[]) => Row[]) => { setRows(fn); setDirty(true); };

  const save = useMutation({
    mutationFn: () => {
      const body = { ranges: rows.map(({ key: _k, ...r }) => r) };
      const parsed = openingHoursSchema.safeParse(body);
      if (!parsed.success) {
        const next: Record<number, string> = {};
        for (const i of parsed.error.issues) { const idx = Number(i.path[1]); if (Number.isInteger(idx)) next[rows[idx]!.key] ??= i.message; }
        setErrors(next);
        throw new Error("invalid");
      }
      setErrors({});
      return t.api.openingHours.set(parsed.data as never);
    },
    onSuccess: (data) => { qc.setQueryData(tenantKeys.openingHours(t.root), data); toast.success("Horaires enregistrés"); setDirty(false); },
    onError: (e) => { if (!(e instanceof Error && e.message === "invalid")) toastError(e); },
  });

  return (
    <SettingsSection
      title="Horaires d'ouverture"
      description="Les créneaux proposés aux clients suivent ces plages. Une fermeture après minuit s'écrit avec une heure de fin inférieure à l'ouverture (ex. 18:30 → 01:00)."
      footer={canWrite ? (
        <>
          <span className="text-[13px] text-muted-foreground">{dirty ? "Modifications non enregistrées" : "Les horaires sont à jour."}</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={!dirty || save.isPending} onClick={() => q.data && (setRows(toRows(q.data.ranges)), setDirty(false), setErrors({}))}>Annuler</Button>
            <Button variant="primary" size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Enregistrer les horaires</Button>
          </div>
        </>
      ) : <span className="text-[13px] text-muted-foreground">Lecture seule : réservé aux responsables.</span>}
    >
      {q.isLoading ? <Skeleton className="h-64 rounded-lg" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="flex flex-col divide-y divide-border">
          {WEEKDAYS.map(({ v, l }) => {
            const dayRows = rows.filter((r) => r.weekday === v);
            return (
              <div key={v} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-6">
                <div className="flex items-center justify-between sm:w-32 sm:flex-col sm:items-start sm:gap-1 sm:pt-2">
                  <span className="text-sm font-medium">{l}</span>
                  {!dayRows.length && <span className="text-[13px] text-muted-foreground">Fermé</span>}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  {dayRows.map((r) => (
                    <div key={r.key} className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Input type="time" aria-label={`${l} : ouverture`} value={r.opensAt} disabled={!canWrite} className="w-28 font-mono" onChange={(e) => edit((x) => x.map((y) => (y.key === r.key ? { ...y, opensAt: e.target.value } : y)))} />
                        <span aria-hidden className="text-muted-foreground">→</span>
                        <Input type="time" aria-label={`${l} : fermeture`} value={r.closesAt} disabled={!canWrite} className="w-28 font-mono" onChange={(e) => edit((x) => x.map((y) => (y.key === r.key ? { ...y, closesAt: e.target.value } : y)))} />
                        <div className="w-44"><NativeSelect aria-label={`${l} : pas des créneaux`} value={String(r.slotMinutes)} disabled={!canWrite}
                          onChange={(e) => edit((x) => x.map((y) => (y.key === r.key ? { ...y, slotMinutes: Number(e.target.value) } : y)))}>
                          {[10, 15, 20, 30, 60].map((n) => <option key={n} value={n}>Toutes les {n} min</option>)}
                        </NativeSelect></div>
                        {canWrite && <Button size="icon-sm" variant="danger-ghost" aria-label={`Supprimer la plage de ${l}`} onClick={() => edit((x) => x.filter((y) => y.key !== r.key))}><Trash2 /></Button>}
                      </div>
                      {errors[r.key] && <p role="alert" className="text-[12.5px] text-danger">{errors[r.key]}</p>}
                    </div>
                  ))}
                  {canWrite && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="ghost" onClick={() => edit((x) => [...x, { key: ++seq, weekday: v, opensAt: dayRows.length ? "18:30" : "11:30", closesAt: dayRows.length ? "23:00" : "15:00", slotMinutes: 15 }])}><Plus /> Ajouter une plage</Button>
                      {dayRows.length > 0 && (
                        <Button size="sm" variant="ghost" onClick={() => { edit((x) => [...x.filter((y) => y.weekday === v), ...WEEKDAYS.filter((d) => d.v !== v).flatMap((d) => dayRows.map((r) => ({ ...r, key: ++seq, weekday: d.v })))]); toast.info(`${l} copié sur les autres jours`); }}><Copy /> Copier sur tous les jours</Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SettingsSection>
  );
}

/** Fermetures exceptionnelles (jour férié, privatisation…) : les réservations déjà prises ce jour-là sont signalées. */
export function ClosuresPanel() {
  const t = useTenant();
  const tz = useTimezone();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const list = useQuery({ queryKey: tenantKeys.closures(t.root), queryFn: () => t.api.closures.list() });
  const [date, setDate] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [created, setCreated] = React.useState<ClosureCreated | null>(null);
  const [error, setError] = React.useState<string>();

  const add = useMutation({
    mutationFn: () => t.api.closures.create({ date, reason: reason.trim() || undefined }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: tenantKeys.closures(t.root) });
      void qc.invalidateQueries({ queryKey: tenantKeys.reservations(t.root) });
      setCreated(c); setDate(""); setReason(""); setError(undefined);
      toast.success("Fermeture enregistrée");
    },
    onError: (e) => { setError(e instanceof Error ? e.message : "Erreur"); toastError(e); },
  });
  const remove = (id: string, day: string) => confirm({
    title: "Supprimer la fermeture", description: `Le ${fmtDay(day, { day: "numeric", month: "long", year: "numeric" })} redeviendra un jour d'ouverture normal.`,
    confirmLabel: "Supprimer", tone: "danger",
    onConfirm: async () => { await t.api.closures.remove(id); void qc.invalidateQueries({ queryKey: tenantKeys.closures(t.root) }); toast.success("Fermeture supprimée"); },
  });

  return (
    <SettingsSection title="Fermetures exceptionnelles" description="Jours où le restaurant est fermé malgré les horaires habituels. Aucun créneau n'est proposé ces jours-là.">
      {t.isManager && (
        <form onSubmit={(e) => { e.preventDefault(); if (date) add.mutate(); }} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Jour" error={error}><Input type="date" required value={date} min={todayIn(tz)} onChange={(e) => setDate(e.target.value)} className="font-mono sm:w-44" /></Field>
          <Field label="Motif (facultatif)" className="sm:flex-1"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} placeholder="Ex. jour férié, privatisation" /></Field>
          <Button type="submit" variant="secondary" loading={add.isPending} disabled={!date}><Plus /> Ajouter</Button>
        </form>
      )}
      {created && created.affectedReservations.length > 0 && (
        <Callout tone="warning" title={`${created.affectedReservations.length} réservation${created.affectedReservations.length > 1 ? "s" : ""} déjà prise${created.affectedReservations.length > 1 ? "s" : ""} ce jour-là`}>
          À prévenir et à annuler : {created.affectedReservations.map((r) => `${r.guestName} (${fmtTime(r.startsAt, tz)})`).join(", ")}.
        </Callout>
      )}
      {list.isLoading ? <Skeleton className="h-16 rounded-lg" /> : list.isError ? <ErrorState compact error={list.error} onRetry={() => list.refetch()} />
        : !list.data?.length ? <EmptyState className="py-8" icon={<CalendarOff />} title="Aucune fermeture prévue" description="Les jours de fermeture exceptionnelle apparaîtront ici." />
        : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {list.data.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0"><p className="text-sm font-medium">{fmtDay(c.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
                  {c.reason && <p className="text-[13px] text-muted-foreground">{c.reason}</p>}</div>
                {t.isManager && <Button size="icon-sm" variant="danger-ghost" aria-label={`Supprimer la fermeture du ${c.date}`} onClick={() => remove(c.id, c.date)}><Trash2 /></Button>}
              </li>
            ))}
          </ul>
        )}
    </SettingsSection>
  );
}
