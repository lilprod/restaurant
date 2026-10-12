import { motion } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/cn";

/** État vide : icône, explication courte et prochaine action claire. */
export function EmptyState({ icon, title, description, action, className }: {
  icon?: React.ReactNode; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
      className={cn("flex flex-col items-center justify-center gap-3 px-6 py-14 text-center", className)}
    >
      {icon && (
        <div className="relative mb-1 flex size-12 items-center justify-center rounded-xl border border-border bg-background shadow-sm [&_svg]:size-5 [&_svg]:text-muted-foreground">
          <div aria-hidden className="absolute -inset-3 -z-10 rounded-2xl border border-dashed border-border" />
          {icon}
        </div>
      )}
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-[15px] font-semibold">{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </motion.div>
  );
}
