import type { PlanningAbsence } from "@restaurant/api-client";
import { absenceStatusTone } from "@restaurant/ui-tokens";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plane, Plus, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/skeleton";
import { errorMessage, toastError } from "@/lib/errors";
import { ABSENCE_STATUS_LABEL, ABSENCE_TYPE_LABEL } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useSession } from "@/providers/session";
import { useTenant } from "../hooks";
import { dayLabel, useWeekStart } from "./hr-hooks";

const period = (a: PlanningAbsence) => (a.fromDay === a.toDay ? dayLabel(a.fromDay) : `${dayLabel(a.fromDay)} → ${dayLabel(a.toDay)}`);

/** Demandes d'absence et de congés : validation par un responsable (jamais de sa propre demande). */
export function AbsencesTab() {
  const t = useTenant();
  const { user } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [open, setOpen] = React.useState(false);
  const q = useQuery({ queryKey: tenantKeys.hrAbsences(t.root, { all: true }), queryFn: () => t.api.staffHr.absences() });
  const refresh = () => { void qc.invalidateQueries({ queryKey: [...tenantKeys.hr(t.root), "absences"] }); void qc.invalidateQueries({ queryKey: tenantKeys.hrPlannings(t.root) }); void qc.invalidateQueries({ queryKey: tenantKeys.hrBalance(t.root) }); };
  const approve = useMutation({ mutationFn: (id: string) => t.api.staffHr.decideAbsence(id, { decision: "APPROVED" }), onSuccess: () => { toast.success("Absence validée"); refresh(); }, onError: (e) => toastError(e) });
  const pending = (q.data ?? []).filter((a) => a.status === "PENDING");
  const others = (q.data ?? []).filter((a) => a.status !== "PENDING");

  const row = (a: PlanningAbsence) => (
    <li key={a.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{a.staffName}</span><StatusBadge status={a.status} labels={ABSENCE_STATUS_LABEL} toneOf={absenceStatusTone} /></div>
        <span className="text-[13px] text-muted-foreground">{ABSENCE_TYPE_LABEL[a.type]} · {period(a)} · {a.days} jour{a.days > 1 ? "s" : ""}</span>
        {a.reason && <span className="text-[13px]">« {a.reason} »</span>}
        {a.decisionNote && <span className="text-[13px] text-muted-foreground">Réponse : {a.decisionNote}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {a.status === "PENDING" && (
          <>
            <Button variant="primary" size="sm" loading={approve.isPending && approve.variables === a.id} onClick={() => approve.mutate(a.id)}><Check /> Valider</Button>
            <Button variant="secondary" size="sm" onClick={() => confirm({
              title: `Refuser la demande de ${a.staffName} ?`, description: "La personne verra votre réponse.", confirmLabel: "Refuser la demande", reason: { label: "Réponse à la personne", min: 3 },
              onConfirm: async (note) => { await t.api.staffHr.decideAbsence(a.id, { decision: "REJECTED", note }); refresh(); },
            })}><X /> Refuser</Button>
          </>
        )}
        {a.status !== "PENDING" && (
          <Button variant="ghost" size="sm" onClick={() => confirm({
            title: "Supprimer cette absence ?", description: "Elle disparaît du planning et ne compte plus dans le solde de congés.", confirmLabel: "Supprimer l'absence",
            onConfirm: async () => { await t.api.staffHr.cancelAbsence(a.id); refresh(); },
          })}>Supprimer</Button>
        )}
      </div>
    </li>
  );
  void user;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end"><Button variant="secondary" onClick={() => setOpen(true)}><Plus /> Saisir une absence</Button></div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.isLoading ? <SkeletonRows rows={3} className="rounded-lg border border-border" /> : !q.data?.length ? (
        <EmptyState icon={<Plane />} title="Aucune demande d'absence" description="Les demandes de congés du personnel arrivent ici pour validation." />
      ) : (
        <>
          <section className="flex flex-col gap-3"><h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">À traiter ({pending.length})</h2>
            {pending.length ? <ul className="flex flex-col gap-2">{pending.map(row)}</ul> : <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">Aucune demande en attente.</p>}
          </section>
          {!!others.length && <section className="flex flex-col gap-3"><h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Historique</h2><ul className="flex flex-col gap-2">{others.map(row)}</ul></section>}
        </>
      )}
      <RecordAbsenceDialog open={open} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); refresh(); }} />
    </div>
  );
}

function RecordAbsenceDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useTenant();
  const w = useWeekStart("");
  const staff = useQuery({ queryKey: tenantKeys.hrProfiles(t.root), queryFn: () => t.api.staffHr.profiles(), enabled: open });
  const [v, setV] = React.useState({ staffId: "", type: "PAID_LEAVE" as PlanningAbsence["type"], from: w.today, to: w.today, reason: "" });
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) { setError(null); setV((s) => ({ ...s, from: w.today, to: w.today, reason: "" })); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => t.api.staffHr.requestAbsence({ staffId: v.staffId || undefined, type: v.type, from: v.from, to: v.to, reason: v.reason || undefined }),
    onSuccess: () => { toast.success("Absence enregistrée et validée"); onSaved(); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} size="sm" title="Saisir une absence" description="Enregistrée comme validée : le planning en tient compte tout de suite."
      footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button variant="primary" loading={save.isPending} disabled={!v.staffId} onClick={() => save.mutate()}>Enregistrer l'absence</Button></>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (v.staffId) save.mutate(); }}>
        {error && <Callout tone="danger">{error}</Callout>}
        <Field label="Personne" required>
          <NativeSelect value={v.staffId} onChange={(e) => setV({ ...v, staffId: e.target.value })}>
            <option value="">Choisir…</option>
            {(staff.data ?? []).filter((s) => s.profile && s.isActive).map((s) => <option key={s.userId} value={s.profile!.id}>{s.name}</option>)}
          </NativeSelect>
        </Field>
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
