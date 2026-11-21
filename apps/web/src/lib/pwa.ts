import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";
import { resolveFromWindow } from "./tenant-slug";
import { safeNotificationUrl } from "./push-payload";

/**
 * Enregistre le service worker (production uniquement : en développement, Vite sert les modules directement).
 * Une nouvelle version n'est jamais imposée en pleine prise de commande : on propose de recharger.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  // X5B : un clic sur une notification ramène cet onglet au premier plan ; l'application navigue sans rechargement (saisie en cours conservée).
  navigator.serviceWorker.addEventListener("message", (e) => {
    const d = e.data as { type?: string; url?: unknown } | null;
    if (d?.type !== "PUSH_NAVIGATE" || typeof d.url !== "string") return;
    const url = safeNotificationUrl(d.url, window.location.origin);
    const path = resolveFromWindow()?.mode === "subdomain" ? url.replace(/^\/r\/[^/]+/, "") || "/" : url;
    void import("@/app/router").then(({ router }) => router.navigate(path));
  });
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
