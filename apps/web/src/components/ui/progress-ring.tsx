import { motion } from "motion/react";
import { cn } from "@/lib/cn";

/** Anneau de progression (jours restants de licence…). `value` de 0 à 1. */
export function ProgressRing({ value, size = 120, stroke = 8, className, children, tone = "brand" }: {
  value: number; size?: number; stroke?: number; className?: string; children?: React.ReactNode; tone?: "brand" | "amber" | "red";
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const color = tone === "amber" ? "var(--tone-amber-dot)" : tone === "red" ? "var(--tone-red-dot)" : "var(--brand-ink)";
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - v) }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}
