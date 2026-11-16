import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { DownloadButton } from "@/components/ui/download-button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFcfa, formatNumber } from "@/lib/format";
import { PAYMENT_METHOD_LABEL, TENANT_STATUS_LABEL } from "@/lib/labels";
import { useUrlParam } from "@/lib/use-url-state";
import { Legend, METHOD_COLOR } from "@/features/tenant/reports/charts";
import { papi } from "../hooks";

const METHODS = ["CASH", "CARD", "FLOOZ", "TMONEY"] as const;
const AXIS = { fill: "var(--muted-foreground)", fontSize: 11, fontFamily: "var(--font-mono)" } as const;
const monthLabel = (m: string) => new Intl.DateTimeFormat("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${m}-15T12:00:00Z`));

function addMonths(day: string, n: number) { const [y, m] = day.split("-").map(Number); return new Date(Date.UTC(y!, m! - 1 + n, 1)).toISOString().slice(0, 10); }

/** Revenus de licences par mois et par moyen de paiement, état du parc, renouvellements et résiliations (SuperAdmin). */
export function LicensesReportPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useUrlParam("du", addMonths(today, -5));
  const [to, setTo] = useUrlParam("au", today);
  const valid = from <= to;
  const q = useQuery({ queryKey: ["platform", "reports", "licenses", from, to], queryFn: () => papi.reports.licenses({ from, to }), enabled: valid, placeholderData: keepPreviousData });
  const d = q.data;
  const data = (d?.revenue.byMonth ?? []).map((m) => ({ label: monthLabel(m.month), month: m.month, ...Object.fromEntries(METHODS.map((k) => [k, m.byMethod[k] ?? 0])), total: m.total }));

  return (
    <>
      <PageHeader title="Rapports" description="Revenus de licences, état du parc, renouvellements et résiliations."
        actions={
          <>
            <label className="sr-only" htmlFor="pr-from">Du</label>
            <Input id="pr-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-auto font-mono" />
            <span className="text-muted-foreground">au</span>
            <label className="sr-only" htmlFor="pr-to">Au</label>
            <Input id="pr-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-auto font-mono" />
            <DownloadButton size="sm" disabled={!valid} fetchFile={() => papi.reports.download({ from, to }, "csv")}><Download /> CSV</DownloadButton>
            <DownloadButton size="sm" disabled={!valid} fetchFile={() => papi.reports.download({ from, to }, "pdf")}><FileText /> PDF</DownloadButton>
          </>
        } />
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} className="mb-6" />}
      {!valid && <ErrorState error={new Error("La fin précède le début.")} compact />}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[
          ["Revenus encaissés", d ? formatFcfa(d.revenue.total) : "", `${d?.revenue.count ?? 0} paiement${(d?.revenue.count ?? 0) > 1 ? "s" : ""}`],
          ["Renouvellements", d ? formatNumber(d.totals.renewals) : "", `${d?.totals.firstPayments ?? 0} premier${(d?.totals.firstPayments ?? 0) > 1 ? "s" : ""} paiement${(d?.totals.firstPayments ?? 0) > 1 ? "s" : ""}`],
          ["Résiliations", d ? formatNumber(d.totals.cancellations) : "", `${d?.totals.voided ?? 0} paiement(s) annulé(s)`],
          ["Restaurants actifs", d ? formatNumber((d.tenants.ACTIVE ?? 0)) : "", d ? `${d.tenants.TRIAL ?? 0} en essai · ${d.tenants.SUSPENDED ?? 0} suspendus` : ""],
        ].map(([label, value, hint]) => (
          <Card key={label} className="flex flex-col gap-2 p-4 sm:p-5">
            <span className="text-[11px] font-medium uppercase leading-tight tracking-[0.08em] text-muted-foreground">{label}</span>
            {q.isLoading ? <Skeleton className="h-8 w-28" /> : <span className="font-mono text-[22px] font-semibold leading-none tracking-tight tabular-nums sm:text-[26px]">{value}</span>}
            <span className="text-[12.5px] text-muted-foreground">{hint}</span>
          </Card>
        ))}
      </div>

      <Card className="mb-6">
        <div className="p-5 pb-2 sm:p-6 sm:pb-2">
          <h2 className="text-[15px] font-semibold tracking-tight">Revenus par mois</h2>
          <p className="text-[13px] text-muted-foreground">Paiements de licence enregistrés, par moyen de paiement (mois en UTC).</p>
        </div>
        <Legend items={METHODS.map((m) => ({ label: PAYMENT_METHOD_LABEL[m]!, color: METHOD_COLOR[m]! }))} />
        {q.isLoading ? <Skeleton className="mx-5 mb-5 h-[260px]" /> : !data.length ? <EmptyState title="Aucun paiement sur cette période" className="py-10" /> : (
          <div className="h-[260px] px-2 pb-4 sm:px-4" role="img" aria-label={`Revenus par mois : ${data.map((m) => `${m.label} ${formatFcfa(m.total)}`).join(", ")}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS} />
                <YAxis tickLine={false} axisLine={false} width={52} tick={AXIS} tickFormatter={(v: number) => (v >= 1_000_000 ? `${String(Math.round(v / 100_000) / 10).replace(".", ",")} M` : v >= 1000 ? `${Math.round(v / 1000)} k` : String(v))} />
                <Tooltip cursor={{ fill: "var(--hover)" }} content={({ active, payload, label }) => active && payload?.length ? (
                  <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
                    <div className="mb-1 text-muted-foreground">{label}</div>
                    {payload.filter((p) => Number(p.value) > 0).map((p) => (
                      <div key={String(p.dataKey)} className="flex items-center gap-2"><span className="h-0.5 w-3 rounded-full" style={{ background: METHOD_COLOR[String(p.dataKey)] }} aria-hidden /><span className="font-mono text-sm font-semibold tabular-nums">{formatFcfa(Number(p.value))}</span><span className="text-muted-foreground">{PAYMENT_METHOD_LABEL[String(p.dataKey)]}</span></div>
                    ))}
                  </div>
                ) : null} />
                {METHODS.map((m, i) => <Bar key={m} dataKey={m} stackId="a" fill={METHOD_COLOR[m]} stroke="var(--card)" strokeWidth={2} radius={i === METHODS.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={44} animationDuration={400} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <h2 className="mb-3 text-[17px] font-semibold tracking-tight">Souscriptions, renouvellements et résiliations</h2>
      <DataTable
        caption="Détail par mois"
        rows={d?.revenue.byMonth}
        rowKey={(m) => m.month}
        loading={q.isLoading}
        empty={<EmptyState title="Aucun mouvement sur cette période" className="py-10" />}
        columns={[
          { key: "m", header: "Mois", cell: (m) => <span className="font-mono">{m.month}</span> },
          { key: "n", header: "Paiements", align: "right", cell: (m) => <span className="font-mono tabular-nums">{m.count}</span> },
          { key: "f", header: "Premiers", align: "right", hideOnMobile: true, cell: (m) => <span className="font-mono tabular-nums">{m.firstPayments}</span> },
          { key: "r", header: "Renouvellements", align: "right", hideOnMobile: true, cell: (m) => <span className="font-mono tabular-nums">{m.renewals}</span> },
          { key: "c", header: "Résiliations", align: "right", hideOnMobile: true, cell: (m) => <span className="font-mono tabular-nums">{m.cancellations}</span> },
          { key: "t", header: "Total", align: "right", cell: (m) => <span className="font-mono font-medium tabular-nums">{formatFcfa(m.total)}</span> },
        ]}
      />
      {d && <p className="mt-3 text-[13px] text-muted-foreground">Restaurants aujourd'hui : {Object.entries(d.tenants).map(([s, n]) => `${TENANT_STATUS_LABEL[s] ?? s} ${n}`).join(" · ")}.</p>}
    </>
  );
}
