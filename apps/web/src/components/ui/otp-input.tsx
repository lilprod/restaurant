import { motion } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/cn";

interface OtpInputProps {
  value: string;
  onChange: (v: string) => void;
  /** Appelé quand les 6 chiffres sont saisis (soumission automatique). */
  onComplete?: (v: string) => void;
  length?: number;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  id?: string;
  "aria-describedby"?: string;
}

/**
 * Saisie d'un code à usage unique : une case par chiffre, avance automatique, retour arrière,
 * flèches, collage du code complet, et `autocomplete="one-time-code"` pour le remplissage iOS/Android.
 */
export function OtpInput({ value, onChange, onComplete, length = 6, disabled, invalid, autoFocus, id, ...aria }: OtpInputProps) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  const focus = (i: number) => {
    const el = refs.current[Math.max(0, Math.min(length - 1, i))];
    el?.focus();
    el?.select();
  };

  const commit = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  };

  React.useEffect(() => { if (autoFocus) focus(0); }, [autoFocus]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <motion.div
      className="flex items-center justify-between gap-1.5 sm:gap-2"
      animate={invalid ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
      transition={{ duration: 0.3 }}
      role="group"
      aria-label="Code de vérification"
    >
      {digits.map((d, i) => (
        <React.Fragment key={i}>
          {i === length / 2 && <span aria-hidden className="h-px w-2 shrink-0 bg-border-strong sm:w-3" />}
          <input
            ref={(el) => { refs.current[i] = el; }}
            id={i === 0 ? id : undefined}
            {...(i === 0 ? aria : {})}
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            pattern="[0-9]*"
            maxLength={length}
            disabled={disabled}
            aria-label={`Chiffre ${i + 1} sur ${length}`}
            aria-invalid={invalid || undefined}
            value={d}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              const typed = e.target.value.replace(/\D/g, "");
              if (!typed) return;
              if (typed.length > 1) {
                // Collage ou remplissage automatique : on répartit à partir de cette case.
                const next = (value.slice(0, i) + typed).slice(0, length);
                commit(next);
                focus(next.length);
                return;
              }
              const arr = digits.slice();
              arr[i] = typed;
              const next = arr.join("").slice(0, length);
              commit(next);
              if (i < length - 1) focus(i + 1);
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace") {
                e.preventDefault();
                const arr = digits.slice();
                if (arr[i]) { arr[i] = ""; onChange(arr.join("")); }
                else if (i > 0) { arr[i - 1] = ""; onChange(arr.join("")); focus(i - 1); }
              } else if (e.key === "ArrowLeft") { e.preventDefault(); focus(i - 1); }
              else if (e.key === "ArrowRight") { e.preventDefault(); focus(i + 1); }
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text").replace(/\D/g, "");
              if (!text) return;
              e.preventDefault();
              commit(text);
              focus(Math.min(text.length, length - 1));
            }}
            className={cn(
              "h-12 w-full min-w-0 max-w-12 rounded-md border border-input bg-background text-center font-mono text-xl font-medium shadow-xs transition-[border-color,box-shadow] sm:h-14",
              "focus:border-brand-ink focus:outline-none focus:ring-[3px] focus:ring-ring/40",
              d && "border-border-strong",
              invalid && "border-danger",
              disabled && "opacity-60",
            )}
          />
        </React.Fragment>
      ))}
    </motion.div>
  );
}
