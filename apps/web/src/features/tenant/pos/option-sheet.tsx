import type { MenuItem } from "@restaurant/api-client";
import { Check } from "lucide-react";
import * as React from "react";
import { DishImage } from "@/components/dish-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Stepper } from "@/components/ui/stepper";
import { cn } from "@/lib/cn";
import { formatFcfa } from "@/lib/format";
import { checkSelection, defaultSelection, groupRuleLabel, MAX_QUANTITY, selectionExtra, toggleOption } from "./cart";

export interface OptionChoice { optionIds: string[]; quantity: number; instructions: string; course: number }

/** Choix des options d'un plat : min/max par groupe appliqués avant l'ajout (même règle que l'API). */
export function OptionSheet({ item, onClose, onAdd }: { item: MenuItem | null; onClose: () => void; onAdd: (item: MenuItem, c: OptionChoice) => void }) {
  const [selected, setSelected] = React.useState<string[]>([]);
  const [quantity, setQuantity] = React.useState(1);
  const [instructions, setInstructions] = React.useState("");
  const [course, setCourse] = React.useState("1");
  const [tried, setTried] = React.useState(false);

  React.useEffect(() => {
    if (!item) return;
    setSelected(defaultSelection(item.optionGroups)); setQuantity(1); setInstructions(""); setCourse("1"); setTried(false);
  }, [item]);

  if (!item) return <Dialog open={false} onOpenChange={() => undefined} title="" />;
  const checks = checkSelection(item.optionGroups, selected);
  const valid = checks.every((c) => c.ok);
  const unit = item.price + selectionExtra(item.optionGroups, selected);

  const submit = () => {
    setTried(true);
    if (!valid) {
      document.getElementById(`grp-${checks.find((c) => !c.ok)!.groupId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    onAdd(item, { optionIds: selected, quantity, instructions, course: Number(course) });
  };

  return (
    <Dialog
      open={!!item}
      onOpenChange={(o) => !o && onClose()}
      size="md"
      title={item.name}
      description={<span className="font-mono">{formatFcfa(item.price)}</span>}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Stepper label="quantité" value={quantity} min={1} max={MAX_QUANTITY} size="lg" onChange={(v) => setQuantity(Math.max(1, v))} className="self-center sm:self-auto" />
          <Button variant="primary" size="lg" className="h-12 min-w-[200px]" onClick={submit} aria-disabled={!valid}>
            Ajouter · <span className="font-mono tabular-nums">{formatFcfa(unit * quantity)}</span>
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {item.imageUrl && <DishImage src={item.imageUrl} loading="eager" className="aspect-[16/7] w-full rounded-lg" />}
        {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
        {item.optionGroups.map((g, gi) => {
          const c = checks[gi]!;
          const single = g.maxChoices === 1;
          return (
            <fieldset key={g.id} id={`grp-${g.id}`} className="flex flex-col gap-2">
              <legend className="mb-2 flex w-full items-center justify-between gap-2">
                <span className="text-sm font-semibold">{g.name}</span>
                <Badge tone={g.minChoices > 0 ? (tried && !c.ok ? "red" : "amber") : "outline"}>{groupRuleLabel(g)}</Badge>
              </legend>
              <div role={single ? "radiogroup" : "group"} aria-label={g.name} className="grid gap-2 sm:grid-cols-2">
                {g.options.map((o) => {
                  const on = selected.includes(o.id);
                  const blocked = !on && !single && c.full;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role={single ? "radio" : "checkbox"}
                      aria-checked={on}
                      disabled={blocked}
                      onClick={() => setSelected((s) => toggleOption(item.optionGroups, s, o.id))}
                      className={cn(
                        "flex min-h-12 items-center gap-3 rounded-lg border px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        on ? "border-brand-ink bg-brand-tint font-medium" : "border-border hover:bg-hover",
                        blocked && "opacity-40",
                      )}
                    >
                      <span aria-hidden className={cn("flex size-5 shrink-0 items-center justify-center border", single ? "rounded-full" : "rounded-[5px]", on ? "border-brand-ink bg-brand text-brand-foreground" : "border-border-strong")}>
                        {on && <Check className="size-3.5" strokeWidth={3} />}
                      </span>
                      <span className="flex-1">{o.name}</span>
                      {o.extra > 0 && <span className="font-mono text-[13px] text-muted-foreground tabular-nums">+{formatFcfa(o.extra)}</span>}
                    </button>
                  );
                })}
              </div>
              {tried && c.message && <p role="alert" className="text-[12.5px] text-danger">{c.message}</p>}
            </fieldset>
          );
        })}
        <Field label="Consigne pour la cuisine" hint="Ex. sans piment, bien cuit, sauce à part.">
          <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={200} className="min-h-[64px]" />
        </Field>
        <Field label="Envoi">
          <Segmented ariaLabel="Envoi" value={course} onChange={setCourse} options={[{ value: "1", label: "1er envoi" }, { value: "2", label: "2e envoi" }, { value: "3", label: "3e envoi" }]} />
        </Field>
      </div>
    </Dialog>
  );
}
