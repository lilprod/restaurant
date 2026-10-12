import { zonedDay } from "@restaurant/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, Check, ShieldCheck, SquarePlus, Store, Palette, UtensilsCrossed } from "lucide-react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Stagger, StaggerItem } from "@/components/ui/motion";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { formatFcfa, formatNumber } from "@/lib/format";
import { ORDER_PAYMENT_METHOD_LABEL, ORDER_PAYMENT_METHODS } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useUrlParam } from "@/lib/use-url-state";
import { useUser } from "@/providers/session";
import { useSpacePath } from "@/providers/space";
import { useTenant, useTimezone } from "./hooks";

function greeting(tz: string) {
  const h = Number(new Intl.DateTimeFormat("fr-FR", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date()));
  return h < 5 || h >= 18 ? "Bonsoir" : "Bonjour";
}

const dayLabel = (day: string, tz: string) =>
  new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`)) + (day === zonedDay(new Date(), tz) ? " (aujourd'hui)" : "");

/** Tableau de bord des responsables : la journée du restaurant (son fuseau), en direct. */
export function TenantDashboardPage() {
  const user = useUser();
  const t = useTenant();
  const to = useSpacePath();
  const tz = useTimezone();
  const today = zonedDay(new Date(), tz);
  const [date, setDate] = useUrlParam("date", "");
  const day = date || today;
  const q = useQuery({ queryKey: tenantKeys.dashboard(t.root, day), queryFn: () => t.api.dashboard(day), placeholderData: keepPreviousData, refetchInterval: 60_000 });
  const d = q.data;

  const methods = ORDER_PAYMENT_METHODS.map((m) => ({ method: m, label: ORDER_PAYMENT_METHOD_LABEL[m]!, amount: d?.byMethod.find((x) => x.method === m)?.amount ?? 0 }));
  const maxMethod = Math.max(1, ...methods.map((m) => m.amount));
  const active = d?.byHour.filter((h) => h.orders > 0).map((h) => h.hour) ?? [];
  const from = Math.min(8, ...active), toHour = Math.max(22, ...active);
  const hours = (d?.byHour ?? []).filter((h) => h.hour >= from && h.hour <= toHour).map((h) => ({ ...h, label: `${h.hour}h` }));
  const peak = d?.byHour.reduce((a, b) => (b.orders > a.orders ? b : a), { hour: 0, orders: 0 });
  const maxTop = Math.max(1, ...(d?.topItems.map((i) => i.quantity) ?? []));

  const kpis = [
    { label: "Encaissé", value: d?.revenue ?? 0, fmt: formatFcfa, hint: d?.tips ? `+ ${formatFcfa(d.tips)} de pourboires` : "Paiements encaissés ce jour" },
    { label: "Commandes", value: d?.ordersCount ?? 0, fmt: formatNumber, hint: d ? `${d.byType.DINE_IN} sur place · ${d.byType.TAKEAWAY} à emporter` : "—" },
    { label: "Ticket moyen", value: d?.averageTicket ?? 0, fmt: formatFcfa, hint: "Total moyen par commande" },
    { label: "Commandes ouvertes", value: d?.openOrders ?? 0, fmt: formatNumber, hint: "En cours de service", to: to("/commandes") },
  ];

  return (
    <>
      <PageHeader
        eyebrow={<span className="text-[13px] text-muted-foreground first-letter:uppercase">{dayLabel(day, tz)}</span>}
        title={`${greeting(tz)} ${user.firstName}`}
        description="Chiffre d'affaires, commandes et plats de la journée, mis à jour en direct."
        actions={
          <>
            <label className="sr-only" htmlFor="dash-date">Journée affichée</label>
            <Input id="dash-date" type="date" value={day} max={today} onChange={(e) => setDate(e.target.value === today ? null : e.target.value)} className="w-auto font-mono" />
            {t.isFloor && <Button asChild variant="primary"><Link to={to("/commandes/nouvelle")}><SquarePlus /> Nouvelle commande</Link></Button>}
          </>
        }
      />

      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} className="mb-6" />}

      <Stagger className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {kpis.map((k) => {
          const body = (
            <Card className={cn("flex h-full flex-col gap-3 p-4 sm:p-5", k.to && "transition-[border-color,box-shadow] group-hover:border-border-strong group-hover:shadow-md")}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-[11px] font-medium uppercase leading-tight tracking-[0.08em] text-muted-foreground">{k.label}</span>
                {k.to && <ArrowUpRight className="size-4 shrink-0 text-faint group-hover:text-foreground" />}
              </div>
              {q.isLoading ? <Skeleton className="h-8 w-24" /> : (
                <span className="font-mono text-[22px] font-semibold leading-none tracking-tight tabular-nums sm:text-[28px]"><AnimatedNumber value={k.value} format={k.fmt} /></span>
              )}
              <span className="text-[12.5px] text-muted-foreground">{k.hint}</span>
            </Card>
          );
          return (
            <StaggerItem key={k.label}>
              {k.to ? <Link to={k.to} className="group block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</Link> : body}
            </StaggerItem>
          );
        })}
      </Stagger>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <div className="flex flex-wrap items-end justify-between gap-2 p-5 pb-2 sm:p-6 sm:pb-2">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Commandes par heure</h2>
              <p className="text-[13px] text-muted-foreground">
                {peak && peak.orders > 0 ? <>Pic à <span className="font-mono">{peak.hour}h</span> avec {peak.orders} commande{peak.orders > 1 ? "s" : ""}</> : "Aucune commande sur cette journée"}
              </p>
            </div>
          </div>
          <div className="h-[220px] px-2 pb-4 sm:px-4" role="img" aria-label={`Commandes par heure : ${hours.filter((h) => h.orders).map((h) => `${h.label} ${h.orders}`).join(", ") || "aucune"}`}>
            {q.isLoading ? <Skeleton className="mx-4 h-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hours} margin={{ top: 12, right: 8, left: -12, bottom: 0 }} barCategoryGap="18%">
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" tick={{ fill: "var(--muted-foreground)", fontSize: 11, fontFamily: "var(--font-mono)" }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} tick={{ fill: "var(--muted-foreground)", fontSize: 11, fontFamily: "var(--font-mono)" }} />
                  <Tooltip cursor={{ fill: "var(--hover)" }} content={<HourTip />} />
                  <Bar dataKey="orders" fill="var(--brand-bg)" radius={[3, 3, 0, 0]} maxBarSize={28} animationDuration={400} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="flex flex-col lg:col-span-2">
          <div className="p-5 pb-3 sm:p-6 sm:pb-3">
            <h2 className="text-[15px] font-semibold tracking-tight">Encaissements par moyen</h2>
            <p className="text-[13px] text-muted-foreground">Total <span className="font-mono text-foreground">{formatFcfa(d?.revenue ?? 0)}</span></p>
          </div>
          <ul className="flex flex-col gap-3 px-5 pb-5 sm:px-6 sm:pb-6">
            {methods.map((m) => (
              <li key={m.method} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span>{m.label}</span>
                  <span className="font-mono tabular-nums">{q.isLoading ? "…" : formatFcfa(m.amount)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${(m.amount / maxMethod) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <div className="flex items-center justify-between gap-2 p-5 pb-3 sm:p-6 sm:pb-3">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Plats les plus vendus</h2>
              <p className="text-[13px] text-muted-foreground">Top 5 de la journée, en quantité.</p>
            </div>
            <Button asChild variant="ghost" size="sm"><Link to={to("/menu")}>Menu <ArrowRight /></Link></Button>
          </div>
          {q.isLoading ? (
            <div className="flex flex-col gap-3 px-6 pb-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : !d?.topItems.length ? (
            <EmptyState icon={<UtensilsCrossed />} title="Pas encore de ventes" description="Les plats commandés apparaîtront ici au fil du service." className="py-10" />
          ) : (
            <ol className="flex flex-col divide-y divide-border border-t border-border">
              {d.topItems.map((it, i) => (
                <li key={it.menuItemId} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                  <span className="w-5 font-mono text-xs text-faint tabular-nums">{i + 1}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-medium">{it.name}</span>
                      <span className="shrink-0 font-mono text-[13px] text-muted-foreground tabular-nums">{formatFcfa(it.revenue)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden><div className="h-full rounded-full bg-brand" style={{ width: `${(it.quantity / maxTop) * 100}%` }} /></div>
                  </div>
                  <span className="w-10 text-right font-mono text-sm font-semibold tabular-nums" aria-label={`${it.quantity} vendus`}>×{it.quantity}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <SetupCard className="lg:col-span-2" />
      </div>
    </>
  );
}

function HourTip({ active, payload }: { active?: boolean; payload?: { payload: { hour: number; orders: number } }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-mono font-medium">{p.hour}h – {p.hour + 1}h</p>
      <p className="text-muted-foreground"><span className="font-mono text-foreground">{p.orders}</span> commande{p.orders > 1 ? "s" : ""}</p>
    </div>
  );
}

/** Mise en route (identité légale, marque, 2FA) tant qu'elle n'est pas terminée. */
function SetupCard({ className }: { className?: string }) {
  const t = useTenant();
  const to = useSpacePath();
  const user = useUser();
  const settings = useQuery({ queryKey: t.key("settings", "all"), queryFn: t.api.settings.all });
  const b = settings.data?.business;
  const steps = [
    { done: !!(b?.taxId && b?.address?.city), label: "Informations légales", hint: "NIF et adresse sur vos tickets.", to: to("/parametres?onglet=informations"), icon: Store },
    { done: !!settings.data?.assets?.logo, label: "Logo et couleurs", hint: "Votre marque sur l'espace et la carte.", to: to("/parametres?onglet=marque"), icon: Palette },
    { done: user.twoFactorEnabled, label: "Double authentification", hint: "Protège votre compte.", to: to("/compte?onglet=securite"), icon: ShieldCheck },
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="flex items-center justify-between gap-2 p-5 pb-3 sm:p-6 sm:pb-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Mise en route</h2>
          <p className="text-[13px] text-muted-foreground">{done === steps.length ? "Tout est prêt." : `${done} sur ${steps.length} étapes terminées.`}</p>
        </div>
        <Button asChild variant="ghost" size="sm"><Link to={to(`/carte`)} target="_blank" rel="noreferrer">Carte publique <ArrowUpRight /></Link></Button>
      </div>
      <ul className="flex flex-col gap-2 px-5 pb-5 sm:px-6 sm:pb-6">
        {steps.map((s) => (
          <li key={s.label}>
            <Link to={s.to} className={cn("group flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 transition-colors hover:border-border-strong hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", s.done && "opacity-70")}>
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full border", s.done ? "border-transparent bg-[var(--tone-green-bg)] text-[var(--tone-green-fg)]" : "border-border bg-subtle text-muted-foreground")}>
                {s.done ? <Check className="size-4" /> : <s.icon className="size-4" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("text-sm font-medium", s.done && "line-through decoration-1")}>{s.label}</span>
                <span className="truncate text-xs text-muted-foreground">{s.hint}</span>
              </span>
              <ArrowRight className="size-4 text-faint group-hover:text-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
