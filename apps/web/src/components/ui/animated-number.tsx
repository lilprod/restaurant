import { animate, useReducedMotion } from "motion/react";
import * as React from "react";

/** Compteur animé (KPI). Respecte prefers-reduced-motion : affiche directement la valeur finale. */
export function AnimatedNumber({ value, format = (n) => new Intl.NumberFormat("fr-FR").format(n), className }: {
  value: number; format?: (n: number) => string; className?: string;
}) {
  const reduce = useReducedMotion();
  const ref = React.useRef<HTMLSpanElement>(null);
  const prev = React.useRef(0);
  const fmt = React.useRef(format);
  fmt.current = format;
  React.useEffect(() => {
    const format = fmt.current;
    const el = ref.current;
    if (!el) return;
    if (reduce) { el.textContent = format(value); prev.current = value; return; }
    const controls = animate(prev.current, value, {
      duration: 0.7,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => { el.textContent = format(Math.round(v)); },
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, reduce]);
  return <span ref={ref} className={className} aria-label={format(value)}>{format(reduce ? value : prev.current)}</span>;
}
