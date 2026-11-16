import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Wallet } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { SkeletonRows } from "@/components/ui/skeleton";
import { toastError } from "@/lib/errors";
import { downloadText } from "@/lib/files";
import { formatFcfa } from "@/lib/format";
import { tenantKeys } from "@/lib/tenant-keys";
import { useUrlParam } from "@/lib/use-url-state";
import { useTenant } from "../hooks";
import { decimalHours, useWeekStart } from "./hr-hooks";
import { PERIOD_OPTIONS, periodRange, type PeriodKey } from "./period";

/** Récapitulatif de paie (administrateur) : heures normales / supplémentaires, brut estimé, export CSV. Pas de bulletin. */
export function PayrollTab() {
  const t = useTenant();
  const qc = useQueryClient();
  const w = useWeekStart("");
  const [key, setKey] = useUrlParam("paie", "last-week");
  const range = periodRange(key as PeriodKey, w.today);
  const q = useQuery({ queryKey: tenantKeys.hrPayroll(t.root, range), queryFn: () => t.api.staffHr.payroll(range), placeholderData: keepPreviousData });
  const d = q.data;
  const [threshold, setThreshold] = React.useState("");
  React.useEffect(() => { if (d) setThreshold(String(d.thresholdHours).replace(".", ",")); }, [d?.thresholdHours]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveThreshold = useMutation({
    mutationFn: () => t.api.settings.update("staff", { overtimeThresholdHours: Number(threshold.replace(",", ".")) }),
    onSuccess: () => { toast.success("Seuil enregistré"); void qc.invalidateQueries({ queryKey: tenantKeys.hrPayroll(t.root) }); void qc.invalidateQueries({ queryKey: tenantKeys.settings(t.root, "staff") }); },
    onError: (e) => toastError(e),
  });
  const csv = useMutation({
    mutationFn: () => t.api.staffHr.payrollCsv(range),
    onSuccess: (text) => downloadText(`paie-${range.from}_${range.to}.csv`, text),
    onError: (e) => toastError(e),
  });
  const dirty = d && Number(threshold.replace(",", ".")) !== d.thresholdHours;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <Segmented ariaLabel="Période" value={key as PeriodKey} onChange={(v) => setKey(v === "last-week" ? null : v)} options={PERIOD_OPTIONS.filter((o) => o.value !== "today")} className="self-start overflow-x-auto" />
        <div className="flex flex-wrap items-end gap-3">
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (dirty) saveThreshold.mutate(); }}>
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">Heures sup. au-delà de
              <Input inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="w-28 font-mono" trailing={<span className="px-2 text-[12px]">h/sem.</span>} />
            </label>
            {dirty && <Button type="submit" variant="secondary" loading={saveThreshold.isPending}>Enregistrer</Button>}
          </form>
          <Button variant="primary" onClick={() => csv.mutate()} loading={csv.isPending} disabled={!d?.rows.length}><Download /> Exporter en CSV</Button>
        </div>
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !d ? <SkeletonRows rows={4} className="rounded-lg border border-border" /> : d.rows.length === 0 ? (
        <EmptyState icon={<Wallet />} title="Aucune heure pointée sur la période" description="Les heures viennent des pointages (compte personnel ou tablette)." />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border border-border bg-card shadow-sm md:block">
            <table className="w-full text-sm">
              <thead className="bg-subtle text-left text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                <tr><th className="px-4 py-2.5">Personne</th><th className="px-3 text-right">Normales</th><th className="px-3 text-right">Heures sup.</th><th className="px-3 text-right">Total</th><th className="px-3 text-right">Taux horaire</th><th className="px-4 text-right">Brut estimé</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.rows.map((r) => (
                  <tr key={r.staffId} className="h-12 hover:bg-hover">
                    <td className="px-4"><span className="font-medium">{r.name}</span><span className="block text-[12.5px] text-muted-foreground">{r.position}</span></td>
                    <td className="px-3 text-right font-mono tabular-nums">{decimalHours(r.normalMinutes)} h</td>
                    <td className="px-3 text-right font-mono tabular-nums">{r.overtimeMinutes ? `${decimalHours(r.overtimeMinutes)} h` : "—"}</td>
                    <td className="px-3 text-right font-mono tabular-nums">{decimalHours(r.totalMinutes)} h</td>
                    <td className="px-3 text-right font-mono tabular-nums">{formatFcfa(r.hourlyRate)}</td>
                    <td className="px-4 text-right font-mono font-medium tabular-nums">{formatFcfa(r.gross)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border-strong bg-subtle font-semibold">
                <tr className="h-12"><td className="px-4">Total</td><td className="px-3 text-right font-mono tabular-nums">{decimalHours(d.totals.normalMinutes)} h</td><td className="px-3 text-right font-mono tabular-nums">{decimalHours(d.totals.overtimeMinutes)} h</td><td className="px-3 text-right font-mono tabular-nums">{decimalHours(d.totals.normalMinutes + d.totals.overtimeMinutes)} h</td><td /><td className="px-4 text-right font-mono tabular-nums">{formatFcfa(d.totals.gross)}</td></tr>
              </tfoot>
            </table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {d.rows.map((r) => (
              <li key={r.staffId} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4 shadow-xs">
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{r.name}</span><span className="font-mono font-semibold tabular-nums">{formatFcfa(r.gross)}</span></div>
                <p className="font-mono text-[12.5px] tabular-nums text-muted-foreground">{decimalHours(r.normalMinutes)} h normales · {decimalHours(r.overtimeMinutes)} h sup. · {formatFcfa(r.hourlyRate)}/h</p>
              </li>
            ))}
            <li className="flex items-center justify-between rounded-lg border border-border-strong bg-subtle p-4 font-semibold"><span>Total</span><span className="font-mono tabular-nums">{formatFcfa(d.totals.gross)}</span></li>
          </ul>
          {d.rows.some((r) => r.openAttendances > 0) && <Callout tone="warning">Certains pointages sont encore ouverts (départ non pointé) : ils ne sont pas comptés. Corrigez-les dans l'onglet Pointages.</Callout>}
        </>
      )}
      <p className="text-[12.5px] text-muted-foreground">Estimation brute à partir des pointages (pause déduite), au seuil hebdomadaire réglé ci-dessus. Ce n'est pas un bulletin de paie : cotisations, primes et avantages ne sont pas calculés.</p>
    </div>
  );
}
