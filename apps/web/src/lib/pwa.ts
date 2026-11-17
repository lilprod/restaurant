import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";

/**
 * Enregistre le service worker (production uniquement : en développement, Vite sert les modules directement).
 * Une nouvelle version n'est jamais imposée en pleine prise de commande : on propose de recharger.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      toast.message("Nouvelle version disponible", {
        description: "Rechargez quand vous n'êtes pas en train de saisir une commande.",
        duration: Infinity,
        action: { label: "Mettre à jour", onClick: () => void update(true) },
      });
    },
  });
}
