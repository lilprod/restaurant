import type { Formula } from "@restaurant/api-client";
import { Check, ChevronLeft } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Stepper } from "@/components/ui/stepper";
import { cn } from "@/lib/cn";
import { formatFcfa } from "@/lib/format";
import { checkFormula, MAX_QUANTITY, togglePick } from "./cart";

export interface FormulaChoice { choices: { stepId: string; stepName: string; menuItemId: string; name: string }[]; quantity: number; instructions: string; course: number }

/** Assistant d'étapes d'une formule : un écran par étape (Entrée, Plat, Dessert…), puis récapitulatif et ajout au panier. */
export function FormulaSheet({ formula, unavailable, onClose, onAdd }: { formula: Formula | null; /** Plats hors horaires (refusés par l'API). */ unavailable?: Set<string>; onClose: () => void; onAdd: (f: Formula, c: FormulaChoice) => void }) {
  const [step, setStep] = React.useState(0);
  const [picks, setPicks] = React.useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = React.useState(1);
  const [instructions, setInstructions] = React.useState("");
  const [course, setCourse] = React.useState("1");

  React.useEffect(() => {
    if (formula) { setStep(0); setPicks({}); setQuantity(1); setInstructions(""); setCourse("1"); }
  }, [formula]);

  if (!formula) return <Dialog open={false} onOpenChange={() => undefined} title="" />;
  const steps = formula.steps;
  const checks = checkFormula(steps, picks);
  const last = step === steps.length - 1;
  const current = steps[step]!;
  const currentCheck = checks[step]!;
  const allOk = checks.every((c) => c.ok);

  const add = () => {
    const choices = steps.flatMap((s) => (picks[s.id] ?? []).map((id) => ({
      stepId: s.id, stepName: s.name, menuItemId: id, name: s.items.find((i) => i.menuItemId === id)?.name ?? "",
    })));
    onAdd(formula, { choices, quantity, instructions, course: Number(course) });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="md"
      title={formula.name}
      description={<span className="font-mono">{formatFcfa(formula.price)}</span>}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {last ? <Stepper label="quantité" value={quantity} min={1} max={MAX_QUANTITY} size="lg" onChange={(v) => setQuantity(Math.max(1, v))} className="self-center sm:self-auto" /> : (
            <Button variant="ghost" size="lg" className="h-12" disabled={step === 0} onClick={() => setStep(step - 1)}><ChevronLeft /> Précédent</Button>
          )}
          <div className="flex gap-2">
            {last && step > 0 && <Button variant="secondary" size="lg" className="h-12" onClick={() => setStep(step - 1)}><ChevronLeft /> Précédent</Button>}
            {last ? (
              <Button variant="primary" size="lg" className="h-12 min-w-[180px]" disabled={!allOk} onClick={add}>
                Ajouter · <span className="font-mono tabular-nums">{formatFcfa(formula.price * quantity)}</span>
              </Button>
            ) : (
              <Button variant="primary" size="lg" className="h-12 min-w-[160px]" disabled={!currentCheck.ok} onClick={() => setStep(step + 1)}>Suivant</Button>
            )}
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {formula.description && <p className="text-sm text-muted-foreground">{formula.description}</p>}
        <ol aria-label="Étapes" className="flex items-center gap-2 overflow-x-auto">
          {steps.map((s, i) => {
            const done = checks[i]!.ok && i < step;
            return (
              <li key={s.id} className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined}
                  className={cn("flex h-9 items-center gap-2 rounded-full border px-3 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    i === step ? "border-transparent bg-foreground text-background" : "border-border text-muted-foreground hover:bg-hover")}>
                  <span className={cn("flex size-5 items-center justify-center rounded-full font-mono text-[11px]", i === step ? "bg-background/20" : "bg-subtle")}>
                    {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                  </span>
                  {s.name}
                </button>
              </li>
            );
          })}
        </ol>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold">
            {current.name}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {current.maxChoices === 1 ? "1 plat à choisir" : `${current.minChoices === 0 ? "jusqu'à" : `${current.minChoices} à`} ${current.maxChoices} plats`}
            </span>
          </legend>
          <div role={current.maxChoices === 1 ? "radiogroup" : "group"} aria-label={current.name} className="grid gap-2 sm:grid-cols-2">
            {current.items.map((it) => {
              const on = (picks[current.id] ?? []).includes(it.menuItemId);
              const off = !it.isAvailable || !!unavailable?.has(it.menuItemId);
              const blocked = off || (!on && current.maxChoices > 1 && currentCheck.full);
              return (
                <button key={it.menuItemId} type="button" role={current.maxChoices === 1 ? "radio" : "checkbox"} aria-checked={on} disabled={blocked}
                  onClick={() => setPicks((p) => togglePick(current, p, it.menuItemId))}
                  className={cn("flex min-h-14 items-center gap-3 rounded-lg border px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on ? "border-brand-ink bg-brand-tint font-medium" : "border-border hover:bg-hover", blocked && "opacity-40")}>
                  <span aria-hidden className={cn("flex size-5 shrink-0 items-center justify-center border", current.maxChoices === 1 ? "rounded-full" : "rounded-[5px]", on ? "border-brand-ink bg-brand text-brand-foreground" : "border-border-strong")}>
                    {on && <Check className="size-3.5" strokeWidth={3} />}
                  </span>
                  <span className="flex-1">{it.name}</span>
                  {off && <span className="text-xs text-muted-foreground">{it.isAvailable ? "Hors horaires" : "Épuisé"}</span>}
                </button>
              );
            })}
          </div>
        </fieldset>

        {last && (
          <>
            <Field label="Consigne pour la cuisine" hint="Ex. sans piment, sauce à part.">
              <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={200} className="min-h-[64px]" />
            </Field>
            <Field label="Envoi">
              <Segmented ariaLabel="Envoi" value={course} onChange={setCourse} options={[{ value: "1", label: "1er envoi" }, { value: "2", label: "2e envoi" }, { value: "3", label: "3e envoi" }]} />
            </Field>
            {!allOk && <p role="status" className="text-[12.5px] text-danger">Complétez toutes les étapes pour ajouter la formule.</p>}
          </>
        )}
      </div>
    </Dialog>
  );
}
