import { zodResolver } from "@hookform/resolvers/zod";
import type { Formula, MenuCategory } from "@restaurant/api-client";
import { formulaInputSchema } from "@restaurant/validation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, Layers, Pencil, Plus, Trash2, X } from "lucide-react";
import * as React from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch, SwitchRow } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { applyApiErrors, errorMessage, toastError } from "@/lib/errors";
import { formatFcfa } from "@/lib/format";
import { tenantKeys } from "@/lib/tenant-keys";
import { useTenant } from "../hooks";
import { useFormulas } from "./extras-hooks";

type FormValues = z.input<typeof formulaInputSchema>;

const blank = (): FormValues => ({
  name: "", description: "", price: 0, isActive: true, availableFrom: "", availableTo: "", sortOrder: 0,
  steps: [
    { name: "Entrée", minChoices: 1, maxChoices: 1, menuItemIds: [] },
    { name: "Plat", minChoices: 1, maxChoices: 1, menuItemIds: [] },
  ],
});
const toForm = (f: Formula): FormValues => ({
  name: f.name, description: f.description ?? "", price: f.price, isActive: f.isActive, availableFrom: f.availableFrom ?? "", availableTo: f.availableTo ?? "", sortOrder: f.sortOrder,
  steps: f.steps.map((s) => ({ name: s.name, minChoices: s.minChoices, maxChoices: s.maxChoices, menuItemIds: s.items.map((i) => i.menuItemId) })),
});

/** Formules (menus à prix fixe) : étapes avec choix parmi des plats, prix fixe, plage horaire. Réservé aux responsables. */
export function FormulasPanel({ cats }: { cats: MenuCategory[] }) {
  const t = useTenant();
  const qc = useQueryClient();
  const q = useFormulas();
  const [editor, setEditor] = React.useState<Formula | "new" | null>(null);
  const key = tenantKeys.formulas(t.root);
  const toggle = useMutation({
    mutationFn: ({ f, v }: { f: Formula; v: boolean }) => t.api.menu.updateFormula(f.id, { isActive: v }),
    onSuccess: (f) => { void qc.invalidateQueries({ queryKey: key }); toast.success(f.isActive ? `« ${f.name} » proposée` : `« ${f.name} » masquée`); },
    onError: (e) => toastError(e),
  });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-muted-foreground">
          Une formule est vendue à prix fixe : le client choisit un plat par étape. Ses plats partent en cuisine normalement ; seul le prix de la formule est facturé.
        </p>
        <Button variant="primary" onClick={() => setEditor("new")}><Plus /> Nouvelle formule</Button>
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="h-40 rounded-lg" /> : !q.data?.length ? (
        <Card><EmptyState icon={<Layers />} title="Aucune formule" description="Créez un menu du jour, une formule midi ou un menu enfant avec son prix fixe."
          action={<Button variant="primary" onClick={() => setEditor("new")}><Plus /> Nouvelle formule</Button>} /></Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {q.data.map((f) => (
              <li key={f.id} className={cn("flex items-start gap-3 px-4 py-3 sm:px-5", !f.isActive && "bg-subtle")}>
                <button type="button" onClick={() => setEditor(f)} className="flex min-w-0 flex-1 flex-col gap-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{f.name}</span>
                    <span className="font-mono text-sm font-semibold tabular-nums">{formatFcfa(f.price)}</span>
                    {f.availableFrom && f.availableTo && <Badge tone="gray"><Clock className="size-3" /> {f.availableFrom}–{f.availableTo}</Badge>}
                    {!f.isActive && <Badge tone="outline">Masquée</Badge>}
                  </span>
                  <span className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                    {f.steps.map((s) => (
                      <span key={s.id}><span className="font-medium text-foreground">{s.name}</span> ({s.maxChoices === 1 ? "1 choix" : `${s.minChoices}–${s.maxChoices} choix`}) : {s.items.map((i) => i.name).join(", ") || "—"}</span>
                    ))}
                  </span>
                </button>
                <label className="flex shrink-0 items-center gap-2 text-[13px] text-muted-foreground">
                  <span className="hidden sm:inline">{f.isActive ? "Proposée" : "Masquée"}</span>
                  <Switch checked={f.isActive} onCheckedChange={(v) => toggle.mutate({ f, v })} aria-label={`${f.name} proposée`} />
                </label>
                <Button variant="ghost" size="icon-sm" aria-label={`Modifier « ${f.name} »`} onClick={() => setEditor(f)}><Pencil /></Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <FormulaEditor value={editor} cats={cats} onClose={() => setEditor(null)} />
    </>
  );
}

function FormulaEditor({ value, cats, onClose }: { value: Formula | "new" | null; cats: MenuCategory[]; onClose: () => void }) {
  const t = useTenant();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const formula = value && value !== "new" ? value : null;
  const form = useForm<FormValues>({ resolver: zodResolver(formulaInputSchema), defaultValues: blank() });
  const steps = useFieldArray({ control: form.control, name: "steps" });
  const errors = form.formState.errors;
  React.useEffect(() => { if (value) form.reset(formula ? toForm(formula) : blank()); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => qc.invalidateQueries({ queryKey: tenantKeys.formulas(t.root) });
  const save = useMutation({
    mutationFn: (v: z.output<typeof formulaInputSchema>) => (formula ? t.api.menu.updateFormula(formula.id, v) : t.api.menu.createFormula(v)),
    onSuccess: (f) => { void refresh(); toast.success(formula ? `« ${f.name} » enregistrée` : `« ${f.name} » créée`); onClose(); },
    onError: (e) => { if (!applyApiErrors(e, form.setError)) form.setError("root", { message: errorMessage(e) }); },
  });
  const remove = useMutation({
    mutationFn: () => t.api.menu.deleteFormula(formula!.id),
    onSuccess: (r) => { void refresh(); toast.success(r.archived ? "Formule retirée (historique conservé)" : "Formule supprimée"); onClose(); },
    onError: (e) => toastError(e),
  });
  const submit = form.handleSubmit((v) => save.mutate(v as z.output<typeof formulaInputSchema>));

  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()} size="lg" dismissable={!save.isPending}
      title={formula ? `Modifier « ${formula.name} »` : "Nouvelle formule"} description="Prix fixe TTC ; la TVA suit le taux par défaut du restaurant."
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {formula ? <Button variant="danger-ghost" onClick={() => confirm({
            title: `Retirer « ${formula.name} » ?`, description: "Si elle n'a jamais été commandée, elle est supprimée ; sinon elle est archivée et l'historique des tickets reste intact.",
            confirmLabel: "Retirer la formule", onConfirm: () => remove.mutateAsync(),
          })}><Trash2 /> Retirer</Button> : <span />}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" onClick={onClose}>Annuler</Button>
            <Button variant="primary" loading={save.isPending} onClick={submit}>{formula ? "Enregistrer" : "Créer la formule"}</Button>
          </div>
        </div>
      }>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        {errors.root && <Callout tone="danger">{errors.root.message}</Callout>}
        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <Field label="Nom" required error={errors.name?.message}><Input autoFocus maxLength={80} placeholder="Menu du jour" {...form.register("name")} /></Field>
          <Controller control={form.control} name="price" render={({ field }) => (
            <Field label="Prix TTC" required error={errors.price?.message}>
              <MoneyInput ref={field.ref} value={field.value ?? null} onValueChange={(v) => field.onChange(v ?? 0)} onBlur={field.onBlur} />
            </Field>
          )} />
        </div>
        <Field label="Description" error={errors.description?.message}><Textarea maxLength={300} className="min-h-[56px]" {...form.register("description")} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Servie à partir de" hint="Laissez vide pour toute la journée."><Input type="time" {...form.register("availableFrom")} /></Field>
          <Field label="Jusqu'à" error={errors.availableTo?.message}><Input type="time" {...form.register("availableTo")} /></Field>
        </div>
        <div className="rounded-lg border border-border px-4">
          <Controller control={form.control} name="isActive" render={({ field }) => (
            <SwitchRow label="Proposée" description="Une formule masquée n'apparaît ni en prise de commande ni sur la carte publique." checked={!!field.value} onCheckedChange={field.onChange} />
          )} />
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-[13px] font-medium">Étapes</legend>
          {typeof errors.steps?.message === "string" && <p role="alert" className="text-[12.5px] text-danger">{errors.steps.message}</p>}
          {steps.fields.map((s, i) => (
            <div key={s.id} className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_90px_90px_auto] sm:items-end">
                <Field label={`Étape ${i + 1}`} error={errors.steps?.[i]?.name?.message}><Input maxLength={60} placeholder="Entrée, Plat, Dessert…" {...form.register(`steps.${i}.name`)} /></Field>
                <Field label="Min." error={errors.steps?.[i]?.minChoices?.message}>
                  <NativeSelect {...form.register(`steps.${i}.minChoices`, { valueAsNumber: true })}>{[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</NativeSelect>
                </Field>
                <Field label="Max."><NativeSelect {...form.register(`steps.${i}.maxChoices`, { valueAsNumber: true })}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</NativeSelect></Field>
                <Button variant="ghost" size="icon" aria-label={`Retirer l'étape ${i + 1}`} disabled={steps.fields.length <= 1} onClick={() => steps.remove(i)}><X /></Button>
              </div>
              <Controller control={form.control} name={`steps.${i}.menuItemIds`} render={({ field }) => (
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Plats proposés ({(field.value ?? []).length})</span>
                  <DishPicker cats={cats} value={field.value ?? []} onChange={field.onChange} />
                  {errors.steps?.[i]?.menuItemIds?.message && <p role="alert" className="text-[12.5px] text-danger">{errors.steps[i]!.menuItemIds!.message}</p>}
                </div>
              )} />
            </div>
          ))}
          <Button variant="secondary" className="self-start" disabled={steps.fields.length >= 8} onClick={() => steps.append({ name: "", minChoices: 1, maxChoices: 1, menuItemIds: [] })}><Plus /> Ajouter une étape</Button>
        </fieldset>
      </form>
    </Dialog>
  );
}

/** Sélection de plats par catégorie (les plats à options obligatoires sont refusés par l'API). */
function DishPicker({ cats, value, onChange }: { cats: MenuCategory[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex max-h-52 flex-col gap-2 overflow-y-auto rounded-md border border-border bg-subtle p-2">
      {cats.filter((c) => c.items.length).map((c) => (
        <div key={c.id} className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-faint">{c.name}</span>
          <div className="flex flex-wrap gap-1.5">
            {c.items.map((i) => {
              const on = value.includes(i.id);
              return (
                <button key={i.id} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== i.id) : [...value, i.id])}
                  className={cn("min-h-9 rounded-full border px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on ? "border-brand-ink bg-brand-tint font-medium" : "border-border bg-background text-muted-foreground hover:bg-hover")}>
                  {i.name}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
