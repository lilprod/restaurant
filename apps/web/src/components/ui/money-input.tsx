import * as React from "react";
import { cn } from "@/lib/cn";
import { Input, type InputProps } from "./input";

/** Lit une saisie de montant FCFA (« 12 500 », « 12500 ») en entier ; chaîne vide → null. */
export function parseAmount(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  return Math.min(100_000_000, Number(digits));
}

/** Champ de montant en FCFA : clavier numérique, chiffres groupés, suffixe « FCFA ». */
export const MoneyInput = React.forwardRef<HTMLInputElement, Omit<InputProps, "value" | "onChange" | "type"> & {
  value: number | null; onValueChange: (v: number | null) => void;
}>(({ value, onValueChange, className, ...props }, ref) => (
  <Input
    ref={ref}
    type="text"
    inputMode="numeric"
    autoComplete="off"
    value={value === null || Number.isNaN(value) ? "" : new Intl.NumberFormat("fr-FR").format(value)}
    onChange={(e) => onValueChange(parseAmount(e.target.value))}
    trailing={<span className="pr-2 text-xs font-medium text-muted-foreground">FCFA</span>}
    className={cn("pr-14 font-mono tabular-nums", className)}
    {...props}
  />
));
MoneyInput.displayName = "MoneyInput";
