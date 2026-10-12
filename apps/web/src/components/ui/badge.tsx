import { statusTone, type StatusTone } from "@restaurant/ui-tokens";
import * as React from "react";
import { cn } from "@/lib/cn";

const toneClass: Record<StatusTone, string> = {
  blue: "bg-[var(--tone-blue-bg)] text-[var(--tone-blue-fg)]",
  green: "bg-[var(--tone-green-bg)] text-[var(--tone-green-fg)]",
  amber: "bg-[var(--tone-amber-bg)] text-[var(--tone-amber-fg)]",
  red: "bg-[var(--tone-red-bg)] text-[var(--tone-red-fg)]",
  gray: "bg-[var(--tone-gray-bg)] text-[var(--tone-gray-fg)]",
};
const dotClass: Record<StatusTone, string> = {
  blue: "bg-[var(--tone-blue-dot)]", green: "bg-[var(--tone-green-dot)]", amber: "bg-[var(--tone-amber-dot)]",
  red: "bg-[var(--tone-red-dot)]", gray: "bg-[var(--tone-gray-dot)]",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone | "outline" | "brand";
  dot?: boolean;
}

export function Badge({ tone = "gray", dot, className, children, ...props }: BadgeProps) {
  const base = "inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium leading-none";
  const cls =
    tone === "outline" ? "border border-border text-muted-foreground" :
    tone === "brand" ? "bg-brand-tint text-brand-ink" : toneClass[tone];
  return (
    <span className={cn(base, cls, className)} {...props}>
      {dot && tone !== "outline" && tone !== "brand" && <span aria-hidden className={cn("size-1.5 rounded-full", dotClass[tone])} />}
      {children}
    </span>
  );
}

/**
 * Badge de statut : couleur dérivée de la règle commune (@restaurant/ui-tokens). `toneOf` choisit une autre table
 * de la même source (ex. `orderStatusTone` pour les commandes, `tableStatusTone` pour les tables).
 */
export function StatusBadge({ status, labels, className, toneOf = statusTone }: {
  status: string | null | undefined; labels: Record<string, string>; className?: string; toneOf?: (s: string) => StatusTone;
}) {
  if (!status) return <Badge tone="gray" className={className}>—</Badge>;
  return (
    <Badge tone={toneOf(status)} dot className={className}>
      {labels[status] ?? status}
    </Badge>
  );
}

/** Pastille de couleur seule (accompagne toujours un texte). */
export { dotClass as toneDotClass, toneClass as toneSurfaceClass };

export function ToneDot({ tone, className }: { tone: StatusTone; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full", dotClass[tone], className)} />;
}
