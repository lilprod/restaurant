import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CalendarClock, Inbox, Receipt, RefreshCw, Store } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Badge, StatusBadge, ToneDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Stagger, StaggerItem } from "@/components/ui/motion";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip as Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { daysUntil, formatDate, formatFcfa, formatNumber } from "@/lib/format";
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS, SUBSCRIPTION_STATUS_LABEL } from "@/lib/labels";
import { useSession } from "@/providers/session";
import { papi, pk, READ_ONLY_HINT, useCanWrite } from "./hooks";
import { RecordPaymentDialog } from "./payments/record-payment-dialog";

const monthLabel = () => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "Africa/Lome" }).format(new Date());

export function PlatformDashboardPage() {
  const { user } = useSession();
  const canWrite = useCanWrite();
  const q = useQuery({ queryKey: pk.dashboard, queryFn: papi.dashboard });
  const [payFor, setPayFor] = React.useState<string | null>(null);
  const d = q.data;

  const t = d?.tenants ?? {};
  const totalTenants = Object.values(t).reduce((n, v) => n + (v ?? 0), 0);
  const kpis = [
    { label: "Restaurants actifs", value: t.ACTIVE ?? 0, hint: `${formatNumber(totalTenants)} au total`, tone: "green" as const, to: "/admin/restaurants?status=ACTIVE" },
    { label: "En essai", value: t.TRIAL ?? 0, hint: "Essai gratuit en cours", tone: "blue" as const, to: "/admin/restaurants?status=TRIAL" },
    { label: "Suspendus", value: t.SUSPENDED ?? 0, hint: "Licence expirée ou suspension", tone: "red" as const, to: "/admin/restaurants?status=SUSPENDED" },
    { label: "Inscriptions en attente", value: d?.pendingRegistrations ?? 0, hint: "À valider", tone: "gray" as const, to: "/admin/inscriptions" },
  ];

  const byMethod = PAYMENT_METHODS.map((m) => {
    const r = d?.revenueThisMonth.byMethod.find((x) => x.method === m);
    return { method: m, label: PAYMENT_METHOD_LABEL[m], amount: r?.amount ?? 0, count: r?.count ?? 0 };
  });
  const paymentsCount = byMethod.reduce((n, r) => n + r.count, 0);

  return (
    <>
      <PageHeader
        title={`Bonjour ${user?.firstName ?? ""}`}
        description="Vue d'ensemble des restaurants, des licences et des encaissements."
        actions={
          canWrite ? <Button variant="primary" onClick={() => setPayFor("")}><Receipt /> Enregistrer un paiement</Button>
            : <Tip content={READ_ONLY_HINT}><span><Button variant="primary" disabled><Receipt /> Enregistrer un paiement</Button></span></Tip>
        }
      />

      {q.isError && (
        <Card className="mb-6 flex flex-col items-start gap-3 border-[color-mix(in_oklab,var(--danger)_30%,var(--border))] p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">{errorMessage(q.error)}</p>
          <Button variant="secondary" size="sm" onClick={() => q.refetch()}><RefreshCw /> Réessayer</Button>
        </Card>
      )}

      <Stagger className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <StaggerItem key={k.label}>
            <Link to={k.to} className="group block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className="flex h-full flex-col gap-3 p-4 transition-[border-color,box-shadow] group-hover:border-border-strong group-hover:shadow-md sm:p-5">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[11px] font-medium uppercase leading-tight tracking-[0.08em] text-muted-foreground">{k.label}</span>
                  <ArrowUpRight className="size-4 shrink-0 text-faint transition-colors group-hover:text-foreground" />
                </div>
                {q.isLoading ? <Skeleton className="h-8 w-16" /> : (
                  <span className="font-mono text-[28px] font-semibold leading-none tracking-tight tabular sm:text-[32px]"><AnimatedNumber value={k.value} /></span>
                )}
                <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                  <ToneDot tone={k.tone} />{k.hint}
                </span>
              </Card>
            </Link>
          </StaggerItem>
        ))}
      </Stagger>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        {/* Encaissements du mois */}
        <Card className="lg:col-span-3">
          <div className="flex flex-col gap-1 p-5 pb-2 sm:p-6 sm:pb-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Encaissé en {monthLabel()}</span>
            {q.isLoading ? <Skeleton className="mt-1 h-9 w-48" /> : (
              <span className="font-mono text-[32px] font-semibold leading-tight tracking-tight tabular">
                <AnimatedNumber value={d?.revenueThisMonth.total ?? 0} format={formatFcfa} />
              </span>
            )}
            <span className="text-[13px] text-muted-foreground">{paymentsCount} paiement{paymentsCount > 1 ? "s" : ""} enregistré{paymentsCount > 1 ? "s" : ""}</span>
          </div>
          <div className="h-[220px] px-2 sm:px-4" role="img" aria-label={`Encaissements par moyen de paiement : ${byMethod.map((r) => `${r.label} ${formatFcfa(r.amount)}`).join(", ")}`}>
            {q.isLoading ? <Skeleton className="mx-4 h-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byMethod} margin={{ top: 16, right: 8, left: 8, bottom: 0 }} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                  <YAxis tickLine={false} axisLine={false} width={44} tick={{ fill: "var(--muted-foreground)", fontSize: 11, fontFamily: "var(--font-mono)" }}
                    tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                  <Tooltip cursor={{ fill: "var(--hover)" }} content={<ChartTip />} />
                  <Bar dataKey="amount" fill="var(--brand-bg)" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive animationDuration={500} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-b-lg border-t border-border bg-border sm:grid-cols-4">
            {byMethod.map((r) => (
              <li key={r.method} className="flex flex-col gap-0.5 bg-card px-4 py-3">
                <span className="text-xs text-muted-foreground">{r.label}</span>
                <span className="font-mono text-sm font-medium tabular">{formatFcfa(r.amount)}</span>
                <span className="text-[11px] text-faint">{r.count} paiement{r.count > 1 ? "s" : ""}</span>
              </li>
            ))}
          </ul>
        </Card>

        {/* Licences qui expirent bientôt */}
        <Card className="flex flex-col lg:col-span-2">
          <div className="flex items-center justify-between gap-2 p-5 pb-3 sm:p-6 sm:pb-3">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Expirent sous 7 jours</h2>
              <p className="text-[13px] text-muted-foreground">Relancez avant la période de grâce.</p>
            </div>
            {d && d.expiringSoon.length > 0 && <Badge tone="amber">{d.expiringSoon.length}</Badge>}
          </div>
          {q.isLoading ? (
            <div className="flex flex-col gap-3 px-6 pb-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : !d?.expiringSoon.length ? (
            <EmptyState icon={<CalendarClock />} title="Aucune échéance proche" description="Aucune licence n'arrive à terme dans les 7 prochains jours." className="py-10" />
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {d.expiringSoon.map((e) => {
                const days = daysUntil(e.currentPeriodEnd) ?? 0;
                return (
                  <li key={e.tenant.id} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <Link to={`/admin/restaurants/${e.tenant.id}`} className="truncate text-sm font-medium hover:underline">{e.tenant.name}</Link>
                      <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <StatusBadge status={e.status} labels={SUBSCRIPTION_STATUS_LABEL} className="h-5 text-[11px]" />
                        {e.plan.name} · <span className={cn("font-mono", days <= 1 && "text-danger")}>{days <= 0 ? "aujourd'hui" : `J-${days}`}</span> · {formatDate(e.currentPeriodEnd)}
                      </span>
                    </div>
                    {canWrite && <Button size="sm" variant="secondary" onClick={() => setPayFor(e.tenant.id)}>Encaisser</Button>}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-auto flex gap-2 border-t border-border p-3">
            <Button asChild variant="ghost" size="sm" className="flex-1"><Link to="/admin/restaurants"><Store /> Restaurants</Link></Button>
            <Button asChild variant="ghost" size="sm" className="flex-1"><Link to="/admin/inscriptions"><Inbox /> Inscriptions</Link></Button>
          </div>
        </Card>
      </div>

      <RecordPaymentDialog open={payFor !== null} onOpenChange={(o) => !o && setPayFor(null)} tenantId={payFor || undefined} />
    </>
  );
}

function ChartTip({ active, payload }: { active?: boolean; payload?: { payload: { label: string; amount: number; count: number } }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{p.label}</p>
      <p className="font-mono tabular">{formatFcfa(p.amount)}</p>
      <p className="text-muted-foreground">{p.count} paiement{p.count > 1 ? "s" : ""}</p>
    </div>
  );
}
