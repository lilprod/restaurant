import type { Totals } from "@restaurant/utils";
import { ChefHat, ChevronDown, MessageSquareWarning, ShoppingCart, TriangleAlert } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Stepper } from "@/components/ui/stepper";
import { cn } from "@/lib/cn";
import { formatFcfa } from "@/lib/format";
import { courseLabel } from "@/lib/labels";
import { cartCount, cartLineTotal, MAX_QUANTITY, type CartAction, type CartLine } from "./cart";

interface CartPanelProps {
  lines: CartLine[];
  dispatch: (a: CartAction) => void;
  totals: Totals;
  serviceChargePercent: number;
  /** Plats devenus indisponibles depuis l'ajout. */
  unavailable: Set<string>;
  notes?: { value: string; onChange: (v: string) => void };
  submitLabel: string;
  onSubmit: () => void;
  submitting: boolean;
  className?: string;
  /** Masque l'en-tête « Panier » (déjà titré par la boîte de dialogue sur téléphone). */
  hideHeader?: boolean;
}

/** Panier : quantités, consignes, envoi (1er, 2e…), totaux en direct et envoi en cuisine. */
export function CartPanel({ lines, dispatch, totals, serviceChargePercent, unavailable, notes, submitLabel, onSubmit, submitting, className, hideHeader }: CartPanelProps) {
  const [open, setOpen] = React.useState<string | null>(null);
  const [showNotes, setShowNotes] = React.useState(false);
  const blocked = lines.some((l) => unavailable.has(l.menuItemId));
  const count = cartCount(lines);
  return (
    <div className={cn("flex min-h-0 flex-col bg-background", className)}>
      <div className={cn("flex h-12 shrink-0 items-center justify-between border-b border-border px-4", hideHeader && "hidden")}>
        <h2 className="text-sm font-semibold">Panier</h2>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">{count} article{count > 1 ? "s" : ""}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
            <span className="flex size-11 items-center justify-center rounded-full border border-border bg-subtle"><ShoppingCart className="size-5 text-muted-foreground" /></span>
            <p className="text-sm font-medium">Panier vide</p>
            <p className="text-[13px] text-muted-foreground">Touchez un plat pour l'ajouter.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {lines.map((l) => {
              const bad = unavailable.has(l.menuItemId);
              const expanded = open === l.key;
              return (
                <li key={l.key} className={cn("flex flex-col gap-2 px-4 py-3", bad && "bg-[var(--tone-red-bg)]")}>
                  <div className="flex items-start gap-2">
                    <button type="button" onClick={() => setOpen(expanded ? null : l.key)} aria-expanded={expanded}
                      className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="flex w-full items-start justify-between gap-2">
                        <span className="text-sm font-medium leading-snug">{l.name}</span>
                        <span className="shrink-0 font-mono text-sm tabular-nums">{formatFcfa(cartLineTotal(l))}</span>
                      </span>
                      {l.options.length > 0 && <span className="text-xs text-muted-foreground">{l.options.map((o) => o.name).join(" · ")}</span>}
                      {l.instructions && <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--tone-amber-fg)]"><MessageSquareWarning className="size-3" />{l.instructions}</span>}
                      <span className="inline-flex items-center gap-1 text-[11px] text-faint">{l.course > 1 && <>{courseLabel(l.course)} · </>}Consigne, envoi <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} /></span>
                    </button>
                  </div>
                  {bad && <p role="alert" className="flex items-center gap-1.5 text-xs font-medium text-[var(--tone-red-fg)]"><TriangleAlert className="size-3.5" /> Épuisé : retirez ce plat pour envoyer la commande.</p>}
                  {expanded && (
                    <div className="flex flex-col gap-2 rounded-md border border-border bg-subtle p-2">
                      <label className="sr-only" htmlFor={`ins-${l.key}`}>Consigne pour {l.name}</label>
                      <Textarea id={`ins-${l.key}`} placeholder="Consigne (sans piment, bien cuit…)" defaultValue={l.instructions} maxLength={200} className="min-h-[56px] bg-background"
                        onBlur={(e) => dispatch({ type: "update", key: l.key, patch: { instructions: e.target.value } })} />
                      <Segmented ariaLabel={`Envoi pour ${l.name}`} size="sm" value={String(l.course)} onChange={(v) => dispatch({ type: "update", key: l.key, patch: { course: Number(v) } })}
                        options={[{ value: "1", label: "1er envoi" }, { value: "2", label: "2e" }, { value: "3", label: "3e" }]} />
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">{formatFcfa(l.unitPrice + l.options.reduce((n, o) => n + o.extra, 0))} l'unité</span>
                    <Stepper label={l.name} value={l.quantity} max={MAX_QUANTITY} removable onChange={(v) => dispatch({ type: "quantity", key: l.key, quantity: v })} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="shrink-0 border-t border-border bg-subtle p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {notes && (
          <div className="mb-3">
            {showNotes || notes.value ? (
              <>
                <label htmlFor="order-notes" className="mb-1 block text-xs font-medium text-muted-foreground">Note pour la commande</label>
                <Textarea id="order-notes" value={notes.value} onChange={(e) => notes.onChange(e.target.value)} maxLength={300} className="min-h-[52px] bg-background" placeholder="Anniversaire, allergie à la table…" />
              </>
            ) : (
              <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setShowNotes(true)}>+ Ajouter une note</Button>
            )}
          </div>
        )}
        <dl className="mb-3 flex flex-col gap-1 text-sm">
          <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Sous-total</dt><dd className="font-mono tabular-nums">{formatFcfa(totals.subtotal)}</dd></div>
          {totals.serviceCharge > 0 && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Service ({serviceChargePercent} %)</dt><dd className="font-mono tabular-nums">{formatFcfa(totals.serviceCharge)}</dd></div>}
          <div className="flex justify-between gap-2 text-base font-semibold"><dt>Total</dt><dd className="font-mono tabular-nums">{formatFcfa(totals.total)}</dd></div>
          <div className="flex justify-between gap-2 text-xs text-faint"><dt>dont TVA</dt><dd className="font-mono tabular-nums">{formatFcfa(totals.vat)}</dd></div>
        </dl>
        <Button variant="primary" size="lg" className="h-14 w-full text-base" disabled={!lines.length || blocked} loading={submitting} onClick={onSubmit}>
          <ChefHat className="!size-5" /> {submitLabel}
        </Button>
      </div>
    </div>
  );
}
