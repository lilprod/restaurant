import { ApiError, type PublicAvailability } from "@restaurant/api-client";
import { CalendarX2 } from "lucide-react";
import * as React from "react";
import { useParams } from "react-router-dom";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggleButton } from "@/components/theme-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { resolveFromWindow } from "@/lib/tenant-slug";
import { useBranding } from "@/providers/branding";
import { addDays, dayOf, fmtDay, fmtTime } from "../tenant/reservations/time";

export function usePublicSlug() {
  const params = useParams();
  return (params.slug ?? resolveFromWindow()?.slug ?? "").toLowerCase();
}

/** Coque des pages publiques de réservation : marque du restaurant, une colonne, mobile d'abord. */
export function PublicShell({ title, children }: { title: string; children: React.ReactNode }) {
  const { branding } = useBranding();
  React.useEffect(() => { if (branding) document.title = `${title} · ${branding.displayName}`; }, [branding, title]);
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-subtle">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark size={36} />
            <span className="truncate font-brand text-lg font-semibold tracking-tight">{branding?.displayName}</span>
          </div>
          <ThemeToggleButton />
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 pb-20 pt-6 sm:px-6">{children}</main>
    </div>
  );
}

export const isDisabled = (e: unknown) => e instanceof ApiError && e.code === "RESERVATIONS_DISABLED";

/** Puces des 7 prochains jours (défilement horizontal sur mobile). */
export function DayChips({ value, onChange, today, tz }: { value: string; onChange: (d: string) => void; today: string; tz: string }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  void tz;
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:px-0" role="radiogroup" aria-label="Jour">
      {days.map((d, i) => {
        const on = d === value;
        return (
          <button key={d} type="button" role="radio" aria-checked={on} onClick={() => onChange(d)}
            className={cn("flex h-14 min-w-16 shrink-0 flex-col items-center justify-center rounded-lg border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "border-transparent bg-brand text-brand-foreground" : "border-border bg-card hover:bg-hover")}>
            <span className="text-[11px] uppercase tracking-wide opacity-80">{i === 0 ? "Auj." : i === 1 ? "Demain" : fmtDay(d, { weekday: "short" })}</span>
            <span className="font-mono font-semibold tabular-nums">{fmtDay(d, { day: "numeric" })}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Créneaux libres d'un jour (heure du restaurant). `extra` : créneau déjà réservé à garder choisissable (modification). */
export function PublicSlots({ data, loading, error, value, onChange, onRetry, extra }: {
  data?: PublicAvailability; loading: boolean; error: unknown; value: string | null; onChange: (iso: string) => void; onRetry: () => void; extra?: string;
}) {
  if (loading) return <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-11" />)}</div>;
  if (error) return <Callout tone="danger" title={errorMessage(error)} action={<Button size="sm" variant="secondary" onClick={onRetry}>Réessayer</Button>} />;
  if (!data) return null;
  const tz = data.timezone;
  const starts = data.slots.map((s) => s.startsAt);
  if (extra && dayOf(extra, tz) === data.date && !starts.includes(extra)) starts.push(extra);
  starts.sort();
  if (data.closed || starts.length === 0) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-dashed border-border px-4 py-4 text-sm text-muted-foreground" role="status">
        <CalendarX2 className="mt-0.5 size-4 shrink-0" />
        {data.closed ? `Le restaurant est fermé ce jour-là${data.closureReason ? ` (${data.closureReason})` : ""}.` : "Plus de table disponible ce jour-là pour ce nombre de personnes. Essayez un autre jour."}
      </p>
    );
  }
  return (
    <div role="radiogroup" aria-label="Heure" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {starts.map((s) => {
        const on = s === value;
        return (
          <button key={s} type="button" role="radio" aria-checked={on} onClick={() => onChange(s)}
            className={cn("h-11 rounded-md border font-mono text-[15px] tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "border-transparent bg-brand text-brand-foreground" : "border-border bg-card hover:bg-hover")}>
            {fmtTime(s, tz)}
          </button>
        );
      })}
    </div>
  );
}
