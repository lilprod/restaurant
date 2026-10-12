import type { PublicPlan } from "@restaurant/api-client";
import { Check } from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/cn";
import { formatFcfa } from "@/lib/format";
import { FEATURE_LABEL } from "@/lib/labels";

/** Choix d'un plan en cartes (radiogroup accessible au clavier). */
export function PlanPicker({ plans, value, onChange, cycle = "MONTHLY", compact, id }: {
  plans: PublicPlan[]; value?: string; onChange: (id: string) => void; cycle?: "MONTHLY" | "YEARLY"; compact?: boolean; id?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const groupId = React.useId();
  return (
    <div id={id} role="radiogroup" aria-label="Plan" className={cn("grid gap-3", compact ? "sm:grid-cols-3" : "md:grid-cols-3")}>
      {plans.map((p, i) => {
        const active = p.id === value;
        const features = Object.entries(p.features ?? {}).filter(([, on]) => on).map(([k]) => FEATURE_LABEL[k] ?? k);
        return (
          <button
            key={p.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active || (!value && i === 0) ? 0 : -1}
            onClick={() => onChange(p.id)}
            onKeyDown={(e) => {
              const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
              if (!d) return;
              e.preventDefault();
              const n = (i + d + plans.length) % plans.length;
              onChange(plans[n]!.id);
              refs.current[n]?.focus();
            }}
            className={cn(
              "relative flex flex-col gap-3 rounded-lg border bg-card p-4 text-left shadow-xs transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "border-transparent shadow-md" : "border-border hover:border-border-strong",
            )}
          >
            {active && (
              <motion.span layoutId={`plan-ring-${groupId}`} className="pointer-events-none absolute -inset-px rounded-lg ring-2 ring-[var(--brand-ink)]" transition={{ type: "spring", stiffness: 500, damping: 40 }} />
            )}
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col">
                <span className="text-sm font-semibold">{p.name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{p.code}</span>
              </div>
              <span className={cn("flex size-5 items-center justify-center rounded-full border transition-colors", active ? "border-transparent bg-brand text-brand-foreground" : "border-border-strong")}>
                {active && <Check className="size-3" strokeWidth={3} />}
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-1">
              <span className={cn("whitespace-nowrap font-mono font-semibold tracking-tight tabular", compact ? "text-lg" : "text-xl")}>{formatFcfa(cycle === "YEARLY" ? p.priceYearly : p.priceMonthly)}</span>
              <span className="text-xs text-muted-foreground">/ {cycle === "YEARLY" ? "an" : "mois"}</span>
            </div>
            {!compact && (
              <>
                {p.description && <p className="text-[13px] text-muted-foreground">{p.description}</p>}
                <ul className="flex flex-col gap-1.5 text-[13px]">
                  <li className="text-muted-foreground">{p.trialDays > 0 ? `${p.trialDays} jours d'essai gratuit` : "Sans essai"}</li>
                  <li className="text-muted-foreground">{p.maxUsers ? `${p.maxUsers} utilisateurs` : "Utilisateurs illimités"} · {p.maxTables ? `${p.maxTables} tables` : "tables illimitées"}</li>
                  {features.slice(0, 5).map((f) => (
                    <li key={f} className="flex items-center gap-2"><Check className="size-3.5 text-success" /> {f}</li>
                  ))}
                </ul>
              </>
            )}
            {compact && <span className="text-xs text-muted-foreground">{p.trialDays > 0 ? `${p.trialDays} j d'essai` : "Sans essai"} · {p.maxUsers ?? "∞"} utilisateurs</span>}
          </button>
        );
      })}
    </div>
  );
}
