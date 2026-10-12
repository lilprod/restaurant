import { Minus, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Sélecteur de quantité tactile (−  2  +). `removable` remplace « − » par une corbeille à 1.
 * Tailles : `md` (44px sous sm, 32px au-delà), `lg` (48px, tablettes de salle).
 */
export function Stepper({ value, onChange, min = 0, max = 99, size = "md", label, removable, className }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; size?: "md" | "lg"; label: string; removable?: boolean; className?: string;
}) {
  const btn = cn(
    "flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground active:scale-95",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
    size === "lg" ? "size-12" : "size-11 sm:size-8",
  );
  const atMin = value <= min;
  const showTrash = removable && value <= Math.max(1, min + 1);
  return (
    <div role="group" aria-label={label} className={cn("inline-flex items-center rounded-lg border border-border bg-background p-0.5 shadow-xs", className)}>
      <button type="button" className={cn(btn, showTrash && "hover:text-danger")} onClick={() => onChange(value - 1)} disabled={!removable && atMin}
        aria-label={showTrash ? `Retirer ${label}` : `Diminuer ${label}`}>
        {showTrash ? <Trash2 className="size-4" /> : <Minus className="size-4" />}
      </button>
      <output aria-live="polite" className={cn("min-w-8 text-center font-mono font-semibold tabular-nums", size === "lg" ? "text-lg" : "text-sm")}>{value}</output>
      <button type="button" className={btn} onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`Augmenter ${label}`}>
        <Plus className="size-4" />
      </button>
    </div>
  );
}
