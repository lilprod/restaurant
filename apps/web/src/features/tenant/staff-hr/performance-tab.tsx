import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFcfa } from "@/lib/format";
import { tenantKeys } from "@/lib/tenant-keys";
import { useUrlParam } from "@/lib/use-url-state";
import { useTenant } from "../hooks";
import { useWeekStart } from "./hr-hooks";
import { PERIOD_OPTIONS, periodRange, type PeriodKey } from "./period";

/** Performances par serveur : commandes, encaissé, ticket moyen, pourboires, annulations, classement. */
export function PerformanceTab() {
  const t = useTenant();
  const w = useWeekStart("");
  const [key, setKey] = useUrlParam("periode", "week");
  const range = periodRange(key as PeriodKey, w.today);
  const q = useQuery({ queryKey: tenantKeys.hrPerformance(t.root, range), queryFn: () => t.api.staffHr.performance(range), placeholderData: keepPreviousData });
  const d = q.data;
  const max = Math.max(1, ...(d?.rows.map((r) => r.revenue) ?? [1]));
  const kpis = d && [
    { label: "Commandes", value: d.totals.orders, fmt: (n: number) => String(n) },
    { label: "Encaissé", value: d.totals.revenue, fmt: formatFcfa },
    { label: "Ticket moyen", value: d.totals.averageTicket, fmt: formatFcfa },
    { label: "Pourboires", value: d.totals.tips, fmt: formatFcfa },
  ];
  return (
    <div className="flex flex-col gap-5">
      <Segmented ariaLabel="Période" value={key as PeriodKey} onChange={(v) => setKey(v === "week" ? null : v)} options={PERIOD_OPTIONS} className="self-start overflow-x-auto" />
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !d ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            {kpis!.map((k) => (
              <Card key={k.label} className="p-4 sm:p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{k.label}</p>
                <p className="mt-2 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl"><AnimatedNumber value={k.value} format={k.fmt} /></p>
              </Card>
            ))}
          </div>
          {d.rows.length === 0 ? <EmptyState icon={<Trophy />} title="Aucune activité sur la période" description="Les commandes prises par vos serveurs alimentent ce classement." /> : (
            <>
              <div className="hidden overflow-hidden rounded-lg border border-border bg-card shadow-sm md:block">
                <table className="w-full text-sm">
                  <thead className="bg-subtle text-left text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    <tr><th className="w-12 px-4 py-2.5">#</th><th className="px-3">Serveur</th><th className="px-3 text-right">Commandes</th><th className="w-[30%] px-3">Encaissé</th><th className="px-3 text-right">Ticket moyen</th><th className="px-3 text-right">Pourboires</th><th className="px-3 text-right">Annulations</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {d.rows.map((r) => (
                      <tr key={r.userId} className="h-12 hover:bg-hover">
                        <td className="px-4 font-mono tabular-nums text-muted-foreground">{r.rank}</td>
                        <td className="px-3 font-medium">{r.name}</td>
                        <td className="px-3 text-right font-mono tabular-nums">{r.orders}</td>
                        <td className="px-3">
                          <div className="flex items-center gap-3">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden><div className="h-full rounded-full bg-brand" style={{ width: `${(r.revenue / max) * 100}%` }} /></div>
                            <span className="w-28 text-right font-mono tabular-nums">{formatFcfa(r.revenue)}</span>
                          </div>
                        </td>
                        <td className="px-3 text-right font-mono tabular-nums">{formatFcfa(r.averageTicket)}</td>
                        <td className="px-3 text-right font-mono tabular-nums">{formatFcfa(r.tips)}</td>
                        <td className="px-3 text-right font-mono tabular-nums">{r.cancellations}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ol className="flex flex-col gap-2 md:hidden">
                {d.rows.map((r) => (
                  <li key={r.userId} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-xs">
                    <div className="flex items-center justify-between gap-2"><span className="font-medium"><span className="mr-2 font-mono text-muted-foreground">{r.rank}</span>{r.name}</span><span className="font-mono text-sm font-semibold tabular-nums">{formatFcfa(r.revenue)}</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden><div className="h-full rounded-full bg-brand" style={{ width: `${(r.revenue / max) * 100}%` }} /></div>
                    <p className="font-mono text-[12.5px] tabular-nums text-muted-foreground">{r.orders} cmd · ticket {formatFcfa(r.averageTicket)} · pourb. {formatFcfa(r.tips)} · {r.cancellations} annul.</p>
                  </li>
                ))}
              </ol>
            </>
          )}
          <p className="text-[12.5px] text-muted-foreground">Mêmes règles que le tableau de bord : commandes non annulées, encaissements réglés sur la période. Les pourboires sont affichés par serveur, sans répartition automatique.{d.unassigned ? ` Hors classement : ${d.unassigned.orders} commande${d.unassigned.orders > 1 ? "s" : ""} sans serveur (${formatFcfa(d.unassigned.revenue)}).` : ""}</p>
        </>
      )}
    </div>
  );
}
