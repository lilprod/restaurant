import { cn } from "@/lib/cn";
import { useRealtime } from "@/providers/realtime";

const LABEL = { idle: "Hors ligne", connecting: "Connexion…", connected: "En direct", reconnecting: "Reconnexion…", offline: "Hors ligne" } as const;

/** État de la connexion temps réel (pastille + texte ; jamais la couleur seule). */
export function LiveIndicator({ className, size = "sm" }: { className?: string; size?: "sm" | "lg" }) {
  const { status, reconnect } = useRealtime();
  const ok = status === "connected";
  const warn = status === "connecting" || status === "reconnecting";
  return (
    <button
      type="button"
      onClick={ok ? undefined : reconnect}
      title={ok ? "Mises à jour en temps réel actives" : "Cliquer pour se reconnecter"}
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-background font-medium text-muted-foreground",
        size === "lg" ? "h-12 px-4 text-sm" : "h-8 px-3 text-xs",
        !ok && "hover:bg-hover",
        className,
      )}
    >
      <span aria-hidden className={cn("relative flex size-2 rounded-full",
        ok ? "bg-[var(--tone-green-dot)]" : warn ? "bg-[var(--tone-amber-dot)]" : "bg-[var(--tone-red-dot)]")} />
      <span className={cn(ok && "text-foreground")}>{LABEL[status]}</span>
    </button>
  );
}
