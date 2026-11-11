import { zodResolver } from "@hookform/resolvers/zod";
import type { Ingredient } from "@restaurant/api-client";
import { stockStateTone } from "@restaurant/ui-tokens";
import { STOCK_UNITS, compatibleUnits, convertQty, roundQty } from "@restaurant/utils";
import { ingredientInputSchema, wasteInputSchema } from "@restaurant/validation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { SwitchRow } from "@/components/ui/switch";
import { applyApiErrors, errorMessage } from "@/lib/errors";
import { formatFcfa, formatQty } from "@/lib/format";
import { STOCK_STATE_LABEL, STOCK_UNIT_LABEL } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useTenant } from "../hooks";
import { parseQty, useIngredients, useSuppliers } from "./stock-hooks";

export function StockStateBadge({ state, className }: { state: Ingredient["state"]; className?: string }) {
  return <Badge tone={stockStateTone(state)} dot className={className}>{STOCK_STATE_LABEL[state]}</Badge>;
}

/** Invalide tout ce qui dépend du stock (listes, alertes, mouvements, pertes). */
export function useRefreshStock() {
  const t = useTenant();
  const qc = useQueryClient();
  return React.useCallback(() => qc.invalidateQueries({ queryKey: tenantKeys.stock(t.root) }), [qc, t.root]);
}

const qtyField = { setValueAs: (v: unknown) => (v === "" || v == null ? undefined : parseQty(String(v)) ?? Number.NaN) };
const optQtyField = { setValueAs: (v: unknown) => (v === "" || v == null ? null : parseQty(String(v)) ?? Number.NaN) };
const fmtInput = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));

type IngValues = z.input<typeof ingredientInputSchema>;

/** Création / modification d'un ingrédient (responsables). Le stock ne change que par des mouvements. */
export function IngredientDialog({ value, onClose }: { value: { ingredient: Ingredient | null } | null; onClose: () => void }) {
  const t = useTenant();
  const refresh = useRefreshStock();
  const suppliers = useSuppliers();
  const ing = value?.ingredient ?? null;
  const form = useForm<IngValues>({ resolver: zodResolver(ingredientInputSchema) });
  React.useEffect(() => {
    if (!value) return;
    form.reset(ing ? {
      name: ing.name, unit: ing.unit, category: ing.category ?? "", lowStockThreshold: fmtInput(ing.lowStockThreshold) as never,
      reorderQty: fmtInput(ing.reorderQty) as never, avgCost: ing.avgCost, supplierId: ing.supplier?.id ?? "", autoDisable: ing.autoDisable,
    } : { name: "", unit: "kg", category: "", lowStockThreshold: "" as never, reorderQty: "" as never, avgCost: 0, supplierId: "", autoDisable: false, initialQuantity: "" as never });
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: (v: z.output<typeof ingredientInputSchema>) => {
      const body = { ...v, supplierId: v.supplierId || null };
      if (!ing) return t.api.inventory.createIngredient(body);
      const { initialQuantity: _i, ...patch } = body;
      return t.api.inventory.updateIngredient(ing.id, { ...patch, category: patch.category ?? null });
    },
    onSuccess: (r) => { void refresh(); toast.success(ing ? `« ${r.name} » enregistré` : `« ${r.name} » ajouté au stock`); onClose(); },
    onError: (e) => { if (!applyApiErrors(e, form.setError)) form.setError("root", { message: errorMessage(e) }); },
  });
  const submit = form.handleSubmit((v) => save.mutate(v as z.output<typeof ingredientInputSchema>));
  const err = form.formState.errors;
  const unit = form.watch("unit");
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()} title={ing ? `Modifier « ${ing.name} »` : "Ajouter un ingrédient"}
      description="Unité de stock, seuil d'alerte et coût moyen (FCFA par unité). Le coût moyen se met ensuite à jour à chaque réception."
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" loading={save.isPending} onClick={submit}>{ing ? "Enregistrer" : "Ajouter l'ingrédient"}</Button></>}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {err.root && <Callout tone="danger">{err.root.message}</Callout>}
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <Field label="Nom" required error={err.name?.message}><Input autoFocus maxLength={80} placeholder="Riz parfumé" {...form.register("name")} /></Field>
          <Field label="Unité de stock" required error={err.unit?.message} hint={ing ? "Modifiable tant qu'il n'y a ni mouvement ni recette." : undefined}>
            <NativeSelect {...form.register("unit")}>{STOCK_UNITS.map((u) => <option key={u} value={u}>{STOCK_UNIT_LABEL[u]}</option>)}</NativeSelect>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Catégorie" error={err.category?.message} hint="Ex. Épicerie, Viandes : regroupe l'inventaire."><Input maxLength={40} {...form.register("category")} /></Field>
          <Field label="Fournisseur habituel" error={err.supplierId?.message}>
            <NativeSelect {...form.register("supplierId")}>
              <option value="">Aucun</option>
              {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Seuil d'alerte" error={err.lowStockThreshold?.message} hint={`Alerte quand le stock descend à ce niveau (${STOCK_UNIT_LABEL[unit ?? "kg"]}).`}>
            <Input inputMode="decimal" className="font-mono tabular-nums" placeholder="0" {...form.register("lowStockThreshold", qtyField)} />
          </Field>
          <Field label="Quantité à recommander" error={err.reorderQty?.message} hint="Proposée dans les commandes fournisseurs.">
            <Input inputMode="decimal" className="font-mono tabular-nums" {...form.register("reorderQty", optQtyField)} />
          </Field>
          <Controller control={form.control} name="avgCost" render={({ field }) => (
            <Field label={`Coût moyen par ${STOCK_UNIT_LABEL[unit ?? "kg"]}`} error={err.avgCost?.message}>
              <MoneyInput ref={field.ref} value={field.value ?? null} onValueChange={(v) => field.onChange(v ?? 0)} onBlur={field.onBlur} />
            </Field>
          )} />
          {!ing && (
            <Field label="Stock de départ" error={err.initialQuantity?.message} hint="Enregistré comme un ajustement « Stock initial ».">
              <Input inputMode="decimal" className="font-mono tabular-nums" placeholder="0" {...form.register("initialQuantity", qtyField)} />
            </Field>
          )}
        </div>
        <div className="rounded-lg border border-border px-4">
          <Controller control={form.control} name="autoDisable" render={({ field }) => (
            <SwitchRow label="Rendre les plats indisponibles à zéro" description="Quand le stock tombe à zéro, les plats qui l'utilisent sont grisés partout (salle, carte publique)." checked={!!field.value} onCheckedChange={field.onChange} />
          )} />
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

type WasteValues = z.input<typeof wasteInputSchema>;

/** Déclaration d'une perte (cuisine et responsables) : mouvement WASTE valorisé au coût moyen. */
export function WasteDialog({ open, ingredient, onClose }: { open: boolean; ingredient?: Ingredient | null; onClose: () => void }) {
  const t = useTenant();
  const refresh = useRefreshStock();
  const list = useIngredients();
  const form = useForm<WasteValues>({ resolver: zodResolver(wasteInputSchema) });
  React.useEffect(() => {
    if (open) form.reset({ ingredientId: ingredient?.id ?? "", quantity: "" as never, unit: ingredient?.unit, reason: "" });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const id = form.watch("ingredientId");
  const current = list.data?.find((i) => i.id === id) ?? ingredient ?? null;
  const unit = form.watch("unit") ?? current?.unit;
  const qty = form.watch("quantity");
  React.useEffect(() => { if (current && !compatibleUnits(current.unit).includes(unit as never)) form.setValue("unit", current.unit); }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const estimate = current && typeof qty === "number" && qty > 0 && unit ? Math.round(convertQty(qty, unit, current.unit) * current.avgCost) : null;
  const save = useMutation({
    mutationFn: (v: z.output<typeof wasteInputSchema>) => t.api.inventory.declareWaste(v),
    onSuccess: (r) => { void refresh(); toast.success(`Perte enregistrée : ${formatQty(r.quantity, r.ingredient.unit)} de ${r.ingredient.name}`); onClose(); },
    onError: (e) => { if (!applyApiErrors(e, form.setError)) form.setError("root", { message: errorMessage(e) }); },
  });
  const submit = form.handleSubmit((v) => save.mutate(v as z.output<typeof wasteInputSchema>));
  const err = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Déclarer une perte" description="Produit abîmé, renversé ou périmé : il sort du stock et la perte est valorisée au coût moyen."
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Enregistrer la perte</Button></>}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {err.root && <Callout tone="danger">{err.root.message}</Callout>}
        <Field label="Ingrédient" required error={err.ingredientId?.message}>
          <NativeSelect {...form.register("ingredientId")} disabled={!!ingredient}>
            <option value="">Choisir…</option>
            {(list.data ?? (ingredient ? [ingredient] : [])).map((i) => <option key={i.id} value={i.id}>{i.name} ({formatQty(i.quantity, i.unit)})</option>)}
          </NativeSelect>
        </Field>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <Field label="Quantité perdue" required error={err.quantity?.message}>
            <Input inputMode="decimal" autoFocus={!!ingredient} className="font-mono tabular-nums" {...form.register("quantity", qtyField)} />
          </Field>
          <Field label="Unité" error={err.unit?.message}>
            <NativeSelect {...form.register("unit")} disabled={!current}>
              {(current ? compatibleUnits(current.unit) : STOCK_UNITS).map((u) => <option key={u} value={u}>{STOCK_UNIT_LABEL[u]}</option>)}
            </NativeSelect>
          </Field>
        </div>
        <Field label="Motif" required error={err.reason?.message}><Input maxLength={200} placeholder="Bouteille renversée" {...form.register("reason")} /></Field>
        {estimate !== null && t.isManager && <p className="text-[13px] text-muted-foreground">Perte estimée : <span className="font-mono text-foreground">{formatFcfa(estimate)}</span></p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** Correction ponctuelle : on saisit la quantité réelle, l'écart devient un ajustement. */
export function AdjustDialog({ ingredient, onClose }: { ingredient: Ingredient | null; onClose: () => void }) {
  const t = useTenant();
  const refresh = useRefreshStock();
  const [real, setReal] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (ingredient) { setReal(fmtInput(ingredient.quantity)); setReason(""); setError(null); } }, [ingredient]);
  const value = parseQty(real);
  const delta = ingredient && value !== null ? roundQty(value - ingredient.quantity) : null;
  const save = useMutation({
    mutationFn: () => t.api.inventory.adjust(ingredient!.id, { delta: delta!, reason: reason.trim() }),
    onSuccess: (r) => { void refresh(); toast.success(`Stock de « ${r.name} » corrigé : ${formatQty(r.quantity, r.unit)}`); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const valid = delta !== null && delta !== 0 && value !== null && value >= 0 && reason.trim().length >= 3;
  return (
    <Dialog open={!!ingredient} onOpenChange={(o) => !o && onClose()} title={ingredient ? `Corriger le stock de « ${ingredient.name} »` : ""}
      description="Pour un recomptage complet, préférez l'inventaire guidé."
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>Enregistrer la correction</Button></>}>
      {ingredient && (
        <div className="flex flex-col gap-4">
          {error && <Callout tone="danger">{error}</Callout>}
          <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-sm">
            <span className="text-muted-foreground">Stock enregistré</span>
            <span className="flex items-center gap-2"><span className="font-mono tabular-nums">{formatQty(ingredient.quantity, ingredient.unit)}</span><StockStateBadge state={ingredient.state} /></span>
          </div>
          <Field label={`Quantité réelle (${STOCK_UNIT_LABEL[ingredient.unit]})`} hint={delta ? `Écart : ${delta > 0 ? "+" : ""}${formatQty(delta, ingredient.unit)}` : undefined}>
            <Input inputMode="decimal" autoFocus className="font-mono tabular-nums" value={real} onChange={(e) => setReal(e.target.value)} />
          </Field>
          <Field label="Motif" required><Input maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Erreur de saisie à la réception" /></Field>
        </div>
      )}
    </Dialog>
  );
}
