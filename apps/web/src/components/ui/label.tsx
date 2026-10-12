import { Label as LabelPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/cn";

export const Label = React.forwardRef<HTMLLabelElement, React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>>(
  ({ className, ...props }, ref) => (
    <LabelPrimitive.Root ref={ref} className={cn("text-[13px] font-medium leading-none text-foreground", className)} {...props} />
  ),
);
Label.displayName = "Label";

/** Petit libellé en capitales (sections, métadonnées). */
export function Eyebrow({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground", className)} {...props} />;
}
