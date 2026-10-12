import { zodResolver } from "@hookform/resolvers/zod";
import type { Payment, SubscriptionWithPayments, TenantDetail } from "@restaurant/api-client";
import { updateTenantSchema } from "@restaurant/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Ban, CalendarClock, ExternalLink, FileText, MoreHorizontal, Pencil, PlayCircle, Receipt, RefreshCw, Users, WalletCards,
} from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import type { z } from "zod";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DescriptionList } from "@/components/ui/page-header";
import { ProgressRing } from "@/components/ui/progress-ring";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { applyApiErrors, errorMessage, toastError } from "@/lib/errors";
import { daysUntil, formatDate, formatDateTime, formatFcfa } from "@/lib/format";
import { BILLING_CYCLE_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL, SUBSCRIPTION_STATUS_LABEL, TENANT_ROLE_LABEL, TENANT_STATUS_LABEL } from "@/lib/labels";
import { useUrlParam } from "@/lib/use-url-state";
import { brandingKeys } from "@/providers/branding";
import { useSession } from "@/providers/session";
import { LoginEventsTable } from "../../security/login-events-table";
import { UsersSecurityTable } from "../../security/users-security-table";
import { BrandingEditor } from "../../settings/branding-editor";
import type { SettingsAdapter } from "../../settings/common";
import { BusinessForm, LocalizationForm, OperationsForm, SecurityPolicyForm } from "../../settings/forms";
import { papi, pk, useCanWrite } from "../hooks";
import { RecordPaymentDialog } from "../payments/record-payment-dialog";

export function TenantDetailPage() {
  const { id = "" } = useParams();
  const canWrite = useCanWrite();
  const superAdmin = useSession().user?.role === "SUPER_ADMIN";
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [tab, setTab] = useUrlParam("onglet", "apercu");
  const [payOpen, setPayOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const tenant = useQuery({ queryKey: pk.tenant(id), queryFn: () => papi.tenants.get(id) });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: pk.tenant(id) });
    void qc.invalidateQueries({ queryKey: pk.tenantsAll });
    void qc.invalidateQueries({ queryKey: pk.dashboard });
  };
  const suspend = useMutation({ mutationFn: () => papi.tenants.suspend(id), onSuccess: () => { toast.success("Restaurant suspendu"); refresh(); }, onError: (e) => toastError(e) });
  const reactivate = useMutation({ mutationFn: () => papi.tenants.reactivate(id), onSuccess: () => { toast.success("Restaurant réactivé"); refresh(); }, onError: (e) => toastError(e) });

  if (tenant.isLoading) return <DetailSkeleton />;
  if (tenant.isError || !tenant.data) {
    return (
      <EmptyState icon={<FileText />} title="Restaurant introuvable" description={errorMessage(tenant.error)}
        action={<Button asChild variant="secondary"><Link to="/admin/restaurants"><ArrowLeft /> Retour aux restaurants</Link></Button>} className="py-24" />
    );
  }
  const t = tenant.data;
  const suspended = t.status === "SUSPENDED";

  return (
    <>
      <nav aria-label="Fil d'Ariane" className="mb-4 flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Link to="/admin/restaurants" className="inline-flex min-h-11 items-center gap-1 hover:text-foreground sm:min-h-0"><ArrowLeft className="size-3.5" /> Restaurants</Link>
        <span aria-hidden>/</span>
        <span className="truncate text-foreground">{t.name}</span>
      </nav>

      <div className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border bg-subtle text-lg font-semibold">{t.name[0]?.toUpperCase()}</span>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-[-0.02em]">{t.name}</h1>
              <StatusBadge status={t.status} labels={TENANT_STATUS_LABEL} />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
              <span className="inline-flex items-center font-mono">{t.slug}<CopyButton value={t.slug} className="size-8 sm:size-7" /></span>
              <a href={`/r/${t.slug}/login`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">Ouvrir l'espace <ExternalLink className="size-3" /></a>
            </div>
          </div>
        </div>
        {canWrite && (
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="primary" onClick={() => setPayOpen(true)}><Receipt /> Enregistrer un paiement</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="secondary" size="icon" aria-label="Plus d'actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => setEditOpen(true)}><Pencil /> Modifier les coordonnées</DropdownMenuItem>
                {suspended ? (
                  <DropdownMenuItem onSelect={() => confirm({
                    title: `Réactiver ${t.name} ?`, tone: "primary", confirmLabel: "Réactiver",
                    description: "Lève la suspension manuelle. Refusé si la licence est expirée : enregistrez alors un paiement.",
                    onConfirm: () => reactivate.mutateAsync(),
                  })}><PlayCircle /> Réactiver</DropdownMenuItem>
                ) : t.status !== "CANCELLED" && (
                  <DropdownMenuItem destructive onSelect={() => confirm({
                    title: `Suspendre ${t.name} ?`, confirmLabel: "Suspendre le restaurant", typeToConfirm: t.slug,
                    description: "Tous ses utilisateurs perdent l'accès immédiatement. Un paiement ne lèvera pas cette suspension manuelle.",
                    onConfirm: () => suspend.mutateAsync(),
                  })}><Ban /> Suspendre</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="apercu">Aperçu</TabsTrigger>
          <TabsTrigger value="licences" count={t.paymentsCount}>Licences et paiements</TabsTrigger>
          {superAdmin && <TabsTrigger value="parametres">Paramètres</TabsTrigger>}
          {superAdmin && <TabsTrigger value="securite" count={t.usersCount}>Sécurité</TabsTrigger>}
          {superAdmin && <TabsTrigger value="connexions">Connexions</TabsTrigger>}
        </TabsList>
        <TabsContent value="apercu"><Overview t={t} onPay={canWrite ? () => setPayOpen(true) : undefined} /></TabsContent>
        <TabsContent value="licences"><Subscriptions tenantId={id} canWrite={canWrite} onPay={() => setPayOpen(true)} /></TabsContent>
        {superAdmin && <TabsContent value="parametres"><TenantSettingsSupport t={t} /></TabsContent>}
        {superAdmin && <TabsContent value="securite"><TenantUsers tenantId={id} /></TabsContent>}
        {superAdmin && <TabsContent value="connexions"><TenantEvents tenantId={id} /></TabsContent>}
      </Tabs>

      {canWrite && <RecordPaymentDialog open={payOpen} onOpenChange={setPayOpen} tenantId={id} />}
      {canWrite && <EditTenantDialog t={t} open={editOpen} onOpenChange={setEditOpen} onSaved={refresh} />}
    </>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <Skeleton className="h-4 w-40" />
      <div className="flex items-center gap-4"><Skeleton className="size-12 rounded-lg" /><div className="flex flex-col gap-2"><Skeleton className="h-7 w-56" /><Skeleton className="h-4 w-32" /></div></div>
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-6 lg:grid-cols-3"><Skeleton className="h-64 lg:col-span-2" /><Skeleton className="h-64" /></div>
    </div>
  );
}

function Overview({ t, onPay }: { t: TenantDetail; onPay?: () => void }) {
  const s = t.subscription;
  const days = daysUntil(s?.currentPeriodEnd) ?? 0;
  const total = s ? Math.max(1, Math.round((new Date(s.currentPeriodEnd).getTime() - new Date(s.startsAt).getTime()) / 86_400_000)) : 1;
  const ratio = Math.max(0, Math.min(1, days / total));
  const tone = s?.status === "GRACE" || days <= 7 ? (days < 0 || s?.status === "EXPIRED" ? "red" : "amber") : "brand";
  return (
    <div className="grid items-start gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Licence</CardTitle></CardHeader>
        <CardContent>
          {!s ? <EmptyState icon={<WalletCards />} title="Aucune licence" description="Enregistrez un paiement pour en créer une." /> : (
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
              <ProgressRing value={ratio} size={128} tone={tone}>
                <span className="font-mono text-2xl font-semibold tabular">{Math.max(0, days)}</span>
                <span className="text-[11px] text-muted-foreground">jour{Math.abs(days) > 1 ? "s" : ""} restant{Math.abs(days) > 1 ? "s" : ""}</span>
              </ProgressRing>
              <DescriptionList className="flex-1" items={[
                { label: "Statut", value: <StatusBadge status={s.status} labels={SUBSCRIPTION_STATUS_LABEL} /> },
                { label: "Plan", value: <span className="font-medium">{s.plan.name} <span className="font-mono text-xs text-muted-foreground">{formatFcfa(s.plan.priceMonthly)}/mois</span></span> },
                { label: "Fin de période", value: <span className="font-mono">{formatDate(s.currentPeriodEnd)}</span> },
                { label: "Cycle", value: BILLING_CYCLE_LABEL[s.billingCycle] },
                ...(s.trialEndsAt ? [{ label: "Fin de l'essai", value: <span className="font-mono">{formatDate(s.trialEndsAt)}</span> }] : []),
                ...(s.graceEndsAt ? [{ label: "Fin de la grâce", value: <span className="font-mono text-warning">{formatDate(s.graceEndsAt)}</span> }] : []),
              ]} />
            </div>
          )}
          {onPay && s && (s.status === "GRACE" || days <= 7) && (
            <div className="mt-6 flex flex-col gap-3 rounded-lg border border-border bg-subtle p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-sm"><CalendarClock className="size-4 text-warning" /> {s.status === "GRACE" ? "Licence en période de grâce." : "Licence bientôt échue."}</p>
              <Button size="sm" variant="primary" onClick={onPay}>Enregistrer un paiement</Button>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Coordonnées</CardTitle></CardHeader>
        <CardContent>
          <DescriptionList className="sm:grid-cols-1" items={[
            { label: "Email", value: t.email },
            { label: "Téléphone", value: t.phone ?? "—" },
            { label: "Adresse", value: t.address ?? "—" },
            { label: "Fuseau · langue", value: <span className="font-mono text-xs">{t.timezone} · {t.locale}</span> },
            { label: "Utilisateurs · paiements", value: <span className="font-mono">{t.usersCount} · {t.paymentsCount}</span> },
            { label: "Créé le", value: <span className="font-mono">{formatDate(t.createdAt)}</span> },
          ]} />
        </CardContent>
      </Card>
    </div>
  );
}

function Subscriptions({ tenantId, canWrite, onPay }: { tenantId: string; canWrite: boolean; onPay: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const subs = useQuery({ queryKey: pk.tenantSubs(tenantId), queryFn: () => papi.tenants.subscriptions(tenantId) });
  const voidPay = useMutation({
    mutationFn: ({ p, reason }: { p: Payment; reason: string }) => papi.payments.void(p.id, reason),
    onSuccess: (_r, { p }) => {
      toast.success("Paiement annulé", { description: `${p.receiptNumber} — période restituée.` });
      void qc.invalidateQueries({ queryKey: pk.tenantSubs(tenantId) });
      void qc.invalidateQueries({ queryKey: pk.tenant(tenantId) });
      void qc.invalidateQueries({ queryKey: pk.paymentsAll });
      void qc.invalidateQueries({ queryKey: pk.dashboard });
    },
    onError: (e) => toastError(e),
  });

  if (subs.isLoading) return <div className="flex flex-col gap-4"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>;
  if (subs.isError) return <div className="flex flex-col items-center gap-3 py-10"><p className="text-sm">{errorMessage(subs.error)}</p><Button size="sm" variant="secondary" onClick={() => subs.refetch()}><RefreshCw /> Réessayer</Button></div>;
  if (!subs.data?.length) return <EmptyState icon={<WalletCards />} title="Aucune licence" action={canWrite ? <Button variant="primary" onClick={onPay}>Enregistrer un paiement</Button> : undefined} />;

  return (
    <div className="flex flex-col gap-4">
      {subs.data.map((s: SubscriptionWithPayments) => {
        const lastRecorded = [...s.payments].filter((p) => p.status === "RECORDED").sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
        return (
          <Card key={s.id}>
            <div className="flex flex-col gap-2 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{s.plan.name}</span>
                <StatusBadge status={s.status} labels={SUBSCRIPTION_STATUS_LABEL} />
                <Badge tone="outline">{BILLING_CYCLE_LABEL[s.billingCycle]}</Badge>
              </div>
              <span className="font-mono text-xs text-muted-foreground">{formatDate(s.startsAt)} → {formatDate(s.currentPeriodEnd)}</span>
            </div>
            {s.payments.length === 0 ? (
              <p className="px-6 py-5 text-sm text-muted-foreground">{s.trialEndsAt ? `Essai gratuit jusqu'au ${formatDate(s.trialEndsAt)} — aucun paiement.` : "Aucun paiement sur cette licence."}</p>
            ) : (
              <ul className="divide-y divide-border">
                {s.payments.map((p) => (
                  <li key={p.id} className={cn("flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-6", p.status === "VOIDED" && "opacity-60")}>
                    <Link to={`/admin/paiements/${p.id}`} className="font-mono text-sm font-medium hover:underline">{p.receiptNumber}</Link>
                    <span className="text-[13px] text-muted-foreground sm:w-44">{formatDateTime(p.paidAt)}</span>
                    <span className="text-[13px] sm:w-20">{PAYMENT_METHOD_LABEL[p.method]}</span>
                    <span className="font-mono text-xs text-muted-foreground sm:flex-1">{formatDate(p.periodStart)} → {formatDate(p.periodEnd)}</span>
                    <StatusBadge status={p.status} labels={PAYMENT_STATUS_LABEL} />
                    <span className={cn("font-mono text-sm font-medium tabular sm:w-32 sm:text-right", p.status === "VOIDED" && "line-through")}>{formatFcfa(p.amount)}</span>
                    {canWrite && lastRecorded?.id === p.id ? (
                      <Button size="sm" variant="danger-ghost" onClick={() => confirm({
                        title: `Annuler le paiement ${p.receiptNumber} ?`,
                        description: `La période ${formatDate(p.periodStart)} → ${formatDate(p.periodEnd)} sera restituée et le reçu marqué « annulé ». Seul le dernier paiement d'une licence peut être annulé.`,
                        confirmLabel: "Annuler le paiement",
                        reason: { label: "Motif de l'annulation", placeholder: "Erreur de saisie : montant incorrect…" },
                        onConfirm: (reason) => voidPay.mutateAsync({ p, reason: reason! }),
                      })}>Annuler</Button>
                    ) : canWrite ? <span className="hidden w-[72px] sm:block" /> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}

const SECTIONS = [
  { v: "business", l: "Informations" }, { v: "branding", l: "Marque" }, { v: "operations", l: "Exploitation" },
  { v: "localization", l: "Localisation" }, { v: "security", l: "Sécurité" },
] as const;

/** Vue support : réglages du restaurant, modifiables par le SuperAdmin. */
function TenantSettingsSupport({ t }: { t: TenantDetail }) {
  const qc = useQueryClient();
  const [section, setSection] = useUrlParam("section", "business");
  const adapter = React.useMemo<SettingsAdapter>(() => ({
    key: pk.tenantSettings(t.id),
    get: (s) => papi.tenants.getSection(t.id, s as never),
    update: (s, body) => papi.tenants.updateSection(t.id, s as never, body as never),
    uploadAsset: (k, f) => papi.tenants.uploadAsset(t.id, k, f),
    removeAsset: (k) => papi.tenants.removeAsset(t.id, k),
    canWrite: true,
    onSaved: (s) => {
      if (s === "branding") void qc.invalidateQueries({ queryKey: brandingKeys.tenant(t.slug) });
      if (s === "business" || s === "localization") void qc.invalidateQueries({ queryKey: pk.tenant(t.id) });
    },
  }), [t.id, t.slug, qc]);
  return (
    <div className="flex flex-col gap-5">
      <div className="-mx-4 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0">
        <Segmented ariaLabel="Section" size="sm" value={section as (typeof SECTIONS)[number]["v"]} onChange={setSection} className="w-auto min-w-max" options={SECTIONS.map((s) => ({ value: s.v, label: s.l }))} />
      </div>
      <p className="text-[13px] text-muted-foreground">Vous intervenez sur les réglages de <span className="font-medium text-foreground">{t.name}</span> ; chaque modification est journalisée.</p>
      {section === "business" && <BusinessForm adapter={adapter} />}
      {section === "branding" && <BrandingEditor adapter={adapter} contextLabel={t.name} />}
      {section === "operations" && <OperationsForm adapter={adapter} />}
      {section === "localization" && <LocalizationForm adapter={adapter} />}
      {section === "security" && <SecurityPolicyForm adapter={adapter} space="tenant" />}
    </div>
  );
}

function TenantUsers({ tenantId }: { tenantId: string }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><Users className="size-4" /> La création des comptes du personnel arrive avec le module Personnel. Vous pouvez déjà intervenir sur leur sécurité.</p>
      <UsersSecurityTable adapter={{
        key: pk.tenantUsers(tenantId),
        list: () => papi.tenants.users(tenantId),
        action: (uid, a) => papi.tenants.userAction(tenantId, uid, a),
        canWrite: true,
        roleLabels: TENANT_ROLE_LABEL,
      }} />
    </div>
  );
}

function TenantEvents({ tenantId }: { tenantId: string }) {
  const q = useQuery({ queryKey: pk.tenantEvents(tenantId), queryFn: () => papi.tenants.loginEvents(tenantId, { limit: 100 }) });
  return <LoginEventsTable rows={q.data} loading={q.isLoading} />;
}

type EditValues = z.infer<typeof updateTenantSchema>;
function EditTenantDialog({ t, open, onOpenChange, onSaved }: { t: TenantDetail; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const form = useForm<EditValues>({ resolver: zodResolver(updateTenantSchema) });
  React.useEffect(() => { if (open) form.reset({ name: t.name, email: t.email, phone: t.phone ?? undefined, address: t.address ?? undefined }); }, [open, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: (v: EditValues) => papi.tenants.update(t.id, v),
    onSuccess: () => { toast.success("Coordonnées mises à jour"); onSaved(); onOpenChange(false); },
    onError: (e) => { if (!applyApiErrors(e, form.setError)) toastError(e); },
  });
  const submit = form.handleSubmit((v) => save.mutate(v));
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Modifier les coordonnées" description="Nom, email, téléphone et adresse affichés dans les listes de la plateforme."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Enregistrer</Button></>}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Nom" error={e.name && "2 à 80 caractères"}><Input {...form.register("name")} /></Field>
        <Field label="Email" error={e.email && "Adresse email invalide"}><Input type="email" {...form.register("email")} /></Field>
        <Field label="Téléphone" error={e.phone && "6 à 20 caractères"}><Input type="tel" {...form.register("phone", { setValueAs: (v: string) => v || undefined })} /></Field>
        <Field label="Adresse" error={e.address && "200 caractères maximum"}><Input {...form.register("address", { setValueAs: (v: string) => v || undefined })} /></Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
