import { zodResolver } from "@hookform/resolvers/zod";
import type { MenuCategory, Promotion } from "@restaurant/api-client";
import { promotionActiveAt, promotionLabel } from "@restaurant/utils";
import { promotionInputSchema } from "@restaurant/validation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgePercent, Pencil, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { Controller, useForm } from "react-hook-form";
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
import { Input, NativeSelect } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { applyApiErrors, errorMessage, toastError } from "@/lib/errors";
import { tenantKeys } from "@/lib/tenant-keys";
import { useNow, useTenant, useTimezone } from "../hooks";
import { usePromotions } from "./extras-hooks";

type FormValues = z.input<typeof promotionInputSchema>;
const DAYS = [[1, "Lun"], [2, "Mar"], [3, "Mer"], [4, "Jeu"], [5, "Ven"], [6, "Sam"], [7, "Dim"]] as const;

const blank = (): FormValues => ({ name: "", kind: "PERCENT", value: 10, menuItemId: null, categoryId: null, startsOn: "", endsOn: "", days: [], fromTime: "", toTime: "", isActive: true });
const toForm = (p: Promotion): FormValues => ({
  name: p.name, kind: p.kind, value: p.value, menuItemId: p.menuItemId, categoryId: p.categoryId, startsOn: p.startsOn ?? "", endsOn: p.endsOn ?? "",
  days: p.days, fromTime: p.fromTime ?? "", toTime: p.toTime ?? "", isActive: p.isActive,
});

const fr = (d: string) => d.split("-").reverse().join("/");

function scheduleLabel(p: Promotion): string {
  const parts: string[] = [];
  if (p.startsOn || p.endsOn) parts.push(p.startsOn && p.endsOn ? `du ${fr(p.startsOn)} au ${fr(p.endsOn)}` : p.startsOn ? `dès le ${fr(p.startsOn)}` : `jusqu'au ${fr(p.endsOn!)}`);
  if (p.days.length) parts.push(DAYS.filter(([d]) => p.days.includes(d)).map(([, l]) => l).join(", "));
  if (p.fromTime && p.toTime) parts.push(`${p.fromTime}–${p.toTime}`);
  return parts.join(" · ") || "Tout le temps";
}

/** Promotions simples : remise en % ou en montant sur un plat ou une catégorie, avec période. Réservé aux responsables. */
export function PromotionsPanel({ cats }: { cats: MenuCategory[] }) {
  const t = useTenant();
  const qc = useQueryClient();
  const tz = useTimezone();
  const now = useNow(30_000);
  const q = usePromotions();
  const [editor, setEditor] = React.useState<Promotion | "new" | null>(null);
  const dishes = new Map(cats.flatMap((c) => c.items.map((i) => [i.id, i.name] as const)));
  const catNames = new Map(cats.map((c) => [c.id, c.name] as const));
  const toggle = useMutation({
    mutationFn: ({ p, v }: { p: Promotion; v: boolean }) => t.api.menu.setPromotionActive(p.id, v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: tenantKeys.promotions(t.root) }),
    onError: (e) => toastError(e),
  });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-muted-foreground">
          Une promotion s'applique toute seule pendant sa période. Le prix remisé est figé sur la commande et la remise apparaît sur le ticket. Si plusieurs promotions visent un plat, la plus avantageuse est retenue.
        </p>
        <Button variant="primary" onClick={() => setEditor("new")}><Plus /> Nouvelle promotion</Button>
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="h-40 rounded-lg" /> : !q.data?.length ? (
        <Card><EmptyState icon={<BadgePercent />} title="Aucune promotion" description="Créez un « happy hour », une remise de lancement ou une offre sur une catégorie."
          action={<Button variant="primary" onClick={() => setEditor("new")}><Plus /> Nouvelle promotion</Button>} /></Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {q.data.map((p) => {
              const live = promotionActiveAt(p, new Date(now), tz);
              return (
                <li key={p.id} className={cn("flex items-center gap-3 px-4 py-3 sm:px-5", !p.isActive && "bg-subtle")}>
                  <button type="button" onClick={() => setEditor(p)} className="flex min-w-0 flex-1 flex-col gap-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{p.name}</span>
                      <Badge tone="green">{promotionLabel(p.kind, p.value)}</Badge>
                      {!p.isActive ? <Badge tone="outline">Désactivée</Badge> : live ? <Badge tone="blue" dot>En cours</Badge> : <Badge tone="gray">Hors période</Badge>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {p.menuItemId ? `Plat : ${dishes.get(p.menuItemId) ?? "—"}` : `Catégorie : ${catNames.get(p.categoryId ?? "") ?? "—"}`} · {scheduleLabel(p)}
                    </span>
                  </button>
                  <Switch checked={p.isActive} onCheckedChange={(v) => toggle.mutate({ p, v })} aria-label={`${p.name} activée`} />
                  <Button variant="ghost" size="icon-sm" aria-label={`Modifier « ${p.name} »`} onClick={() => setEditor(p)}><Pencil /></Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <PromotionEditor value={editor} cats={cats} onClose={() => setEditor(null)} />
    </>
  );
}

function PromotionEditor({ value, cats, onClose }: { value: Promotion | "new" | null; cats: MenuCategory[]; onClose: () => void }) {
  const t = useTenant();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const promo = value && value !== "new" ? value : null;
  const form = useForm<FormValues>({ resolver: zodResolver(promotionInputSchema), defaultValues: blank() });
  const errors = form.formState.errors;
  const [target, setTarget] = React.useState<"item" | "category">("item");
  const kind = form.watch("kind");
  React.useEffect(() => { if (value) { form.reset(promo ? toForm(promo) : blank()); setTarget(promo?.categoryId ? "category" : "item"); } }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => qc.invalidateQueries({ queryKey: tenantKeys.promotions(t.root) });
  const save = useMutation({
    mutationFn: (v: z.output<typeof promotionInputSchema>) => (promo ? t.api.menu.updatePromotion(promo.id, v) : t.api.menu.createPromotion(v)),
    onSuccess: (p) => { void refresh(); toast.success(promo ? `« ${p.name} » enregistrée` : `« ${p.name} » créée`); onClose(); },
    onError: (e) => { if (!applyApiErrors(e, form.setError)) form.setError("root", { message: errorMessage(e) }); },
  });
  const remove = useMutation({
    mutationFn: () => t.api.menu.deletePromotion(promo!.id),
    onSuccess: () => { void refresh(); toast.success("Promotion supprimée"); onClose(); },
    onError: (e) => toastError(e),
  });
  const submit = form.handleSubmit((v) => save.mutate(v as z.output<typeof promotionInputSchema>));
  const days = form.watch("days") ?? [];

  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()} size="md" dismissable={!save.isPending}
      title={promo ? `Modifier « ${promo.name} »` : "Nouvelle promotion"} description="Les heures et les jours sont ceux du restaurant."
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {promo ? <Button variant="danger-ghost" onClick={() => confirm({
            title: `Supprimer « ${promo.name} » ?`, description: "Les commandes déjà passées gardent leur remise.", confirmLabel: "Supprimer", onConfirm: () => remove.mutateAsync(),
          })}><Trash2 /> Supprimer</Button> : <span />}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" onClick={onClose}>Annuler</Button>
            <Button variant="primary" loading={save.isPending} onClick={submit}>{promo ? "Enregistrer" : "Créer la promotion"}</Button>
          </div>
        </div>
      }>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        {errors.root && <Callout tone="danger">{errors.root.message}</Callout>}
        <Field label="Nom" required error={errors.name?.message} hint="Affiché sur la carte et le ticket."><Input autoFocus maxLength={60} placeholder="Happy hour" {...form.register("name")} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type de remise">
            <Controller control={form.control} name="kind" render={({ field }) => (
              <Segmented ariaLabel="Type de remise" value={field.value} onChange={field.onChange} options={[{ value: "PERCENT", label: "En %" }, { value: "AMOUNT", label: "En FCFA" }]} />
            )} />
          </Field>
          <Field label={kind === "PERCENT" ? "Remise (%)" : "Remise par unité (FCFA)"} required error={errors.value?.message}>
            <Input type="number" inputMode="numeric" min={1} max={kind === "PERCENT" ? 100 : undefined} {...form.register("value", { valueAsNumber: true })} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="S'applique à">
            <NativeSelect value={target} onChange={(e) => { setTarget(e.target.value as "item" | "category"); form.setValue("categoryId", null); form.setValue("menuItemId", null); }}>
              <option value="item">Un plat</option><option value="category">Une catégorie</option>
            </NativeSelect>
          </Field>
          {target === "item" ? (
            <Field label="Plat" required error={errors.menuItemId?.message}>
              <NativeSelect {...form.register("menuItemId", { setValueAs: (v) => v || null })}>
                <option value="">Choisir…</option>
                {cats.map((c) => <optgroup key={c.id} label={c.name}>{c.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</optgroup>)}
              </NativeSelect>
            </Field>
          ) : (
            <Field label="Catégorie" required error={errors.menuItemId?.message}>
              <NativeSelect {...form.register("categoryId", { setValueAs: (v) => v || null })}>
                <option value="">Choisir…</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            </Field>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Du" hint="Vide = sans date de début."><Input type="date" {...form.register("startsOn")} /></Field>
          <Field label="Au (inclus)" error={errors.endsOn?.message}><Input type="date" {...form.register("endsOn")} /></Field>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium">Jours <span className="font-normal text-muted-foreground">(aucun = tous les jours)</span></legend>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map(([d, label]) => {
              const on = days.includes(d);
              return (
                <button key={d} type="button" aria-pressed={on} onClick={() => form.setValue("days", on ? days.filter((x) => x !== d) : [...days, d].sort(), { shouldDirty: true })}
                  className={cn("h-10 min-w-12 rounded-full border px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on ? "border-brand-ink bg-brand-tint font-medium" : "border-border text-muted-foreground hover:bg-hover")}>{label}</button>
              );
            })}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="De (heure)" hint="Vide = toute la journée."><Input type="time" {...form.register("fromTime")} /></Field>
          <Field label="À (heure)" error={errors.toTime?.message}><Input type="time" {...form.register("toTime")} /></Field>
        </div>
      </form>
    </Dialog>
  );
}
