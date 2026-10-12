import * as React from "react";
import { cn } from "@/lib/cn";

export function PageHeader({ title, description, actions, eyebrow, className }: {
  title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow}
        <h1 className="text-2xl font-semibold tracking-[-0.02em] sm:text-[28px]">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-muted-foreground sm:text-[15px]">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Bloc de réglages façon Vercel : titre + description + contenu, pied avec action. */
export function SettingsSection({ title, description, children, footer, className }: {
  title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; className?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-border bg-card shadow-sm", className)}>
      <div className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {children}
      </div>
      {footer && (
        <div className="flex flex-col-reverse gap-3 rounded-b-lg border-t border-border bg-subtle px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          {footer}
        </div>
      )}
    </section>
  );
}

/** Liste de définitions (détail d'un restaurant, reçu…). */
export function DescriptionList({ items, className }: { items: { label: React.ReactNode; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2", className)}>
      {items.map((it, i) => (
        <div key={i} className="flex min-w-0 flex-col gap-1">
          <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{it.label}</dt>
          <dd className="min-w-0 break-words text-sm">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
