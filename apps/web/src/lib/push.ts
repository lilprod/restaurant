import type { PushConfig, PushSubscriptionBody } from "@restaurant/api-client";

/**
 * Notifications push de cet appareil (X5B) : état, activation, désactivation, resynchronisation.
 * L'autorisation du navigateur n'est demandée QUE sur un geste de l'utilisateur (bouton « Activer »).
 */

export type PushState =
  | "loading"
  | "unsupported"     // navigateur sans push, ou service worker absent (développement)
  | "ios-install"     // iPhone / iPad : l'application doit d'abord être ajoutée à l'écran d'accueil
  | "server-off"      // clés VAPID non configurées sur le serveur
  | "denied"          // autorisation refusée dans le navigateur
  | "off"
  | "on";

export interface PushApi {
  config: () => Promise<PushConfig>;
  subscribe: (body: PushSubscriptionBody) => Promise<unknown>;
  unsubscribe: (endpoint: string, opts?: { signal?: AbortSignal }) => Promise<unknown>;
  test: (endpoint?: string) => Promise<{ sent: number }>;
}

export const isIos = (): boolean =>
  typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

export const isStandalone = (): boolean =>
  typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** Le navigateur sait-il recevoir du push ? (sur iPhone : seulement dans l'application installée, iOS 16.4+.) */
export const pushSupported = (): boolean =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export function urlBase64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const sameKey = (sub: PushSubscription, publicKey: string): boolean => {
  const current = sub.options?.applicationServerKey;
  if (!current) return true;
  const a = new Uint8Array(current), b = urlBase64ToBytes(publicKey);
  return a.length === b.length && a.every((v, i) => v === b[i]);
};

/** Inscription du service worker (production) ; `null` s'il n'y en a pas (développement) ou s'il tarde trop. */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing?.active) return existing;
  if (!import.meta.env.PROD) return null;
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  try { return (await (await registration())?.pushManager.getSubscription()) ?? null; } catch { return null; }
}

/** État de cet appareil (sans rien demander à l'utilisateur). */
export async function readPushState(api: Pick<PushApi, "config">): Promise<PushState> {
  if (!pushSupported()) return isIos() && !isStandalone() ? "ios-install" : "unsupported";
  const reg = await registration();
  if (!reg) return "unsupported";
  let cfg: PushConfig;
  try { cfg = await api.config(); } catch { return "unsupported"; }
  if (!cfg.enabled) return "server-off";
  if (Notification.permission === "denied") return "denied";
  const sub = await currentSubscription();
  return Notification.permission === "granted" && sub ? "on" : "off";
}

const toBody = (sub: PushSubscription): PushSubscriptionBody => {
  const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) throw new Error("Abonnement incomplet");
  return { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } };
};

/** À appeler depuis un clic : demande l'autorisation, s'abonne auprès du navigateur puis enregistre l'appareil côté API. */
export async function enablePush(api: PushApi): Promise<"on" | "denied" | "off"> {
  const permission = await Notification.requestPermission();   // premier `await` du geste : le navigateur exige un clic
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "off";
  const cfg = await api.config();
  if (!cfg.enabled || !cfg.publicKey) throw new Error("Les notifications push ne sont pas activées sur ce serveur");
  const reg = await registration();
  if (!reg) throw new Error("Le service worker n'est pas disponible (installez la version de production)");
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, cfg.publicKey)) { await sub.unsubscribe(); sub = null; }   // clés VAPID changées côté serveur
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(cfg.publicKey) });
  await api.subscribe(toBody(sub));
  return "on";
}

/** Retire l'abonnement côté API puis côté navigateur. Ne lève jamais : à utiliser aussi à la déconnexion. */
export async function disablePush(api: Pick<PushApi, "unsubscribe">, opts: { timeoutMs?: number } = {}): Promise<void> {
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 4000);
    try { await api.unsubscribe(sub.endpoint, { signal: ctl.signal }); } catch { /* le serveur purgera : session terminée, 410 ou inactivité */ } finally { clearTimeout(timer); }
    await sub.unsubscribe();
  } catch { /* push indisponible : rien à retirer */ }
}

/**
 * Au démarrage de l'application connectée : si l'appareil est déjà abonné, on rattache l'abonnement au compte et au restaurant COURANTS
 * (changement de compte ou de restaurant sur le même appareil) et on rafraîchit sa date d'activité. Clés VAPID changées : réabonnement.
 */
export async function syncPush(api: Pick<PushApi, "config" | "subscribe">): Promise<void> {
  try {
    if (!pushSupported() || Notification.permission !== "granted") return;
    const sub = await currentSubscription();
    if (!sub) return;
    const cfg = await api.config();
    if (!cfg.enabled || !cfg.publicKey) return;
    let live: PushSubscription = sub;
    if (!sameKey(sub, cfg.publicKey)) {
      await sub.unsubscribe();
      const reg = await registration();
      if (!reg) return;
      live = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(cfg.publicKey) });
    }
    await api.subscribe(toBody(live));
  } catch { /* la prochaine ouverture réessaiera */ }
}
