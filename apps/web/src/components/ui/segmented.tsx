import { motion } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/cn";

interface Option<T extends string> { value: T; label: React.ReactNode; icon?: React.ReactNode }

/** Contrôle segmenté (radiogroup accessible) avec pastille animée. */
export function Segmented<T extends string>({
  value, onChange, options, className, ariaLabel, size = "md", disabled,
}: { value: T; onChange: (v: T) => void; options: Option<T>[]; className?: string; ariaLabel: string; size?: "sm" | "md"; disabled?: boolean }) {
  const id = React.useId();
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = (i + d + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex w-full rounded-lg border border-border bg-muted p-1 sm:w-auto", className)}>
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              size === "sm" ? "h-9 text-[13px] sm:h-7" : "h-10 text-sm sm:h-8",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-md bg-background shadow-sm ring-1 ring-border"
                transition={{ type: "spring", stiffness: 600, damping: 40 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5 [&_svg]:size-4">{o.icon}{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
