import { CloudOff, RefreshCw, TriangleAlert } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/cn";
import { useOffline } from "@/providers/offline";
import { useSpacePath } from "@/providers/space";

/**
 * Indicateur hors ligne (X5) : pastille fixe en bas à gauche, visible sur tous les écrans du restaurant (y compris la prise de
 * commande et la cuisine, qui sont hors de la coque). Texte + icône, jamais la couleur seule. Mène à « Impression et hors ligne ».
 */
export function OfflineStatus() {
  const { online, pending, failed, sending } = useOffline();
  const to = useSpacePath();
  const { pathname } = useLocation();
  if (pathname.endsWith("/impression")) return null;          // la page détaille déjà l'état de la file
  if (online && !pending.length && !failed.length) return null;
  const waiting = pending.length;
  const tone = failed.length ? "red" : online ? "blue" : "amber";
  const text = !online
    ? waiting ? `Hors ligne · ${waiting} commande${waiting > 1 ? "s" : ""} en attente` : "Hors ligne · encaissement indisponible"
    : failed.length ? `${failed.length} commande${failed.length > 1 ? "s" : ""} à vérifier`
    : sending ? "Envoi des commandes…" : `${waiting} commande${waiting > 1 ? "s" : ""} en attente d'envoi`;
  const Icon = failed.length ? TriangleAlert : online ? RefreshCw : CloudOff;
  return (
    <Link
      to={to("/impression")}
      role="status"
      aria-live="polite"
      data-testid="offline-status"
      className={cn(
        "no-print fixed bottom-20 left-3 z-[70] inline-flex min-h-11 max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border px-4 text-[13px] font-medium shadow-lg md:bottom-4 md:left-[264px]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tone === "red" && "border-[color-mix(in_oklab,var(--tone-red-dot)_35%,var(--border))] bg-[var(--tone-red-bg)] text-[var(--tone-red-fg)]",
        tone === "amber" && "border-[color-mix(in_oklab,var(--tone-amber-dot)_35%,var(--border))] bg-[var(--tone-amber-bg)] text-[var(--tone-amber-fg)]",
        tone === "blue" && "border-[color-mix(in_oklab,var(--tone-blue-dot)_30%,var(--border))] bg-[var(--tone-blue-bg)] text-[var(--tone-blue-fg)]",
      )}
    >
      <Icon aria-hidden className={cn("size-4 shrink-0", online && !failed.length && sending && "animate-spin")} />
      <span className="truncate">{text}</span>
    </Link>
  );
}
