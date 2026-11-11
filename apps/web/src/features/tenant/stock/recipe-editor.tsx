import type { DishRecipe, Ingredient, RecipeLineView, StockUnit } from "@restaurant/api-client";
import { compatibleUnits, dishMargin, lineCostExact, recipeCost } from "@restaurant/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { formatFcfa } from "@/lib/format";
import { STOCK_UNIT_LABEL } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useTenant } from "../hooks";
import { isPlanFeatureError, parseQty, useIngredients } from "./stock-hooks";

type Draft = { ingredientId: string; quantity: string; unit: StockUnit | "" };
const toDraft = (lines: RecipeLineView[]): Draft[] => lines.map((l) => ({ ingredientId: l.ingredientId, quantity: String(l.quantity).replace(".", ","), unit: l.unit }));
const same = (a: Draft[], b: Draft[]) => JSON.stringify(a) === JSON.stringify(b);

function draftCost(lines: Draft[], byId: Map<string, Ingredient>) {
  return recipeCost(lines.flatMap((l) => {
    const ing = byId.get(l.ingredientId);
    const q = parseQty(l.quantity);
    return ing && q && q > 0 ? [{ quantity: q, unit: l.unit || ing.unit, ingredient: ing }] : [];
  }));
}

/**
 * Fiche recette dans l'éditeur de plat : ingrédients consommés par portion (unités converties), coût matière
 * et marge recalculés en direct avec le prix saisi ; recettes des options (« Alloco » → banane plantain).
 */
export function RecipeEditor({ menuItemId, price, vatRate }: { menuItemId: string; price: number; vatRate: number }) {
  const t = useTenant();
  const q = useQuery({ queryKey: tenantKeys.recipe(t.root, menuItemId), queryFn: () => t.api.recipes.dish(menuItemId), retry: false });
  const ingredients = useIngredients();
  if (q.isError) {
    if (isPlanFeatureError(q.error)) return null;
    return <Callout tone="danger">{errorMessage(q.error)}</Callout>;
  }
  if (!q.data || !ingredients.data) return <Skeleton className="h-28" />;
  return <RecipeForm recipe={q.data} ingredients={ingredients.data} price={price} vatRate={vatRate} />;
}

function RecipeForm({ recipe, ingredients, price, vatRate }: { recipe: DishRecipe; ingredients: Ingredient[]; price: number; vatRate: number }) {
  const t = useTenant();
  const qc = useQueryClient();
  const byId = React.useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const [lines, setLines] = React.useState<Draft[]>(() => toDraft(recipe.lines));
  const [openOption, setOpenOption] = React.useState<string | null>(null);
  React.useEffect(() => setLines(toDraft(recipe.lines)), [recipe]);
  const cost = draftCost(lines, byId);
  const m = dishMargin(price, vatRate, cost);
  const dirty = !same(lines, toDraft(recipe.lines));
  const save = useMutation({
    mutationFn: () => t.api.recipes.setDish(recipe.menuItemId, { lines: toBody(lines) }),
    onSuccess: (r) => { qc.setQueryData(tenantKeys.recipe(t.root, recipe.menuItemId), r); toast.success("Recette enregistrée"); },
  });

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-[13px] font-medium">Fiche recette</h3>
        <p className="text-[12.5px] text-muted-foreground">Quantités pour une portion : elles sont déduites du stock quand la cuisine lance la préparation.</p>
      </div>
      <LinesEditor lines={lines} setLines={setLines} ingredients={ingredients} byId={byId} disabled={!t.isManager} />
      {save.error && <Callout tone="danger">{errorMessage(save.error)}</Callout>}
      <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-subtle p-3 text-sm">
        <Stat label="Coût matière" value={formatFcfa(cost)} />
        <Stat label="Prix HT" value={formatFcfa(m.net)} />
        <Stat label="Marge" value={`${formatFcfa(m.margin)}${m.marginRate === null ? "" : ` · ${m.marginRate} %`}`} tone={m.margin < 0 ? "danger" : undefined} />
      </div>
      {t.isManager && (
        <div className="flex justify-end">
          <Button size="sm" variant={dirty ? "primary" : "secondary"} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Enregistrer la recette</Button>
        </div>
      )}
      {recipe.options.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] text-muted-foreground">Options (enregistrées) : ce qu'elles consomment en plus du plat.</p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {recipe.options.map((o) => (
              <li key={o.optionId}>
                <button type="button" aria-expanded={openOption === o.optionId} onClick={() => setOpenOption(openOption === o.optionId ? null : o.optionId)}
                  className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="min-w-0 flex-1 truncate"><span className="text-muted-foreground">{o.group} · </span>{o.name}</span>
                  <span className="font-mono text-[13px] text-muted-foreground tabular-nums">{o.lines.length ? `+${formatFcfa(o.cost)}` : "aucun ingrédient"}</span>
                  <ChevronDown aria-hidden className={cn("size-4 text-muted-foreground transition-transform", openOption === o.optionId && "rotate-180")} />
                </button>
                {openOption === o.optionId && <OptionRecipe optionId={o.optionId} initial={o.lines} menuItemId={recipe.menuItemId} ingredients={ingredients} byId={byId} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function OptionRecipe({ optionId, initial, menuItemId, ingredients, byId }: { optionId: string; initial: RecipeLineView[]; menuItemId: string; ingredients: Ingredient[]; byId: Map<string, Ingredient> }) {
  const t = useTenant();
  const qc = useQueryClient();
  const [lines, setLines] = React.useState<Draft[]>(() => toDraft(initial));
  const save = useMutation({
    mutationFn: () => t.api.recipes.setOption(optionId, { lines: toBody(lines) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: tenantKeys.recipe(t.root, menuItemId) }); toast.success("Recette de l'option enregistrée"); },
  });
  return (
    <div className="flex flex-col gap-3 border-t border-border bg-subtle p-3">
      <LinesEditor lines={lines} setLines={setLines} ingredients={ingredients} byId={byId} disabled={!t.isManager} />
      {save.error && <Callout tone="danger">{errorMessage(save.error)}</Callout>}
      {t.isManager && <Button size="sm" variant="secondary" className="self-end" disabled={same(lines, toDraft(initial))} loading={save.isPending} onClick={() => save.mutate()}>Enregistrer l'option</Button>}
    </div>
  );
}

function toBody(lines: Draft[]) {
  return lines.filter((l) => l.ingredientId).map((l) => ({ ingredientId: l.ingredientId, quantity: parseQty(l.quantity) ?? 0, unit: l.unit || undefined }));
}

function LinesEditor({ lines, setLines, ingredients, byId, disabled }: {
  lines: Draft[]; setLines: React.Dispatch<React.SetStateAction<Draft[]>>; ingredients: Ingredient[]; byId: Map<string, Ingredient>; disabled?: boolean;
}) {
  const set = (i: number, patch: Partial<Draft>) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  if (!ingredients.length) return <Callout tone="info">Ajoutez d'abord des ingrédients dans le stock pour composer la recette.</Callout>;
  return (
    <div className="flex flex-col gap-2">
      {lines.map((l, i) => {
        const ing = byId.get(l.ingredientId);
        const q = parseQty(l.quantity);
        const cost = ing && q && q > 0 ? Math.round(lineCostExact({ quantity: q, unit: l.unit || ing.unit, ingredient: ing })) : null;
        return (
          <div key={i} className="grid grid-cols-[1fr_96px_88px_40px] items-center gap-2">
            <NativeSelect aria-label="Ingrédient" disabled={disabled} value={l.ingredientId} onChange={(e) => set(i, { ingredientId: e.target.value, unit: byId.get(e.target.value)?.unit ?? "" })}>
              <option value="">Choisir…</option>
              {ingredients.map((x) => <option key={x.id} value={x.id} disabled={x.id !== l.ingredientId && lines.some((o) => o.ingredientId === x.id)}>{x.name}</option>)}
            </NativeSelect>
            <Input aria-label="Quantité par portion" inputMode="decimal" disabled={disabled} className="font-mono tabular-nums" value={l.quantity}
              aria-invalid={l.quantity !== "" && !(q && q > 0)} onChange={(e) => set(i, { quantity: e.target.value })} />
            <NativeSelect aria-label="Unité" disabled={disabled || !ing} value={l.unit} onChange={(e) => set(i, { unit: e.target.value as StockUnit })}>
              {(ing ? compatibleUnits(ing.unit) : []).map((u) => <option key={u} value={u}>{STOCK_UNIT_LABEL[u]}</option>)}
            </NativeSelect>
            {disabled ? <span /> : <Button variant="ghost" size="icon" aria-label="Retirer l'ingrédient" onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}><X /></Button>}
            {cost !== null && <span className="col-span-4 -mt-1 text-right font-mono text-[12px] text-muted-foreground tabular-nums">{formatFcfa(cost)}</span>}
          </div>
        );
      })}
      {!disabled && <Button variant="secondary" size="sm" className="self-start" onClick={() => setLines((ls) => [...ls, { ingredientId: "", quantity: "", unit: "" }])} disabled={lines.length >= 60}><Plus /> Ajouter un ingrédient</Button>}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("truncate font-mono text-[13px] font-medium tabular-nums", tone === "danger" && "text-danger")}>{value}</span>
    </div>
  );
}
