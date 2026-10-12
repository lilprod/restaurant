import { RefreshCw, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { Button } from "./button";

/** Erreur de chargement : message de l'API et « Réessayer ». */
export function ErrorState({ error, onRetry, className, compact }: { error: unknown; onRetry?: () => void; className?: string; compact?: boolean }) {
  return (
    <div role="alert" className={cn(
      "flex flex-col items-start gap-3 rounded-lg border border-[color-mix(in_oklab,var(--danger)_30%,var(--border))] bg-card p-5 sm:flex-row sm:items-center sm:justify-between",
      compact && "p-4", className,
    )}>
      <p className="flex items-start gap-2 text-sm"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />{errorMessage(error)}</p>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}><RefreshCw /> Réessayer</Button>}
    </div>
  );
}
