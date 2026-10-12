import { zodResolver } from "@hookform/resolvers/zod";
import type { RecordPaymentResult, TenantDetail } from "@restaurant/api-client";
import { recordPaymentSchema, type RecordPaymentInput } from "@restaurant/validation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Banknote, CalendarClock, CircleCheck, CreditCard, Minus, Plus, Smartphone } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { applyApiErrors, errorMessage } from "@/lib/errors";
import { formatDate, formatFcfa, toDateInputValue } from "@/lib/format";
import { BILLING_CYCLE_LABEL, PAYMENT_METHOD_LABEL, SUBSCRIPTION_STATUS_LABEL } from "@/lib/labels";
import { papi, pk } from "../hooks";
import { TenantPicker } from "./tenant-picker";

/** Ajoute des mois en conservant la fin de mois — même règle que l'API (licensing.ts), pour l'aperçu. */
function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** Période qui sera couverte (aperçu) : à la suite de la licence en cours, ou à partir d'aujourd'hui si elle est échue. */
export function previewPeriod(tenant: TenantDetail | undefined, cycle: "MONTHLY" | "YEARLY", periods: number) {
  const now = new Date();
  const sub = tenant?.subscription;
  const reactivation = !sub || sub.status === "EXPIRED" || sub.status === "CANCELLED";
  const end = sub ? new Date(sub.currentPeriodEnd) : null;
  const start = !reactivation && end && end > now ? end : now;
  return { start, end: addMonths(start, (cycle === "YEARLY" ? 12 : 1) * periods), reactivation };
}

const METHOD_ICONS = { FLOOZ: <Smartphone />, TMONEY: <Smartphone />, CARD: <CreditCard />, CASH: <Banknote /> };

type FormValues = RecordPaymentInput;

export function RecordPaymentDialog({ open, onOpenChange, tenantId: presetTenant }: { open: boolean; onOpenChange: (o: boolean) => void; tenantId?: string }) {
  const qc = useQueryClient();
  const [step, setStep] = React.useState<"form" | "confirm" | "done">("form");
  const [result, setResult] = React.useState<RecordPaymentResult | null>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [amountTouched, setAmountTouched] = React.useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(recordPaymentSchema),
    mode: "onTouched",
    defaultValues: { tenantId: presetTenant ?? "", method: "FLOOZ", billingCycle: "MONTHLY", periods: 1, paidAt: toDateInputValue() as unknown as Date },
  });
  const { register, control, setValue, handleSubmit, formState: { errors } } = form;
  const [tenantId, method, cycle, periods, planId, amount, paidAt, reference] = useWatch({
    control, name: ["tenantId", "method", "billingCycle", "periods", "planId", "amount", "paidAt", "reference"],
  });

  React.useEffect(() => {
    if (!open) return;
    setStep("form"); setResult(null); setSubmitError(null); setAmountTouched(false);
    form.reset({ tenantId: presetTenant ?? "", method: "FLOOZ", billingCycle: "MONTHLY", periods: 1, paidAt: toDateInputValue() as unknown as Date, planId: undefined, amount: undefined, reference: undefined, notes: undefined });
  }, [open, presetTenant]); // eslint-disable-line react-hooks/exhaustive-deps

  const tenant = useQuery({ queryKey: pk.tenant(tenantId), queryFn: () => papi.tenants.get(tenantId), enabled: open && !!tenantId });
  const plans = useQuery({ queryKey: pk.plans, queryFn: papi.plans.list, enabled: open });

  const currentPlan = tenant.data?.subscription?.plan;
  const plan = plans.data?.find((p) => p.id === (planId || currentPlan?.id)) ?? currentPlan;
  const unit = plan ? (cycle === "YEARLY" ? plan.priceYearly : plan.priceMonthly) : 0;
  const computed = unit * (Number(periods) || 0);

  // Montant prérempli = prix du plan × périodes, tant que l'utilisateur ne l'a pas modifié.
  React.useEffect(() => {
    if (!amountTouched && computed > 0) setValue("amount", computed, { shouldValidate: false });
  }, [computed, amountTouched, setValue]);

  const period = previewPeriod(tenant.data, cycle, Number(periods) || 1);

  const toConfirm = handleSubmit(() => { setSubmitError(null); setStep("confirm"); });

  async function submit() {
    const v = form.getValues();
    setSubmitError(null);
    try {
      const body: RecordPaymentInput = {
        ...v,
        reference: v.reference?.trim() || undefined,
        notes: v.notes?.trim() || undefined,
        planId: v.planId || undefined,
        amount: v.amount ? Number(v.amount) : undefined,
        paidAt: v.paidAt ? new Date(`${String(v.paidAt)}T12:00:00`) : undefined,
      };
      const res = await papi.payments.record(body);
      setResult(res);
      setStep("done");
      toast.success("Paiement enregistré", { description: res.receiptNumber });
      void qc.invalidateQueries({ queryKey: pk.paymentsAll });
      void qc.invalidateQueries({ queryKey: pk.dashboard });
      void qc.invalidateQueries({ queryKey: pk.tenant(v.tenantId) });
      void qc.invalidateQueries({ queryKey: pk.tenantSubs(v.tenantId) });
      void qc.invalidateQueries({ queryKey: pk.tenantsAll });
    } catch (e) {
      if (applyApiErrors(e, form.setError)) setStep("form");
      setSubmitError(errorMessage(e));
    }
  }

  const footer =
    step === "form" ? (
      <>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
        <Button variant="primary" onClick={toConfirm} disabled={!tenantId}>Continuer <ArrowRight /></Button>
      </>
    ) : step === "confirm" ? (
      <>
        <Button variant="ghost" onClick={() => setStep("form")} disabled={form.formState.isSubmitting}>Modifier</Button>
        <Button variant="primary" onClick={() => form.handleSubmit(submit)()} loading={form.formState.isSubmitting}>Enregistrer le paiement</Button>
      </>
    ) : (
      <>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>Fermer</Button>
        {result && <Button asChild variant="primary"><Link to={`/admin/paiements/${result.id}`} onClick={() => onOpenChange(false)}>Voir le reçu</Link></Button>}
      </>
    );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      dismissable={step !== "confirm"}
      title={step === "done" ? "Paiement enregistré" : "Enregistrer un paiement"}
      description={step === "form" ? "Licence réglée en Flooz, TMoney, carte ou espèces. La période est prolongée automatiquement." : step === "confirm" ? "Vérifiez avant d'enregistrer : un reçu numéroté sera émis." : undefined}
      footer={footer}
    >
      <AnimatePresence mode="wait" initial={false}>
        {step === "form" && (
          <motion.form key="form" onSubmit={toConfirm} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.16 }} className="flex flex-col gap-5" noValidate>
            {!presetTenant && (
              <Field label="Restaurant" required error={errors.tenantId && "Choisissez un restaurant"}>
                <Controller control={control} name="tenantId" render={({ field }) => <TenantPicker value={field.value} onChange={field.onChange} />} />
              </Field>
            )}
            {tenantId && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-subtle px-4 py-3 text-[13px]">
                {tenant.isLoading ? <Skeleton className="h-4 w-2/3" /> : tenant.data ? (
                  <>
                    <span className="font-medium">{tenant.data.name}</span>
                    <StatusBadge status={tenant.data.subscription?.status} labels={SUBSCRIPTION_STATUS_LABEL} />
                    <span className="text-muted-foreground">Plan <span className="text-foreground">{currentPlan?.name ?? "—"}</span></span>
                    <span className="text-muted-foreground">Échéance <span className="font-mono text-foreground">{formatDate(tenant.data.subscription?.currentPeriodEnd)}</span></span>
                  </>
                ) : null}
              </div>
            )}

            <Field label="Moyen de paiement" required>
              <Controller control={control} name="method" render={({ field }) => (
                <Segmented
                  ariaLabel="Moyen de paiement"
                  value={field.value}
                  onChange={(v) => { field.onChange(v); form.clearErrors("reference"); }}
                  options={(["FLOOZ", "TMONEY", "CARD", "CASH"] as const).map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m], icon: METHOD_ICONS[m] }))}
                  className="sm:w-full"
                />
              )} />
            </Field>

            <AnimatePresence initial={false}>
              {method !== "CASH" && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.16 }} className="overflow-hidden">
                  <Field label="Référence de transaction" required error={errors.reference?.message} hint={method === "CARD" ? "Numéro d'autorisation du terminal" : `N° de transaction ${PAYMENT_METHOD_LABEL[method]}`}>
                    <Input className="font-mono" placeholder={method === "FLOOZ" ? "FL-778899" : method === "TMONEY" ? "TM-123456" : "AUTH-0042"} autoComplete="off" {...register("reference", { setValueAs: (v: string) => (v?.trim() ? v.trim() : undefined) })} />
                  </Field>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Cycle" required>
                <Controller control={control} name="billingCycle" render={({ field }) => (
                  <Segmented ariaLabel="Cycle de facturation" value={field.value} onChange={field.onChange} options={[{ value: "MONTHLY", label: "Mensuel" }, { value: "YEARLY", label: "Annuel" }]} className="sm:w-full" />
                )} />
              </Field>
              <Field label={cycle === "YEARLY" ? "Nombre d'années" : "Nombre de mois"} required error={errors.periods && "Entre 1 et 24"}>
                <Controller control={control} name="periods" render={({ field }) => (
                  <div className="flex items-center gap-2">
                    <Button type="button" size="icon" variant="secondary" aria-label="Diminuer" onClick={() => field.onChange(Math.max(1, (Number(field.value) || 1) - 1))}><Minus /></Button>
                    <Input type="number" inputMode="numeric" min={1} max={24} className="text-center font-mono" value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
                    <Button type="button" size="icon" variant="secondary" aria-label="Augmenter" onClick={() => field.onChange(Math.min(24, (Number(field.value) || 0) + 1))}><Plus /></Button>
                  </div>
                )} />
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Plan" hint="Changer de plan à l'occasion du paiement (facultatif)">
                <NativeSelect {...register("planId", { setValueAs: (v: string) => v || undefined })}>
                  <option value="">{currentPlan ? `Plan actuel — ${currentPlan.name}` : "Plan actuel"}</option>
                  {plans.data?.filter((p) => p.isActive && p.id !== currentPlan?.id).map((p) => (
                    <option key={p.id} value={p.id}>{p.name} — {formatFcfa(cycle === "YEARLY" ? p.priceYearly : p.priceMonthly)}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Date du paiement" error={errors.paidAt && "Date invalide"}>
                <Input type="date" max={toDateInputValue()} {...register("paidAt")} />
              </Field>
            </div>

            <Field
              label="Montant encaissé"
              required
              error={errors.amount && "Montant entier positif"}
              hint={plan ? <>Calcul : {formatFcfa(unit)} × {periods || 0} = <span className="font-mono">{formatFcfa(computed)}</span>{amountTouched && amount !== computed && <> · <button type="button" className="font-medium text-brand-ink hover:underline" onClick={() => { setAmountTouched(false); setValue("amount", computed); }}>Recalculer</button></>}</> : undefined}
            >
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                className="font-mono"
                trailing={<span className="pr-2 text-xs font-medium text-muted-foreground">FCFA</span>}
                {...register("amount", { setValueAs: (v: string) => (v === "" || v == null ? undefined : Number(v)), onChange: () => setAmountTouched(true) })}
              />
            </Field>

            <Field label="Note interne" hint="Facultatif · 300 caractères max.">
              <Textarea rows={2} maxLength={300} {...register("notes", { setValueAs: (v: string) => (v?.trim() ? v : undefined) })} />
            </Field>
            {submitError && <Callout tone="danger">{submitError}</Callout>}
          </motion.form>
        )}

        {step === "confirm" && (
          <motion.div key="confirm" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.16 }} className="flex flex-col gap-5">
            <div className="rounded-lg border border-border">
              <div className="flex flex-col items-center gap-1 border-b border-border px-5 py-6 text-center">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Montant</span>
                <span className="font-mono text-3xl font-semibold tracking-tight tabular">{formatFcfa(Number(amount) || computed)}</span>
                <span className="text-sm text-muted-foreground">{tenant.data?.name}</span>
              </div>
              <dl className="divide-y divide-border text-sm">
                {[
                  ["Moyen", PAYMENT_METHOD_LABEL[method]],
                  ...(reference ? [["Référence", <span className="font-mono" key="r">{reference}</span>]] : []),
                  ["Formule", `${periods} × ${BILLING_CYCLE_LABEL[cycle]?.toLowerCase()} · ${plan?.name ?? "—"}${planId ? " (nouveau plan)" : ""}`],
                  ["Payé le", formatDate(paidAt ? new Date(`${String(paidAt)}T12:00:00`) : new Date())],
                ].map(([k, v], i) => (
                  <div key={i} className="flex items-center justify-between gap-4 px-5 py-3">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="text-right font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-border bg-brand-tint px-4 py-3">
              <CalendarClock className="mt-0.5 size-4 shrink-0 text-brand-ink" />
              <div className="text-sm">
                <p className="font-medium">Nouvelle période : <span className="font-mono">{formatDate(period.start)} → {formatDate(period.end)}</span></p>
                <p className="text-muted-foreground">
                  {period.reactivation ? "La licence échue est remplacée par une nouvelle licence qui démarre aujourd'hui." : "La période s'ajoute à la fin de la licence en cours : aucun jour perdu."}
                  {tenant.data?.status === "SUSPENDED" && !period.reactivation && " Le restaurant est suspendu manuellement : le paiement ne lève pas la suspension."}
                </p>
              </div>
            </div>
            {submitError && <Callout tone="danger">{submitError}</Callout>}
          </motion.div>
        )}

        {step === "done" && result && (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2 }} className="flex flex-col items-center gap-4 py-4 text-center">
            <motion.span initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 25 }} className="flex size-14 items-center justify-center rounded-full bg-[var(--tone-green-bg)] text-[var(--tone-green-fg)]">
              <CircleCheck className="size-7" />
            </motion.span>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Reçu</span>
              <span className="flex items-center justify-center gap-1 font-mono text-lg font-semibold">{result.receiptNumber}<CopyButton value={result.receiptNumber} /></span>
            </div>
            <p className="text-sm text-muted-foreground">
              {formatFcfa(result.amount)} · licence valable jusqu'au <span className="font-mono text-foreground">{formatDate(result.periodEnd)}</span>
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </Dialog>
  );
}
