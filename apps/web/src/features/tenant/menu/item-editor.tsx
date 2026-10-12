import { zodResolver } from "@hookform/resolvers/zod";
import type { Allergen, MenuCategory, MenuItem } from "@restaurant/api-client";
import { menuItemInputSchema } from "@restaurant/validation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import * as React from "react";
import { Controller, useFieldArray, useForm, useWatch, type Control, type FieldErrors, type UseFormRegister } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { Dropzone } from "@/components/ui/dropzone";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Stepper } from "@/components/ui/stepper";
import { SwitchRow } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { applyApiErrors, errorMessage, toastError } from "@/lib/errors";
import { formatFcfa } from "@/lib/format";
import { tenantKeys } from "@/lib/tenant-keys";
import { useOperations, useTenant } from "../hooks";
import { groupRuleLabel } from "../pos/cart";

type FormValues = z.input<typeof menuItemInputSchema>;

const toForm = (item: MenuItem | null, categoryId: string): FormValues => item ? {
  categoryId: item.categoryId, name: item.name, description: item.description ?? "", price: item.price, vatRate: item.vatRate,
  prepMinutes: item.prepMinutes, isAvailable: item.isAvailable, isDishOfDay: item.isDishOfDay, sortOrder: item.sortOrder,
  allergenCodes: item.allergens.map((a) => a.code),
  optionGroups: item.optionGroups.map((g) => ({ name: g.name, minChoices: g.minChoices, maxChoices: g.maxChoices, options: g.options.map((o) => ({ name: o.name, extra: o.extra })) })),
} : {
  categoryId, name: "", description: "", price: 0, vatRate: undefined, prepMinutes: 10, isAvailable: true, isDishOfDay: false, sortOrder: 0, allergenCodes: [], optionGroups: [],
};

/**
 * Création / modification d'un plat : photo, prix TTC, TVA, temps de préparation, allergènes et groupes d'options
 * (validés par les schémas partagés avec l'API ; les groupes sont remplacés en bloc à l'enregistrement).
 */
export function ItemEditor({ value, categories, allergens, onClose }: {
  value: { item: MenuItem | null; categoryId: string } | null; categories: MenuCategory[]; allergens: Allergen[]; onClose: () => void;
}) {
  const t = useTenant();
  const qc = useQueryClient();
  const ops = useOperations();
  const confirm = useConfirm();
  const item = value?.item ?? null;
  const [photo, setPhoto] = React.useState<{ file: File; url: string } | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(menuItemInputSchema), defaultValues: toForm(null, "") });
  const groups = useFieldArray({ control: form.control, name: "optionGroups" });
  const errors = form.formState.errors;

  React.useEffect(() => {
    if (!value) return;
    form.reset(toForm(value.item, value.categoryId));
    setPhoto(null);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  const refresh = () => qc.invalidateQueries({ queryKey: tenantKeys.menu(t.root) });

  const save = useMutation({
    mutationFn: async (v: z.output<typeof menuItemInputSchema>) => {
      const saved = item ? await t.api.menu.updateItem(item.id, v) : await t.api.menu.createItem(v);
      if (photo) {
        try { await t.api.menu.uploadImage(saved.id, photo.file); } catch (e) { toastError(e, "La photo n'a pas pu être envoyée"); }
      }
      return saved;
    },
    onSuccess: (r) => { void refresh(); toast.success(item ? `« ${r.name} » enregistré` : `« ${r.name} » ajouté à la carte`); onClose(); },
    onError: (e) => { if (!applyApiErrors(e, form.setError)) form.setError("root", { message: errorMessage(e) }); },
  });
  const remove = useMutation({
    mutationFn: () => t.api.menu.deleteItem(item!.id),
    onSuccess: (r) => { void refresh(); toast.success(r.archived ? `« ${item!.name} » retiré de la carte (historique conservé)` : `« ${item!.name} » supprimé`); onClose(); },
    onError: (e) => toastError(e),
  });

  const submit = form.handleSubmit((v) => save.mutate(v as z.output<typeof menuItemInputSchema>), () => {
    // Focus sur le premier champ en erreur (les groupes d'options sont plus bas dans la boîte).
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-item-editor] [aria-invalid=true]")?.focus());
  });
  const codes = form.watch("allergenCodes") ?? [];

  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()} size="lg" dismissable={!save.isPending}
      title={item ? `Modifier « ${item.name} »` : "Ajouter un plat"}
      description="Prix TTC en FCFA. Les modifications sont visibles tout de suite en salle et sur la carte publique."
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {item ? (
            <Button variant="danger-ghost" onClick={() => confirm({
              title: `Retirer « ${item.name} » de la carte ?`,
              description: "S'il n'a jamais été commandé, il est supprimé. Sinon il est archivé : il disparaît de la carte mais l'historique des commandes et des tickets est conservé.",
              confirmLabel: "Retirer le plat",
              onConfirm: () => remove.mutateAsync(),
            })}><Trash2 /> Retirer de la carte</Button>
          ) : <span />}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" onClick={onClose}>Annuler</Button>
            <Button variant="primary" loading={save.isPending} onClick={submit}>{item ? "Enregistrer" : "Ajouter le plat"}</Button>
          </div>
        </div>
      }>
      <form data-item-editor onSubmit={submit} noValidate className="flex flex-col gap-6">
        {errors.root && <Callout tone="danger">{errors.root.message}</Callout>}
        <div className="grid gap-5 sm:grid-cols-[220px_1fr]">
          <Dropzone
            kind="menuPhoto" label="Photo" previewFit="cover"
            currentUrl={photo?.url ?? item?.imageUrl ?? null}
            onUpload={async (file) => {
              if (item) {
                await t.api.menu.uploadImage(item.id, file);
                void refresh();
                toast.success("Photo enregistrée");
              } else setPhoto({ file, url: URL.createObjectURL(file) });
            }}
            onRemove={item?.imageUrl || photo ? async () => {
              if (photo) { setPhoto(null); return; }
              await t.api.menu.removeImage(item!.id); void refresh(); toast.success("Photo retirée");
            } : undefined}
          />
          <div className="flex flex-col gap-4">
            <Field label="Nom du plat" required error={errors.name?.message}><Input autoFocus maxLength={80} {...form.register("name")} /></Field>
            <Field label="Description" error={errors.description?.message} hint="Affichée sur la carte publique.">
              <Textarea maxLength={400} className="min-h-[72px]" {...form.register("description")} />
            </Field>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Catégorie" required error={errors.categoryId?.message}>
            <NativeSelect {...form.register("categoryId")}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
          </Field>
          <Controller control={form.control} name="price" render={({ field }) => (
            <Field label="Prix TTC" required error={errors.price?.message}>
              <MoneyInput ref={field.ref} value={field.value ?? null} onValueChange={(v) => field.onChange(v ?? 0)} onBlur={field.onBlur} />
            </Field>
          )} />
          <Field label="TVA" error={errors.vatRate?.message}>
            <NativeSelect {...form.register("vatRate", { setValueAs: (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)) })}>
              <option value="">Taux par défaut ({ops.defaultVatRate} %)</option>
              {[0, 10, 18].map((r) => <option key={r} value={r}>{r} %</option>)}
            </NativeSelect>
          </Field>
          <Field label="Temps de préparation" error={errors.prepMinutes?.message} hint="Sert au chronomètre de l'écran cuisine.">
            <Controller control={form.control} name="prepMinutes" render={({ field }) => (
              <div className="flex items-center gap-3">
                <Stepper label="minutes" value={field.value ?? 0} min={0} max={240} onChange={(v) => field.onChange(Math.max(0, Math.min(240, v)))} />
                <span className="text-sm text-muted-foreground">min</span>
              </div>
            )} />
          </Field>
        </div>

        <div className="flex flex-col divide-y divide-border rounded-lg border border-border px-4">
          <Controller control={form.control} name="isAvailable" render={({ field }) => (
            <SwitchRow label="Disponible" description="Un plat épuisé reste sur la carte du personnel mais ne peut plus être commandé." checked={!!field.value} onCheckedChange={field.onChange} />
          )} />
          <Controller control={form.control} name="isDishOfDay" render={({ field }) => (
            <SwitchRow label="Plat du jour" description="Mis en avant en prise de commande et sur la carte publique." checked={!!field.value} onCheckedChange={field.onChange} />
          )} />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[13px] font-medium">Allergènes</legend>
          <div className="flex flex-wrap gap-2">
            {allergens.map((a) => {
              const on = codes.includes(a.code);
              return (
                <button key={a.code} type="button" aria-pressed={on}
                  onClick={() => form.setValue("allergenCodes", on ? codes.filter((c) => c !== a.code) : [...codes, a.code], { shouldDirty: true })}
                  className={cn("inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8",
                    on ? "border-[color-mix(in_oklab,var(--tone-amber-dot)_50%,var(--border))] bg-[var(--tone-amber-bg)] text-[var(--tone-amber-fg)]" : "border-border text-muted-foreground hover:bg-hover hover:text-foreground")}>
                  {a.name}
                </button>
              );
            })}
          </div>
        </fieldset>

        <section className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-medium">Options et suppléments</h3>
              <p className="text-[12.5px] text-muted-foreground">Ex. « Accompagnement » : 1 choix obligatoire parmi Attiéké, Riz, Alloco (+<span className="font-mono">{formatFcfa(500)}</span>). Supplément à 0 = inclus.</p>
            </div>
          </div>
          {groups.fields.map((g, gi) => (
            <OptionGroupEditor key={g.id} index={gi} control={form.control} register={form.register} errors={errors} onRemove={() => groups.remove(gi)} />
          ))}
          <Button variant="secondary" className="self-start" onClick={() => groups.append({ name: "", minChoices: 0, maxChoices: 1, options: [{ name: "", extra: 0 }] })} disabled={groups.fields.length >= 10}>
            <Plus /> Ajouter un groupe d'options
          </Button>
        </section>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function OptionGroupEditor({ index, control, register, errors, onRemove }: {
  index: number; control: Control<FormValues>; register: UseFormRegister<FormValues>; errors: FieldErrors<FormValues>; onRemove: () => void;
}) {
  const options = useFieldArray({ control, name: `optionGroups.${index}.options` });
  const [min, max] = useWatch({ control, name: [`optionGroups.${index}.minChoices`, `optionGroups.${index}.maxChoices`] });
  const e = errors.optionGroups?.[index];
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-subtle p-3 sm:p-4">
      <div className="flex items-start gap-2">
        <Field label="Nom du groupe" required error={e?.name?.message} className="flex-1">
          <Input placeholder="Accompagnement, cuisson, sauce…" maxLength={60} {...register(`optionGroups.${index}.name`)} className="bg-background" />
        </Field>
        <Button variant="ghost" size="icon" className="mt-6" aria-label="Supprimer ce groupe d'options" onClick={onRemove}><Trash2 /></Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="flex items-center gap-2 text-[13px]"><span className="text-muted-foreground">Minimum</span>
            <Controller control={control} name={`optionGroups.${index}.minChoices`} render={({ field }) => (
              <Stepper label="choix minimum" value={field.value ?? 0} min={0} max={20} onChange={(v) => field.onChange(Math.max(0, v))} />
            )} />
          </span>
          <span className="flex items-center gap-2 text-[13px]"><span className="text-muted-foreground">Maximum</span>
            <Controller control={control} name={`optionGroups.${index}.maxChoices`} render={({ field }) => (
              <Stepper label="choix maximum" value={field.value ?? 1} min={1} max={20} onChange={(v) => field.onChange(Math.max(1, v))} />
            )} />
          </span>
          <span className="text-[12.5px] text-muted-foreground">{groupRuleLabel({ minChoices: Number(min ?? 0), maxChoices: Number(max ?? 1) })}</span>
        </div>
        {e?.minChoices?.message && <p role="alert" className="text-[12.5px] text-danger">{e.minChoices.message}</p>}
        {e?.maxChoices?.message && <p role="alert" className="text-[12.5px] text-danger">{e.maxChoices.message}</p>}
      </div>
      <ul className="flex flex-col gap-2">
        {options.fields.map((o, oi) => (
          <li key={o.id} className="flex items-start gap-2">
            <Field error={e?.options?.[oi]?.name?.message} className="flex-1">
              <Input aria-label={`Option ${oi + 1}`} placeholder="Nom de l'option" maxLength={60} {...register(`optionGroups.${index}.options.${oi}.name`)} className="bg-background" />
            </Field>
            <Controller control={control} name={`optionGroups.${index}.options.${oi}.extra`} render={({ field }) => (
              <div className="w-36 shrink-0"><MoneyInput aria-label={`Supplément de l'option ${oi + 1}`} value={field.value ?? 0} onValueChange={(v) => field.onChange(v ?? 0)} className="bg-background" /></div>
            )} />
            <Button variant="ghost" size="icon" aria-label={`Retirer l'option ${oi + 1}`} onClick={() => options.remove(oi)} disabled={options.fields.length <= 1}><X /></Button>
          </li>
        ))}
      </ul>
      {typeof e?.options?.message === "string" && <p role="alert" className="text-[12.5px] text-danger">{e.options.message}</p>}
      <Button variant="ghost" size="sm" className="self-start" onClick={() => options.append({ name: "", extra: 0 })} disabled={options.fields.length >= 30}><Plus /> Ajouter une option</Button>
    </div>
  );
}
