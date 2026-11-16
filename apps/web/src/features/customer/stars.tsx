import { Star } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/cn";

const FILLED = "fill-[var(--tone-amber-dot)] text-[var(--tone-amber-dot)]";

/** Note affichée (étoiles pleines, lisible aussi par les lecteurs d'écran : « 4 sur 5 »). */
export function Stars({ value, size = 16, className }: { value: number; size?: number; className?: string }) {
  const full = Math.round(value);
  return (
    <span role="img" aria-label={`${value.toLocaleString("fr-FR")} sur 5`} className={cn("inline-flex items-center gap-0.5", className)}>
      {[1, 2, 3, 4, 5].map((n) => <Star key={n} aria-hidden style={{ width: size, height: size }} className={n <= full ? FILLED : "text-border-strong"} />)}
    </span>
  );
}

const WORDS = ["", "Décevant", "Moyen", "Bien", "Très bien", "Excellent"];

/** Choix d'une note de 1 à 5 : cibles de 44 px, flèches du clavier, libellé de la note choisie. */
export function StarInput({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = Math.min(5, Math.max(1, i + 1 + d));
    onChange(n);
    refs.current[n - 1]?.focus();
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div role="radiogroup" aria-label="Note de 1 à 5" className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n, i) => (
          <button
            key={n} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={value === n} aria-label={`${n} sur 5`} disabled={disabled}
            tabIndex={value === n || (!value && n === 1) ? 0 : -1} onClick={() => onChange(n)} onKeyDown={(e) => onKey(e, i)}
            className="flex size-11 items-center justify-center rounded-md transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 motion-reduce:transition-none motion-reduce:hover:scale-100"
          >
            <Star className={cn("size-8", n <= value ? FILLED : "text-border-strong")} aria-hidden />
          </button>
        ))}
      </div>
      <p className="h-5 text-sm text-muted-foreground" aria-live="polite">{value ? WORDS[value] : "Touchez une étoile"}</p>
    </div>
  );
}
