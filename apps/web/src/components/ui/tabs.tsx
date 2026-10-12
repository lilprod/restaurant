import { motion } from "motion/react";
import { Tabs as TabsPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/cn";

const TabsCtx = React.createContext<{ value?: string; id: string }>({ id: "" });

export function Tabs({ value, defaultValue, onValueChange, className, children }: {
  value?: string; defaultValue?: string; onValueChange?: (v: string) => void; className?: string; children: React.ReactNode;
}) {
  const [inner, setInner] = React.useState(defaultValue);
  const current = value ?? inner;
  const id = React.useId();
  return (
    <TabsCtx.Provider value={{ value: current, id }}>
      <TabsPrimitive.Root
        value={current}
        onValueChange={(v) => { setInner(v); onValueChange?.(v); }}
        className={cn("flex min-w-0 flex-col", className)}
      >
        {children}
      </TabsPrimitive.Root>
    </TabsCtx.Provider>
  );
}

/** Onglets soulignés façon Vercel, avec indicateur animé (layoutId) et défilement horizontal sur mobile. */
export function TabsList({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("relative -mx-4 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0", className)}>
      <TabsPrimitive.List className="flex min-w-max items-center gap-1 border-b border-border">
        {children}
      </TabsPrimitive.List>
    </div>
  );
}

export function TabsTrigger({ value, children, className, count }: { value: string; children: React.ReactNode; className?: string; count?: number }) {
  const ctx = React.useContext(TabsCtx);
  const active = ctx.value === value;
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        "relative flex h-11 items-center gap-2 px-3 text-sm text-muted-foreground transition-colors hover:text-foreground sm:h-10",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring rounded-t-md",
        active && "text-foreground",
        className,
      )}
    >
      <span className="relative z-10">{children}</span>
      {count !== undefined && (
        <span className={cn("relative z-10 rounded-full px-1.5 text-[11px] font-medium tabular", active ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}>
          {count}
        </span>
      )}
      {active && (
        <motion.span
          layoutId={`tab-underline-${ctx.id}`}
          className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-foreground"
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
        />
      )}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ value, className, children }: { value: string; className?: string; children: React.ReactNode }) {
  return (
    <TabsPrimitive.Content value={value} className={cn("pt-6 focus-visible:outline-none", className)}>
      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
        {children}
      </motion.div>
    </TabsPrimitive.Content>
  );
}
