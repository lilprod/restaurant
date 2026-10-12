import { motion } from "motion/react";
import { Switch as SwitchPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/cn";

export const Switch = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(
  ({ className, checked, ...props }, ref) => (
    <SwitchPrimitive.Root
      ref={ref}
      checked={checked}
      className={cn(
        "peer relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-transparent p-0.5 transition-colors duration-200",
        "bg-border-strong data-[state=checked]:bg-brand",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        // zone tactile élargie (44px) sans changer le visuel
        "before:absolute before:-inset-2.5 before:content-['']",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb asChild>
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 700, damping: 35 }}
          className={cn("pointer-events-none block size-5 rounded-full bg-white shadow-sm", "data-[state=checked]:ml-auto")}
        />
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  ),
);
Switch.displayName = "Switch";

/** Ligne « libellé + description + interrupteur ». */
export function SwitchRow({
  label, description, checked, onCheckedChange, disabled, id,
}: { label: React.ReactNode; description?: React.ReactNode; checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; id?: string }) {
  const autoId = React.useId();
  const sid = id ?? autoId;
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <label htmlFor={sid} className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {description && <span className="text-[13px] text-muted-foreground">{description}</span>}
      </label>
      <Switch id={sid} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="mt-0.5" />
    </div>
  );
}
