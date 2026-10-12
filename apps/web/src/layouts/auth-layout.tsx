import { motion } from "motion/react";
import * as React from "react";
import { BrandMark } from "@/components/brand-mark";
import { ThemeSwitcher } from "@/components/theme-toggle";
import { cn } from "@/lib/cn";
import { useBranding } from "@/providers/branding";

/** Mise en page des écrans d'authentification : fond quadrillé estompé, carte centrée, marque en tête. */
export function AuthLayout({ children, footer, wide }: { children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const { branding } = useBranding();
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background">
      <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_70%_55%_at_50%_0%,black,transparent)]" />
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-240px] h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-brand opacity-[0.10] blur-[120px] dark:opacity-[0.16]" />
      <header className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-8 sm:py-6">
        <BrandMark showName size={28} />
        <ThemeSwitcher />
      </header>
      <main className="relative z-10 flex flex-1 items-start justify-center px-4 pb-12 pt-4 sm:items-center sm:pt-0">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className={cn("w-full", wide ? "max-w-[560px]" : "max-w-[400px]")}
        >
          {children}
        </motion.div>
      </main>
      <footer className="relative z-10 flex flex-col items-center gap-1 px-4 pb-6 text-center text-xs text-muted-foreground">
        {footer}
        {branding?.tagline && <span className="font-brand">{branding.tagline}</span>}
      </footer>
    </div>
  );
}

export function AuthCard({ title, description, children, className }: { title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card shadow-md", className)}>
      <div className="flex flex-col gap-1.5 px-6 pb-2 pt-7 sm:px-8">
        <h1 className="font-brand text-[22px] font-semibold tracking-[-0.02em]">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="px-6 pb-7 pt-4 sm:px-8">{children}</div>
    </div>
  );
}
