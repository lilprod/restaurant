import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Dialog as DialogPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/cn";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  /** Empêche la fermeture par clic extérieur (formulaires longs, opérations en cours). */
  dismissable?: boolean;
  size?: "sm" | "md" | "lg";
}

const sizes = { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-2xl" };

/**
 * Boîte de dialogue : centrée sur grand écran, « bottom sheet » sur mobile.
 * Ouverture rapide (180 ms), focus piégé par Radix, Échap pour fermer.
 */
export function Dialog({ open, onOpenChange, title, description, children, footer, className, dismissable = true, size = "md" }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-[var(--overlay)] backdrop-blur-[2px]"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content
              asChild
              forceMount
              onPointerDownOutside={(e) => { if (!dismissable) e.preventDefault(); }}
              onInteractOutside={(e) => { if (!dismissable) e.preventDefault(); }}
            >
              <motion.div
                className={cn(
                  "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-xl border border-border bg-popover shadow-lg",
                  "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl",
                  sizes[size],
                  className,
                )}
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex items-start justify-between gap-4 px-5 pb-1 pt-5 sm:px-6">
                  <div className="flex min-w-0 flex-col gap-1">
                    <DialogPrimitive.Title className="text-base font-semibold tracking-tight">{title}</DialogPrimitive.Title>
                    {description ? (
                      <DialogPrimitive.Description className="text-sm text-muted-foreground">{description}</DialogPrimitive.Description>
                    ) : (
                      <DialogPrimitive.Description className="sr-only">{typeof title === "string" ? title : "Boîte de dialogue"}</DialogPrimitive.Description>
                    )}
                  </div>
                  <DialogPrimitive.Close
                    className="-mr-2 -mt-1 inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-8"
                    aria-label="Fermer"
                  >
                    <X className="size-4" />
                  </DialogPrimitive.Close>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">{children}</div>
                {footer && (
                  <div className="flex flex-col-reverse gap-2 rounded-b-xl border-t border-border bg-subtle px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-6">
                    {footer}
                  </div>
                )}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

/** Panneau latéral (navigation mobile). */
export function Sheet({ open, onOpenChange, children, side = "left", title }: {
  open: boolean; onOpenChange: (o: boolean) => void; children: React.ReactNode; side?: "left" | "right"; title: string;
}) {
  const x = side === "left" ? "-100%" : "100%";
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-[var(--overlay)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount>
              <motion.div
                className={cn("fixed inset-y-0 z-50 flex w-[86%] max-w-[320px] flex-col border-border bg-background shadow-lg", side === "left" ? "left-0 border-r" : "right-0 border-l")}
                initial={{ x }} animate={{ x: 0 }} exit={{ x }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
                {children}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
