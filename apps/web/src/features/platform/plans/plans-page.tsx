import { zodResolver } from "@hookform/resolvers/zod";
import type { Plan } from "@restaurant/api-client";
import { planInputSchema, type PlanInput } from "@restaurant/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Layers, Pencil, Plus, RefreshCw, Users, LayoutGrid, Clock } from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Eyebrow } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch, SwitchRow } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { applyApiErrors, errorMessage, toastError } from "@/lib/errors";
import { formatFcfa } from "@/lib/format";
import { FEATURE_LABEL, KNOWN_FEATURES } from "@/lib/labels";
import { papi, pk, READ_ONLY_HINT, useCanWrite } from "../hooks";

export function PlansPage() {
  const canWrite = useCanWrite();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const plans = useQuery({ queryKey: pk.plans, queryFn: papi.plans.list });
  const [editing, setEditing] = React.useState<Plan | null>(null);
  const createOpen = params.get("nouveau") === "1";
  const setCreateOpen = (o: boolean) => setParams((p) => { const n = new URLSearchParams(p); if (o) n.set("nouveau", "1"); else n.delete("nouveau"); return n; }, { replace: true });

  const toggle = useMutation({
    mutationFn: ({ p, isActive }: { p: Plan; isActive: boolean }) => papi.plans.update(p.id, { isActive }),
    onMutate: async ({ p, isActive }) => {
      await qc.cancelQueries({ queryKey: pk.plans });
      const prev = qc.getQueryData<Plan[]>(pk.plans);
      qc.setQueryData<Plan[]>(pk.plans, (rows) => rows?.map((r) => (r.id === p.id ? { ...r, isActive } : r)));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(pk.plans, ctx.prev); toastError(e); },
    onSuccess: (p) => toast.success(p.isActive ? `${p.name} est proposé à l'inscription` : `${p.name} est désactivé`, { description: p.isActive ? undefined : "Les licences existantes ne changent pas." }),
    onSettled: () => void qc.invalidateQueries({ queryKey: pk.plans }),
  });

  return (
    <>
      <PageHeader
        title="Plans"
        description="Offres proposées aux restaurants. Un plan n'est jamais supprimé : désactivez-le pour le retirer de l'inscription."
        actions={canWrite ? <Button variant="primary" onClick={() => setCreateOpen(true)}><Plus /> Créer un plan</Button>
          : <Tooltip content={READ_ONLY_HINT}><span><Button variant="primary" disabled><Plus /> Créer un plan</Button></span></Tooltip>}
      />
      {plans.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-72" />)}</div>
      ) : plans.isError ? (
        <div className="flex flex-col items-center gap-3 py-10"><p className="text-sm">{errorMessage(plans.error)}</p><Button size="sm" variant="secondary" onClick={() => plans.refetch()}><RefreshCw /> Réessayer</Button></div>
      ) : !plans.data?.length ? (
        <EmptyState icon={<Layers />} title="Aucun plan" description="Créez au moins un plan pour pouvoir valider des inscriptions." action={canWrite ? <Button variant="primary" onClick={() => setCreateOpen(true)}><Plus /> Créer un plan</Button> : undefined} />
      ) : (
        <motion.div layout className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.data.map((p, i) => {
            const features = Object.entries(p.features ?? {});
            const discount = p.priceMonthly > 0 ? Math.round((1 - p.priceYearly / (p.priceMonthly * 12)) * 100) : 0;
            return (
              <motion.div key={p.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.04 } }}>
                <Card className={cn("flex h-full flex-col transition-opacity", !p.isActive && "opacity-70")}>
                  <div className="flex items-start justify-between gap-3 p-5">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[17px] font-semibold tracking-tight">{p.name}</span>
                        <Badge tone={p.isActive ? "green" : "gray"} dot>{p.isActive ? "Actif" : "Désactivé"}</Badge>
                      </div>
                      <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                    </div>
                    {canWrite && (
                      <Switch checked={p.isActive} onCheckedChange={(v) => toggle.mutate({ p, isActive: v })} aria-label={p.isActive ? `Désactiver ${p.name}` : `Activer ${p.name}`} />
                    )}
                  </div>
                  <div className="flex items-baseline gap-1.5 px-5">
                    <span className="font-mono text-[26px] font-semibold tracking-tight tabular">{formatFcfa(p.priceMonthly)}</span>
                    <span className="text-sm text-muted-foreground">/ mois</span>
                  </div>
                  <p className="px-5 pt-1 text-[13px] text-muted-foreground">
                    ou <span className="font-mono text-foreground">{formatFcfa(p.priceYearly)}</span> / an{discount > 0 && <Badge tone="green" className="ml-2 h-5">−{discount} %</Badge>}
                  </p>
                  {p.description && <p className="px-5 pt-3 text-sm text-muted-foreground">{p.description}</p>}
                  <ul className="flex flex-col gap-2 px-5 py-4 text-[13px]">
                    <li className="flex items-center gap-2 text-muted-foreground"><Clock className="size-4" /> {p.trialDays > 0 ? `${p.trialDays} jours d'essai` : "Sans essai"}</li>
                    <li className="flex items-center gap-2 text-muted-foreground"><Users className="size-4" /> {p.maxUsers ? `${p.maxUsers} utilisateurs` : "Utilisateurs illimités"}</li>
                    <li className="flex items-center gap-2 text-muted-foreground"><LayoutGrid className="size-4" /> {p.maxTables ? `${p.maxTables} tables` : "Tables illimitées"}</li>
                  </ul>
                  <div className="flex flex-wrap gap-1.5 px-5 pb-5">
                    {features.map(([k, on]) => (
                      <Badge key={k} tone={on ? "brand" : "outline"} className={cn(!on && "line-through decoration-1")}>{on && <Check className="size-3" />}{FEATURE_LABEL[k] ?? k}</Badge>
                    ))}
                  </div>
                  {canWrite && (
                    <div className="mt-auto flex justify-end border-t border-border bg-subtle px-5 py-3 rounded-b-lg">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(p)}><Pencil /> Modifier</Button>
                    </div>
                  )}
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      )}
      {canWrite && <PlanDialog open={createOpen || !!editing} plan={editing} onClose={() => { setEditing(null); setCreateOpen(false); }} />}
    </>
  );
}

type Values = PlanInput;

function PlanDialog({ open, plan, onClose }: { open: boolean; plan: Plan | null; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(planInputSchema) });
  const { register, control, formState: { errors } } = form;
  React.useEffect(() => {
    if (!open) return;
    form.reset(plan ? {
      code: plan.code, name: plan.name, description: plan.description ?? "", priceMonthly: plan.priceMonthly, priceYearly: plan.priceYearly,
      trialDays: plan.trialDays, maxUsers: plan.maxUsers, maxTables: plan.maxTables, features: plan.features ?? {}, isActive: plan.isActive, sortOrder: plan.sortOrder,
    } : {
      code: "", name: "", description: "", priceMonthly: 0, priceYearly: 0, trialDays: 14, maxUsers: null, maxTables: null,
      features: Object.fromEntries(KNOWN_FEATURES.map((f) => [f, f === "orders"])), isActive: true, sortOrder: 0,
    });
  }, [open, plan]); // eslint-disable-line react-hooks/exhaustive-deps

  const [monthly, features] = useWatch({ control, name: ["priceMonthly", "features"] });
  const featureKeys = Array.from(new Set([...KNOWN_FEATURES, ...Object.keys(features ?? {})]));

  const save = useMutation({
    mutationFn: (v: Values) => {
      const body = { ...v, description: v.description || undefined };
      return plan ? papi.plans.update(plan.id, body) : papi.plans.create(body);
    },
    onSuccess: (p) => { toast.success(plan ? "Plan mis à jour" : "Plan créé", { description: p.name }); void qc.invalidateQueries({ queryKey: pk.plans }); onClose(); },
    onError: (e) => { if (!applyApiErrors(e, form.setError)) toastError(e); },
  });
  const submit = form.handleSubmit((v) => save.mutate(v));
  const num = (v: string) => (v === "" ? 0 : Number(v));
  const nullable = (v: string) => (v === "" || v === null ? null : Number(v));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      size="lg"
      title={plan ? `Modifier ${plan.name}` : "Créer un plan"}
      description={plan ? "Les nouveaux tarifs s'appliquent aux prochains paiements." : "Prix en FCFA, sans centimes."}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" loading={save.isPending} onClick={submit}>{plan ? "Enregistrer" : "Créer le plan"}</Button></>}
    >
      <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom" required error={errors.name && "2 à 60 caractères"}><Input autoFocus {...register("name")} /></Field>
          <Field label="Code" required error={errors.code?.message ?? (errors.code && "2 à 30 caractères")} hint="Majuscules, chiffres et _">
            <Input className="font-mono uppercase" {...register("code", { setValueAs: (v: string) => v.toUpperCase() })} />
          </Field>
        </div>
        <Field label="Description" error={errors.description && "500 caractères maximum"}><Textarea rows={2} maxLength={500} {...register("description")} /></Field>

        <div className="flex flex-col gap-3">
          <Eyebrow>Tarifs</Eyebrow>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Prix mensuel" required error={errors.priceMonthly && "Entier positif ou nul"}>
              <Input type="number" inputMode="numeric" min={0} step={500} className="font-mono" trailing={<span className="pr-2 text-xs text-muted-foreground">FCFA</span>} {...register("priceMonthly", { setValueAs: num })} />
            </Field>
            <Field label="Prix annuel" required error={errors.priceYearly && "Entier positif ou nul"}
              hint={monthly ? <>Suggestion « 2 mois offerts » : <button type="button" className="font-mono font-medium text-brand-ink hover:underline" onClick={() => form.setValue("priceYearly", Number(monthly) * 10, { shouldDirty: true })}>{formatFcfa(Number(monthly) * 10)}</button></> : undefined}>
              <Input type="number" inputMode="numeric" min={0} step={500} className="font-mono" trailing={<span className="pr-2 text-xs text-muted-foreground">FCFA</span>} {...register("priceYearly", { setValueAs: num })} />
            </Field>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Eyebrow>Essai et limites</Eyebrow>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Jours d'essai" error={errors.trialDays && "0 à 90"} hint="0 = sans essai">
              <Input type="number" inputMode="numeric" min={0} max={90} className="font-mono" {...register("trialDays", { setValueAs: num })} />
            </Field>
            <Field label="Utilisateurs max." error={errors.maxUsers && "Entier positif"} hint="Vide = illimité">
              <Input type="number" inputMode="numeric" min={1} className="font-mono" placeholder="∞" {...register("maxUsers", { setValueAs: nullable })} />
            </Field>
            <Field label="Tables max." error={errors.maxTables && "Entier positif"} hint="Vide = illimité">
              <Input type="number" inputMode="numeric" min={1} className="font-mono" placeholder="∞" {...register("maxTables", { setValueAs: nullable })} />
            </Field>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Eyebrow>Modules inclus</Eyebrow>
          <Controller control={control} name="features" render={({ field }) => (
            <div className="grid divide-y divide-border sm:grid-cols-2 sm:gap-x-8 sm:divide-y-0">
              {featureKeys.map((k) => (
                <SwitchRow key={k} label={FEATURE_LABEL[k] ?? k} checked={!!field.value?.[k]} onCheckedChange={(v) => field.onChange({ ...(field.value ?? {}), [k]: v })} />
              ))}
            </div>
          )} />
        </div>

        <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <Controller control={control} name="isActive" render={({ field }) => (
            <SwitchRow label="Proposé à l'inscription" description="Visible sur le formulaire public." checked={!!field.value} onCheckedChange={field.onChange} />
          )} />
          <Field label="Ordre d'affichage" error={errors.sortOrder && "Entier"}>
            <Input type="number" inputMode="numeric" className="font-mono" {...register("sortOrder", { setValueAs: num })} />
          </Field>
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
