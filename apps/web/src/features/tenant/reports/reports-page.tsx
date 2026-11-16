import type { ReportKind } from "@restaurant/api-client";
import { zonedDay } from "@restaurant/utils";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Lock } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchRow } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { saveBlob } from "@/lib/download";
import { toastError } from "@/lib/errors";
import { formatDateShort, formatFcfa, formatNumber } from "@/lib/format";
import { ORDER_PAYMENT_METHOD_LABEL, ORDER_TYPE_LABEL } from "@/lib/labels";
import { useUrlParam } from "@/lib/use-url-state";
import { useSpacePath } from "@/providers/space";
import { useTenant, useTimezone } from "../hooks";
import { isPlanFeatureError } from "../stock/stock-hooks";
import { ColumnChart, Delta, HBarList, Heatmap, Legend, METHOD_COLOR } from "./charts";

type Period = { from: string; to: string };
const PRESETS = [
  { value: "today", label: "Aujourd'hui" }, { value: "yesterday", label: "Hier" }, { value: "7d", label: "7 jours" },
  { value: "30d", label: "30 jours" }, { value: "month", label: "Ce mois" }, { value: "custom", label: "Période" },
] as const;
type Preset = (typeof PRESETS)[number]["value"];

const addDays = (day: string, n: number) => { const [y, m, d] = day.split("-").map(Number); return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10); };

function periodFor(preset: Preset, today: string, custom: Period): Period {
  switch (preset) {
    case "today": return { from: today, to: today };
    case "yesterday": return { from: addDays(today, -1), to: addDays(today, -1) };
    case "30d": return { from: addDays(today, -29), to: today };
    case "month": return { from: `${today.slice(0, 7)}-01`, to: today };
    case "custom": return custom;
    default: return { from: addDays(today, -6), to: today };
  }
}

const TABS = [
  { value: "sales", label: "Ventes" }, { value: "peak", label: "Heures de pointe" }, { value: "vat", label: "TVA" }, { value: "register", label: "Caisse" },
  { value: "margins", label: "Marges" }, { value: "waste", label: "Pertes" }, { value: "staff", label: "Personnel" }, { value: "reviews", label: "Avis" },
] as const;
const EXPORT_KIND: Record<string, ReportKind> = { sales: "sales", peak: "peak-hours", vat: "vat", register: "register", margins: "margins", waste: "waste", staff: "staff", reviews: "reviews" };

/** Rapports (responsables, plan avec le module `reports`) : ventes, heures de pointe, TVA, caisse, marges, pertes, personnel, avis ; exports CSV et PDF. */
export function ReportsPage() {
  const tz = useTimezone();
  const today = zonedDay(new Date(), tz);
  const [tab, setTab] = useUrlParam("onglet", "sales");
  const [preset, setPreset] = useUrlParam("periode", "7d");
  const [cFrom, setFrom] = useUrlParam("du", addDays(today, -6));
  const [cTo, setTo] = useUrlParam("au", today);
  const p = periodFor(preset as Preset, today, { from: cFrom, to: cTo });
  const valid = p.from <= p.to && (Date.parse(p.to) - Date.parse(p.from)) / 86_400_000 < 366;
  const [locked, setLocked] = React.useState(false);

  if (locked) return <LockedState />;
  return (
    <>
      <PageHeader title="Rapports" description="Chiffres fiables de votre restaurant, à exporter en CSV ou en PDF." />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="-mx-4 max-w-[100vw] overflow-x-auto px-4 sm:mx-0 sm:max-w-full sm:overflow-visible sm:px-0"><Segmented ariaLabel="Période" value={preset as Preset} onChange={(v) => setPreset(v)} options={PRESETS.map((x) => ({ value: x.value, label: x.label }))} className="min-w-max" /></div>
        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="rp-from">Du</label>
            <Input id="rp-from" type="date" value={cFrom} max={cTo} onChange={(e) => setFrom(e.target.value)} className="w-auto font-mono" />
            <span className="text-muted-foreground">au</span>
            <label className="sr-only" htmlFor="rp-to">Au</label>
            <Input id="rp-to" type="date" value={cTo} min={cFrom} max={today} onChange={(e) => setTo(e.target.value)} className="w-auto font-mono" />
          </div>
        )}
        <span className="font-mono text-[13px] text-muted-foreground">{p.from === p.to ? formatDateShort(p.from) : `${formatDateShort(p.from)} → ${formatDateShort(p.to)}`}</span>
      </div>
      {!valid ? (
        <ErrorState error={new Error("Choisissez une période valide de 366 jours au plus.")} compact />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>{TABS.map((x) => <TabsTrigger key={x.value} value={x.value}>{x.label}</TabsTrigger>)}</TabsList>
          <div className="pt-6">
            <ExportBar kind={EXPORT_KIND[tab] ?? "sales"} p={p} withOrders={tab === "sales"} />
            {tab === "sales" && <SalesTab p={p} onLocked={() => setLocked(true)} />}
            {tab === "peak" && <PeakTab p={p} onLocked={() => setLocked(true)} />}
            {tab === "vat" && <VatTab p={p} onLocked={() => setLocked(true)} />}
            {tab === "register" && <RegisterTab p={p} onLocked={() => setLocked(true)} />}
            {tab === "margins" && <MarginsTab p={p} onLocked={() => setLocked(true)} />}
            {tab === "waste" && <WasteTab p={p} onLocked={() => setLocked(true)} />}
            {tab === "staff" && <StaffTab p={p} onLocked={() => setLocked(true)} />}
            {tab === "reviews" && <ReviewsTab p={p} onLocked={() => setLocked(true)} />}
          </div>
        </Tabs>
      )}
      <DailyReportCard />
    </>
  );
}

function LockedState() {
  const t = useTenant();
  const to = useSpacePath();
  return (
    <>
      <PageHeader title="Rapports" />
      <EmptyState icon={<Lock />} title="Le module Rapports n'est pas inclus dans votre plan"
        description="Ventes, TVA, caisse, marges, pertes, performances et exports sont disponibles à partir du plan Pro."
        action={t.canSeeLicense ? <Button asChild variant="primary"><Link to={to("/licence")}>Voir les plans</Link></Button> : undefined} />
    </>
  );
}

/** Interroge un rapport ; un plan sans le module (403 PLAN_FEATURE) bascule l'écran sur l'état « module non inclus ». */
function useReport<T>(kind: string, p: Period, fetcher: () => Promise<T>, onLocked: () => void) {
  const t = useTenant();
  const q = useQuery({
    queryKey: t.key("reports", kind, p.from, p.to), queryFn: fetcher, placeholderData: keepPreviousData, staleTime: 30_000,
    retry: (n, e) => !isPlanFeatureError(e) && n < 2,
  });
  React.useEffect(() => { if (isPlanFeatureError(q.error)) onLocked(); }, [q.error, onLocked]);
  return q;
}

function ExportBar({ kind, p, withOrders }: { kind: ReportKind; p: Period; withOrders: boolean }) {
  const t = useTenant();
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = async (k: ReportKind, format: "csv" | "pdf") => {
    setBusy(`${k}-${format}`);
    try { saveBlob(await t.api.reports.download(k, p, format)); } catch (e) { toastError(e, "Export impossible"); } finally { setBusy(null); }
  };
  return (
    <div className="mb-4 flex flex-wrap items-center justify-end gap-2" role="group" aria-label="Exports">
      {withOrders && <Button size="sm" variant="ghost" loading={busy === "orders-csv"} onClick={() => run("orders", "csv")}><Download /> Commandes (CSV)</Button>}
      <Button size="sm" loading={busy === `${kind}-csv`} onClick={() => run(kind, "csv")}><Download /> CSV</Button>
      <Button size="sm" loading={busy === `${kind}-pdf`} onClick={() => run(kind, "pdf")}><FileText /> PDF</Button>
    </div>
  );
}

function Kpi({ label, value, children, loading }: { label: string; value: React.ReactNode; children?: React.ReactNode; loading?: boolean }) {
  return (
    <Card className="flex flex-col gap-2 p-4 sm:p-5">
      <span className="text-[11px] font-medium uppercase leading-tight tracking-[0.08em] text-muted-foreground">{label}</span>
      {loading ? <Skeleton className="h-8 w-28" /> : <span className="font-mono text-[22px] font-semibold leading-none tracking-tight tabular-nums sm:text-[26px]">{value}</span>}
      <div className="min-h-4">{children}</div>
    </Card>
  );
}
const KpiGrid = ({ children }: { children: React.ReactNode }) => <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">{children}</div>;
const Section = ({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) => (
  <Card className={cn("min-w-0", className)}>
    <div className="p-5 pb-3 sm:p-6 sm:pb-3">
      <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
    </div>
    {children}
  </Card>
);
const fmtDay = (d: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

type TabProps = { p: Period; onLocked: () => void };

function SalesTab({ p, onLocked }: TabProps) {
  const t = useTenant();
  const q = useReport("sales", p, () => t.api.reports.sales(p), onLocked);
  const d = q.data;
  if (q.isError && !isPlanFeatureError(q.error)) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = d?.summary, b = d?.previous.summary;
  const single = p.from === p.to;
  const series = single
    ? (d?.byHour ?? []).filter((h) => h.hour >= 8 || h.orders > 0).map((h) => ({ label: `${h.hour} h`, value: h.orders, sub: formatFcfa(h.total) }))
    : (d?.byDay ?? []).map((x) => ({ label: fmtDay(x.day), value: x.revenue, sub: `${x.orders} commande${x.orders > 1 ? "s" : ""}` }));
  const empty = !!d && d.summary.ordersCount === 0 && d.summary.revenue === 0;
  return (
    <div className={q.isFetching && !q.isLoading ? "opacity-70 transition-opacity" : "transition-opacity"}>
      <KpiGrid>
        <Kpi label="Encaissé" value={formatFcfa(s?.revenue ?? 0)} loading={q.isLoading}>{s && b && <Delta now={s.revenue} before={b.revenue} />}</Kpi>
        <Kpi label="Commandes" value={formatNumber(s?.ordersCount ?? 0)} loading={q.isLoading}>{s && b && <Delta now={s.ordersCount} before={b.ordersCount} />}</Kpi>
        <Kpi label="Ticket moyen" value={formatFcfa(s?.averageTicket ?? 0)} loading={q.isLoading}>{s && b && <Delta now={s.averageTicket} before={b.averageTicket} />}</Kpi>
        <Kpi label="Pourboires" value={formatFcfa(s?.tips ?? 0)} loading={q.isLoading}>{s && b && <Delta now={s.tips} before={b.tips} />}</Kpi>
      </KpiGrid>
      {empty ? (
        <Card><EmptyState title="Aucune vente sur cette période" description="Choisissez une autre période ou prenez des commandes." /></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Section className="lg:col-span-2" title={single ? "Commandes par heure" : "Encaissé par jour"} description={single ? "Heure locale du restaurant." : "Paiements encaissés, par jour du restaurant."}>
            {q.isLoading ? <Skeleton className="mx-5 mb-5 h-[240px]" /> : (
              <ColumnChart data={series} unit={single ? "count" : "fcfa"} ariaLabel={`${single ? "Commandes par heure" : "Encaissé par jour"} : ${series.map((x) => `${x.label} ${x.value}`).join(", ")}`} />
            )}
          </Section>
          <Section title="Par moyen de paiement" description="Encaissé, remboursements exclus.">
            <Legend items={(d?.byMethod ?? []).map((m) => ({ label: ORDER_PAYMENT_METHOD_LABEL[m.method] ?? m.method, color: METHOD_COLOR[m.method] ?? "var(--chart-muted)" }))} />
            <HBarList rows={(d?.byMethod ?? []).map((m) => ({ key: m.method, label: ORDER_PAYMENT_METHOD_LABEL[m.method] ?? m.method, value: m.amount, display: formatFcfa(m.amount), hint: `${m.count} paiement${m.count > 1 ? "s" : ""}`, color: METHOD_COLOR[m.method] }))} />
          </Section>
          <Section title="Par catégorie" description="Ventes TTC des commandes de la période.">
            <HBarList rows={(d?.byCategory ?? []).map((c) => ({ key: c.categoryId ?? c.name, label: c.name, value: c.amount, display: formatFcfa(c.amount), hint: `${c.quantity} vendus` }))} />
          </Section>
          <Section title="Plats les plus vendus" description="Top 10 en quantité.">
            <HBarList rows={(d?.byItem ?? []).slice(0, 10).map((i) => ({ key: `${i.menuItemId}${i.name}`, label: i.name, value: i.quantity, display: `×${i.quantity} · ${formatFcfa(i.amount)}` }))} />
          </Section>
          <Section title="Sur place, à emporter, livraison">
            <HBarList rows={(d?.byType ?? []).map((x) => ({ key: x.type, label: ORDER_TYPE_LABEL[x.type] ?? x.type, value: x.total, display: `${formatFcfa(x.total)} · ${x.orders}` }))} />
          </Section>
          <Section title="Par serveur" description="Total des commandes prises.">
            <HBarList rows={(d?.byWaiter ?? []).map((w) => ({ key: w.userId ?? "none", label: w.name, value: w.total, display: `${formatFcfa(w.total)} · ${w.orders}` }))} />
          </Section>
          <Section title="Remises, annulations et remboursements">
            <dl className="flex flex-col divide-y divide-border border-t border-border text-sm">
              {s && ([
                ["Remises promotionnelles", formatFcfa(s.discounts), b ? <Delta key="d" now={s.discounts} before={b.discounts} inverse /> : null],
                ["Commandes annulées", `${s.cancelledOrders.count} · ${formatFcfa(s.cancelledOrders.amount)}`, b ? <Delta key="c" now={s.cancelledOrders.count} before={b.cancelledOrders.count} inverse /> : null],
                ["Articles annulés", `${s.cancelledItems.count} · ${formatFcfa(s.cancelledItems.amount)}`, null],
                ["Remboursements", `${s.refunds.count} · ${formatFcfa(s.refunds.amount)}`, b ? <Delta key="r" now={s.refunds.amount} before={b.refunds.amount} inverse /> : null],
              ] as [string, string, React.ReactNode][]).map(([k, v, delta]) => (
                <div key={k} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-5 py-3 sm:px-6">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="flex flex-col items-end gap-0.5"><span className="font-mono tabular-nums">{v}</span>{delta}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>
      )}
    </div>
  );
}

function PeakTab({ p, onLocked }: TabProps) {
  const t = useTenant();
  const q = useReport("peak", p, () => t.api.reports.peakHours(p), onLocked);
  const d = q.data;
  if (q.isError && !isPlanFeatureError(q.error)) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const day = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Section className="lg:col-span-2" title="Carte de chaleur" description="Commandes par jour de la semaine et par heure locale.">
        {q.isLoading || !d ? <Skeleton className="mx-5 mb-5 h-[260px]" /> : d.totalOrders === 0 ? <EmptyState title="Aucune commande sur cette période" className="py-10" /> : <Heatmap cells={d.cells} max={d.max} />}
      </Section>
      <Section title="Créneaux les plus chargés" description="Les 5 premiers de la période.">
        <ol className="flex flex-col divide-y divide-border border-t border-border">
          {(d?.top ?? []).map((c, i) => (
            <li key={`${c.weekday}-${c.hour}`} className="flex items-center gap-3 px-5 py-3 text-sm sm:px-6">
              <span className="w-4 font-mono text-xs text-faint tabular-nums">{i + 1}</span>
              <span className="flex-1 first-letter:uppercase">{day[c.weekday - 1]} · <span className="font-mono tabular-nums">{c.hour} h</span></span>
              <span className="font-mono tabular-nums">{c.orders}</span>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

function table<T>(rows: T[] | undefined, columns: Column<T>[], key: (r: T) => string, loading: boolean, empty: string, footer?: React.ReactNode) {
  return <DataTable rows={rows} columns={columns} rowKey={key} loading={loading} empty={<EmptyState title={empty} className="py-10" />} footer={footer} />;
}
const money = (n: number | null | undefined) => (n == null ? "—" : formatFcfa(n));
const pct = (n: number | null | undefined) => (n == null ? "—" : `${String(n).replace(".", ",")} %`);

function VatTab({ p, onLocked }: TabProps) {
  const t = useTenant();
  const q = useReport("vat", p, () => t.api.reports.vat(p), onLocked);
  const d = q.data;
  if (q.isError && !isPlanFeatureError(q.error)) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <>
      <KpiGrid>
        <Kpi label="TVA collectée" value={money(d?.totals.vat ?? 0)} loading={q.isLoading} />
        <Kpi label="Base hors taxes" value={money(d?.totals.base ?? 0)} loading={q.isLoading} />
        <Kpi label="Total TTC" value={money(d?.totals.ttc ?? 0)} loading={q.isLoading} />
      </KpiGrid>
      {table(d?.rows, [
        { key: "rate", header: "Taux", cell: (r) => <span className="font-mono">{String(r.rate).replace(".", ",")} %</span> },
        { key: "base", header: "Base HT", align: "right", cell: (r) => <span className="font-mono tabular-nums">{money(r.base)}</span> },
        { key: "vat", header: "TVA", align: "right", cell: (r) => <span className="font-mono font-medium tabular-nums">{money(r.vat)}</span> },
        { key: "ttc", header: "Total TTC", align: "right", cell: (r) => <span className="font-mono tabular-nums">{money(r.ttc)}</span> },
      ], (r) => String(r.rate), q.isLoading, "Aucune TVA collectée sur cette période")}
      {d && <p className="mt-3 text-[13px] text-muted-foreground">{d.basis}. Les remboursements ne sont pas déduits.</p>}
    </>
  );
}

function RegisterTab({ p, onLocked }: TabProps) {
  const t = useTenant();
  const q = useReport("register", p, () => t.api.reports.register(p), onLocked);
  const d = q.data;
  if (q.isError && !isPlanFeatureError(q.error)) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const when = (x: string | null) => (x ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: d?.timezone }).format(new Date(x)) : "En cours");
  return (
    <>
      <KpiGrid>
        <Kpi label="Sessions" value={formatNumber(d?.totals.sessions ?? 0)} loading={q.isLoading} />
        <Kpi label="Encaissé" value={money(d?.totals.payments ?? 0)} loading={q.isLoading} />
        <Kpi label="Écart cumulé" value={money(d?.totals.difference ?? 0)} loading={q.isLoading} />
        <Kpi label="Sessions avec écart" value={formatNumber(d?.totals.withGap ?? 0)} loading={q.isLoading} />
      </KpiGrid>
      {table(d?.rows, [
        { key: "open", header: "Ouverture", cell: (r) => <span className="font-mono text-[13px]">{when(r.openedAt)}</span> },
        { key: "close", header: "Clôture", hideOnMobile: true, cell: (r) => <span className="font-mono text-[13px]">{when(r.closedAt)}</span> },
        { key: "by", header: "Ouverte par", hideOnMobile: true, cell: (r) => r.openedBy },
        { key: "fond", header: "Fond", align: "right", cell: (r) => <span className="font-mono tabular-nums">{money(r.opening)}</span> },
        { key: "pay", header: "Encaissé", align: "right", cell: (r) => <span className="font-mono tabular-nums">{money(r.payments)}</span> },
        { key: "exp", header: "Attendu", align: "right", hideOnMobile: true, cell: (r) => <span className="font-mono tabular-nums">{money(r.expectedCash)}</span> },
        { key: "cnt", header: "Compté", align: "right", hideOnMobile: true, cell: (r) => <span className="font-mono tabular-nums">{money(r.closing)}</span> },
        { key: "diff", header: "Écart", align: "right", cell: (r) => <span className={`font-mono font-medium tabular-nums ${r.difference ? "text-[var(--tone-red-fg)]" : ""}`}>{r.difference == null ? "—" : `${r.difference > 0 ? "+" : ""}${formatFcfa(r.difference)}`}</span> },
      ], (r) => r.id, q.isLoading, "Aucune session de caisse sur cette période")}
    </>
  );
}

function MarginsTab({ p, onLocked }: TabProps) {
  const t = useTenant();
  const q = useReport("margins", p, () => t.api.reports.margins(p), onLocked);
  const d = q.data;
  if (q.isError && !isPlanFeatureError(q.error)) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <>
      <KpiGrid>
        <Kpi label="Marge brute" value={money(d?.totals.margin ?? 0)} loading={q.isLoading} />
        <Kpi label="Taux de marge" value={pct(d?.totals.marginRate)} loading={q.isLoading} />
        <Kpi label="Coût matière" value={money(d?.totals.cost ?? 0)} loading={q.isLoading} />
        <Kpi label="Ventes sans fiche" value={money(d?.uncosted.revenue ?? 0)} loading={q.isLoading}><span className="text-[12.5px] text-muted-foreground">Hors calcul de marge</span></Kpi>
      </KpiGrid>
      {table(d?.rows, [
        { key: "name", header: "Plat", cell: (r) => <div className="flex flex-col"><span className="font-medium">{r.name}</span><span className="text-xs text-muted-foreground">{r.category}</span></div> },
        { key: "qty", header: "Vendus", align: "right", cell: (r) => <span className="font-mono tabular-nums">{r.quantity}</span> },
        { key: "rev", header: "Ventes HT", align: "right", hideOnMobile: true, cell: (r) => <span className="font-mono tabular-nums">{money(r.revenueNet)}</span> },
        { key: "cost", header: "Coût matière", align: "right", hideOnMobile: true, cell: (r) => <span className="font-mono tabular-nums">{r.hasRecipe ? money(r.cost) : "—"}</span> },
        { key: "margin", header: "Marge", align: "right", cell: (r) => <span className="font-mono font-medium tabular-nums">{r.hasRecipe ? money(r.margin) : "Sans fiche"}</span> },
        { key: "rate", header: "Taux", align: "right", cell: (r) => <span className="font-mono tabular-nums">{pct(r.marginRate)}</span> },
      ], (r) => `${r.menuItemId}${r.vatRate}`, q.isLoading, "Aucun plat vendu sur cette période")}
      <p className="mt-3 text-[13px] text-muted-foreground">Le coût matière est celui des fiches techniques d'aujourd'hui, multiplié par les quantités vendues.</p>
    </>
  );
}

function WasteTab({ p, onLocked }: TabProps) {
  const t = useTenant();
  const q = useReport("waste", p, () => t.api.reports.waste(p), onLocked);
  const d = q.data;
  if (q.isError && !isPlanFeatureError(q.error)) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <>
      <KpiGrid>
        <Kpi label="Valeur perdue" value={money(d?.totals.cost ?? 0)} loading={q.isLoading} />
        <Kpi label="Déclarations" value={formatNumber(d?.totals.count ?? 0)} loading={q.isLoading} />
      </KpiGrid>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Par ingrédient" description="Valorisé au coût moyen du moment.">
          <HBarList rows={(d?.ingredients ?? []).slice(0, 10).map((i) => ({ key: i.ingredientId, label: i.name, value: i.cost, display: money(i.cost), hint: `${i.quantity} ${i.unit} · ${i.count} déclaration${i.count > 1 ? "s" : ""}` }))} empty="Aucune perte déclarée sur cette période." />
        </Section>
        <Section title="Par motif">
          <HBarList rows={(d?.reasons ?? []).slice(0, 10).map((r) => ({ key: r.reason, label: r.reason, value: r.cost, display: money(r.cost), hint: `${r.count} déclaration${r.count > 1 ? "s" : ""}` }))} empty="Aucune perte déclarée sur cette période." />
        </Section>
      </div>
    </>
  );
}

function StaffTab({ p, onLocked }: TabProps) {
  const t = useTenant();
  const q = useReport("staff", p, () => t.api.reports.staff(p), onLocked);
  const d = q.data;
  if (q.isError && !isPlanFeatureError(q.error)) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <>
      <KpiGrid>
        <Kpi label="Encaissé" value={money(d?.totals.revenue ?? 0)} loading={q.isLoading} />
        <Kpi label="Commandes" value={formatNumber(d?.totals.orders ?? 0)} loading={q.isLoading} />
        <Kpi label="Ticket moyen" value={money(d?.totals.averageTicket ?? 0)} loading={q.isLoading} />
        <Kpi label="Pourboires" value={money(d?.totals.tips ?? 0)} loading={q.isLoading} />
      </KpiGrid>
      {table(d?.rows, [
        { key: "rank", header: "#", cell: (r) => <span className="font-mono text-xs text-faint">{r.rank}</span> },
        { key: "name", header: "Nom", cell: (r) => <span className="font-medium">{r.name}</span> },
        { key: "orders", header: "Commandes", align: "right", cell: (r) => <span className="font-mono tabular-nums">{r.orders}</span> },
        { key: "rev", header: "Encaissé", align: "right", cell: (r) => <span className="font-mono tabular-nums">{money(r.revenue)}</span> },
        { key: "avg", header: "Ticket moyen", align: "right", hideOnMobile: true, cell: (r) => <span className="font-mono tabular-nums">{money(r.averageTicket)}</span> },
        { key: "tips", header: "Pourboires", align: "right", hideOnMobile: true, cell: (r) => <span className="font-mono tabular-nums">{money(r.tips)}</span> },
        { key: "can", header: "Annulations", align: "right", hideOnMobile: true, cell: (r) => <span className="font-mono tabular-nums">{r.cancellations}</span> },
      ], (r) => r.userId, q.isLoading, "Aucune activité du personnel sur cette période")}
    </>
  );
}

function ReviewsTab({ p, onLocked }: TabProps) {
  const t = useTenant();
  const q = useReport("reviews", p, () => t.api.reports.reviews(p), onLocked);
  const d = q.data;
  if (q.isError && !isPlanFeatureError(q.error)) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = d?.summary;
  return (
    <>
      <KpiGrid>
        <Kpi label="Note moyenne" value={s?.average == null ? "—" : `${String(s.average).replace(".", ",")} / 5`} loading={q.isLoading}>
          {s?.average != null && d?.previous.summary.average != null && <Delta now={s.average} before={d.previous.summary.average} />}
        </Kpi>
        <Kpi label="Avis" value={formatNumber(s?.count ?? 0)} loading={q.isLoading}>{s && d && <Delta now={s.count} before={d.previous.summary.count} />}</Kpi>
        <Kpi label="Avis masqués" value={formatNumber(d?.hidden ?? 0)} loading={q.isLoading} />
      </KpiGrid>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Répartition des notes">
          <HBarList rows={([5, 4, 3, 2, 1] as const).map((n) => ({ key: String(n), label: `${n} étoile${n > 1 ? "s" : ""}`, value: s?.distribution[n] ?? 0, display: String(s?.distribution[n] ?? 0) }))} />
        </Section>
        <Section title="Derniers avis">
          {!d?.recent.length ? <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">Aucun avis sur cette période.</p> : (
            <ul className="flex flex-col divide-y divide-border border-t border-border">
              {d.recent.slice(0, 6).map((r) => (
                <li key={r.id} className="flex flex-col gap-0.5 px-5 py-3 text-sm sm:px-6">
                  <div className="flex items-center justify-between gap-2"><span className="font-mono">{r.rating} / 5 · n° {r.orderNumber}</span><span className="text-xs text-muted-foreground">{formatDateShort(r.createdAt)}{r.hidden ? " · masqué" : ""}</span></div>
                  {r.comment && <p className="text-muted-foreground">{r.comment}</p>}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}

/** Rapport quotidien par email aux responsables : lecture pour tous les responsables, réglage pour l'administrateur. */
function DailyReportCard() {
  const t = useTenant();
  const qc = useQueryClient();
  const key = t.key("settings", "reports");
  const q = useQuery({ queryKey: key, queryFn: () => t.api.settings.get("reports"), retry: false });
  const save = useMutation({
    mutationFn: (body: { dailyReport?: boolean; dailyReportHour?: number }) => t.api.settings.update("reports", body),
    onSuccess: (v) => { qc.setQueryData(key, v); toast.success(v.dailyReport ? "Rapport quotidien activé" : "Rapport quotidien désactivé"); },
    onError: (e) => toastError(e),
  });
  if (!q.data) return null;
  return (
    <Card className="mt-8 p-5 sm:p-6">
      <SwitchRow
        label="Rapport quotidien par email"
        description="Chaque matin, les ventes de la veille sont envoyées aux administrateurs et gérants. Aucun email les jours sans vente."
        checked={q.data.dailyReport} disabled={!t.isAdmin || save.isPending} onCheckedChange={(v) => save.mutate({ dailyReport: v })}
      />
      {q.data.dailyReport && (
        <div className="flex items-center gap-3 border-t border-border pt-3">
          <label htmlFor="daily-hour" className="text-sm text-muted-foreground">Envoi à partir de</label>
          <select id="daily-hour" disabled={!t.isAdmin || save.isPending} value={q.data.dailyReportHour} onChange={(e) => save.mutate({ dailyReportHour: Number(e.target.value) })}
            className="h-11 rounded-md border border-border bg-background px-3 font-mono text-sm sm:h-9">
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")} h</option>)}
          </select>
          <span className="text-[13px] text-muted-foreground">heure du restaurant</span>
        </div>
      )}
      {!t.isAdmin && <p className="pt-2 text-[13px] text-muted-foreground">Seul l'administrateur peut modifier ce réglage.</p>}
    </Card>
  );
}
