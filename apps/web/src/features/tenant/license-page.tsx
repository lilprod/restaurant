import { useQuery } from "@tanstack/react-query";
import { Banknote, Building2, Globe, Mail, Phone, Receipt, RefreshCw, Smartphone, WalletCards } from "lucide-react";
import { Navigate } from "react-router-dom";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CopyField } from "@/components/ui/copy-button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { DescriptionList, PageHeader } from "@/components/ui/page-header";
import { ProgressRing } from "@/components/ui/progress-ring";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/errors";
import { daysUntil, formatDate, formatFcfa } from "@/lib/format";
import { BILLING_CYCLE_LABEL, FEATURE_LABEL, PAYMENT_METHOD_LABEL, SUBSCRIPTION_STATUS_LABEL } from "@/lib/labels";
import { useBranding } from "@/providers/branding";
import { useSpacePath } from "@/providers/space";
import { useTenant } from "./hooks";

export function TenantLicensePage() {
  const t = useTenant();
  const to = useSpacePath();
  const { branding } = useBranding();
  const q = useQuery({ queryKey: t.key("license"), queryFn: t.api.license, enabled: t.canSeeLicense });
  if (!t.canSeeLicense) return <Navigate to={to("/")} replace />;

  if (q.isLoading) return <div className="flex flex-col gap-6"><Skeleton className="h-8 w-40" /><div className="grid gap-6 lg:grid-cols-3"><Skeleton className="h-64 lg:col-span-2" /><Skeleton className="h-64" /></div></div>;
  if (q.isError || !q.data) return <EmptyState icon={<WalletCards />} title="Licence indisponible" description={errorMessage(q.error)} action={<Button variant="secondary" onClick={() => q.refetch()}><RefreshCw /> Réessayer</Button>} />;

  const l = q.data;
  const grace = l.status === "GRACE";
  const cycleDays = grace ? 7 : l.billingCycle === "YEARLY" ? 365 : l.status === "TRIALING" ? 14 : 30;
  // En période de grâce, l'échéance est passée : on compte les jours avant la suspension.
  const days = grace ? daysUntil(l.graceEndsAt) ?? 0 : l.daysLeft ?? 0;
  const tone = l.status === "EXPIRED" ? "red" : grace || days <= 7 ? "amber" : "brand";
  const h = l.howToPay;
  const s = l.support;
  const features = Object.entries(l.plan?.features ?? {}).filter(([, on]) => on).map(([k]) => FEATURE_LABEL[k] ?? k);
  const reference = branding?.displayName ?? t.slug;

  return (
    <>
      <PageHeader title="Licence" description="Votre plan, son échéance et comment le renouveler." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardContent className="flex flex-col gap-6 sm:flex-row sm:items-center">
              <ProgressRing value={Math.max(0, Math.min(1, days / cycleDays))} size={140} stroke={10} tone={tone}>
                <span className="font-mono text-3xl font-semibold tabular">{Math.max(0, days)}</span>
                <span className="text-xs text-muted-foreground">{grace ? "jours de grâce" : `jour${days > 1 ? "s" : ""} restant${days > 1 ? "s" : ""}`}</span>
              </ProgressRing>
              <div className="flex flex-1 flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xl font-semibold tracking-tight">Plan {l.plan?.name ?? "—"}</span>
                  <StatusBadge status={l.status} labels={SUBSCRIPTION_STATUS_LABEL} />
                </div>
                <DescriptionList items={[
                  { label: "Échéance", value: <span className="font-mono">{formatDate(l.currentPeriodEnd)}</span> },
                  { label: "Cycle", value: l.billingCycle ? BILLING_CYCLE_LABEL[l.billingCycle] : "—" },
                  { label: "Tarif", value: l.plan ? <span className="flex flex-col font-mono text-[13px]"><span>{formatFcfa(l.plan.priceMonthly)} / mois</span><span className="text-muted-foreground">{formatFcfa(l.plan.priceYearly)} / an</span></span> : "—" },
                  ...(l.graceEndsAt ? [{ label: "Fin de la période de grâce", value: <span className="font-mono text-warning">{formatDate(l.graceEndsAt)}</span> }] : []),
                  { label: "Limites", value: <>{l.plan?.maxUsers ?? "∞"} utilisateurs · {l.plan?.maxTables ?? "∞"} tables</> },
                ]} />
                {features.length > 0 && <p className="text-[13px] text-muted-foreground">Inclus : {features.join(" · ")}</p>}
              </div>
            </CardContent>
          </Card>

          <section className="flex flex-col gap-3">
            <h2 className="text-[17px] font-semibold tracking-tight">Historique des paiements</h2>
            <DataTable
              caption="Historique des paiements"
              rows={l.payments}
              rowKey={(p) => p.id}
              columns={[
                { key: "r", header: "Reçu", cell: (p) => <span className="font-mono text-[13px] font-medium">{p.receiptNumber}</span> },
                { key: "d", header: "Payé le", cell: (p) => <span className="font-mono text-xs text-muted-foreground">{formatDate(p.paidAt)}</span> },
                { key: "m", header: "Moyen", cell: (p) => PAYMENT_METHOD_LABEL[p.method] },
                { key: "p", header: "Période", hideOnMobile: true, cell: (p) => <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{formatDate(p.periodStart)} → {formatDate(p.periodEnd)}</span> },
                { key: "a", header: "Montant", align: "right", cell: (p) => <span className="font-mono font-medium tabular">{formatFcfa(p.amount)}</span> },
              ]}
              empty={<EmptyState icon={<Receipt />} title="Aucun paiement" description={l.status === "TRIALING" ? "Vous êtes en essai gratuit. Réglez votre licence avant l'échéance pour continuer sans interruption." : "Vos reçus apparaîtront ici."} />}
            />
          </section>
        </div>

        <Card className="h-fit lg:sticky lg:top-6">
          <CardHeader>
            <CardTitle>Comment payer</CardTitle>
            <CardDescription>Indiquez <span className="font-medium text-foreground">{reference}</span> en référence. La licence est prolongée dès réception.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {h.flooz?.number && <PayRow icon={<Smartphone className="size-4" />} title="Flooz" sub={h.flooz.holder} value={h.flooz.number} />}
            {h.tmoney?.number && <PayRow icon={<Smartphone className="size-4" />} title="TMoney" sub={h.tmoney.holder} value={h.tmoney.number} />}
            {h.bank?.accountNumber && <PayRow icon={<Building2 className="size-4" />} title={h.bank.bankName ?? "Virement bancaire"} sub={h.bank.accountHolder} value={h.bank.accountNumber} />}
            {h.cashNote && (
              <div className="flex gap-3">
                <span className="mt-0.5 text-muted-foreground"><Banknote className="size-4" /></span>
                <div className="flex flex-col gap-0.5"><span className="text-sm font-medium">Espèces</span><span className="text-[13px] text-muted-foreground">{h.cashNote}</span></div>
              </div>
            )}
            {h.instructions && <p className="rounded-lg border border-border bg-subtle p-3 text-[13px] text-muted-foreground">{h.instructions}</p>}
            {!h.flooz?.number && !h.tmoney?.number && !h.bank?.accountNumber && !h.cashNote && (
              <p className="text-sm text-muted-foreground">Les coordonnées de paiement n'ont pas encore été publiées. Contactez le support.</p>
            )}
            {(s.email || s.phone || s.website) && (
              <div className="flex flex-col gap-2 border-t border-border pt-4">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Support</span>
                {s.phone && <a href={`tel:${s.phone}`} className="flex min-h-11 items-center gap-2 text-sm hover:underline sm:min-h-0"><Phone className="size-4 text-muted-foreground" /> <span className="font-mono">{s.phone}</span></a>}
                {s.email && <a href={`mailto:${s.email}`} className="flex min-h-11 items-center gap-2 text-sm hover:underline sm:min-h-0"><Mail className="size-4 text-muted-foreground" /> {s.email}</a>}
                {s.website && <a href={s.website} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-2 text-sm hover:underline sm:min-h-0"><Globe className="size-4 text-muted-foreground" /> {s.website.replace(/^https?:\/\//, "")}</a>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function PayRow({ icon, title, sub, value }: { icon: React.ReactNode; title: string; sub?: string; value: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-sm font-medium">{title}</span>
        {sub && <span className="truncate text-xs text-muted-foreground">· {sub}</span>}
      </div>
      <CopyField value={value} />
    </div>
  );
}
