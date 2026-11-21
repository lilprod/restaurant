/**
 * Service worker (X5) : application hors ligne. Il ne met en cache QUE des fichiers statiques :
 * - le « shell » (index.html, scripts, styles, icônes, polices de base), préchargé à l'installation ;
 * - les polices et images de la carte (`/uploads/*`, publiques et à nom aléatoire) à la demande.
 * Il ne touche JAMAIS à `/api/*` (donc ni aux routes d'authentification, ni au jeton de rafraîchissement — cookie HttpOnly —,
 * ni aux données d'un restaurant) ni à `/socket.io/*`, ni à une requête portant un en-tête Authorization.
 * Les données hors ligne (carte, tables, file de commandes) vivent dans IndexedDB, par restaurant, et sont vidées à la déconnexion.
 *
 * X5B : notifications push du personnel. `push` affiche l'alerte (titre, texte, `tag` qui regroupe, icône, badge) sauf si l'application est déjà
 * visible (le temps réel l'a signalée : pas de doublon) ; `notificationclick` ramène l'onglet du restaurant au premier plan (navigation sans
 * rechargement, la saisie en cours est conservée) ou ouvre l'adresse reçue, toujours ramenée à NOTRE origine. Aucune réponse authentifiée n'est mise en cache.
 */
import { parsePushPayload, restaurantPrefix, safeNotificationUrl } from "./lib/push-payload";

interface Entry { url: string; revision: string | null }
interface SwEvent extends Event { waitUntil(p: Promise<unknown>): void }
interface SwFetchEvent extends SwEvent { request: Request; respondWith(r: Promise<Response> | Response): void }
interface SwMessageEvent extends SwEvent { data: unknown; ports: MessagePort[] }
interface SwPushEvent extends SwEvent { data: { text(): string } | null }
interface SwNotificationEvent extends SwEvent { notification: Notification }
interface SwWindowClient { url: string; visibilityState: string; focus(): Promise<unknown>; postMessage(message: unknown): void }
interface SwScope {
  location: Location;
  registration: { showNotification(title: string, options?: NotificationOptions & { renotify?: boolean; vibrate?: number[] }): Promise<void> };
  clients: { claim(): Promise<void>; matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<SwWindowClient[]>; openWindow(url: string): Promise<SwWindowClient | null> };
  skipWaiting(): Promise<void>;
  addEventListener(type: string, fn: (e: never) => void): void;
}
const sw = self as unknown as SwScope;

const manifest = (self as unknown as { __WB_MANIFEST: Entry[] }).__WB_MANIFEST;   // remplacé à la compilation (vite-plugin-pwa)
const VERSION = hash(manifest.map((e) => `${e.url}@${e.revision ?? ""}`).join("|"));
const SHELL = `shell-${VERSION}`;
const RUNTIME = "assets-runtime-v1";
/** Images de la carte (publiques) : vidées à la déconnexion. */
const UPLOADS = "uploads-v1";
const MAX_UPLOADS = 200;
const NAVIGATION_TIMEOUT_MS = 4000;
const NEVER = /^\/(api|socket\.io|healthz)(\/|$)/;

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
const abs = (url: string) => new URL(url, sw.location.origin).href;
const precached = new Set(manifest.map((e) => abs(e.url)));

sw.addEventListener("install", ((e: SwEvent) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(manifest.map(async (entry) => {
      const url = abs(entry.url);
      // Fichier à empreinte (revision nulle) déjà présent dans une version précédente : on le reprend sans le retélécharger.
      if (entry.revision === null) {
        const old = await caches.match(url);
        if (old) { await cache.put(url, old); return; }
      }
      const res = await fetch(new Request(url, { cache: "reload" }));
      if (!res.ok) throw new Error(`Précache : ${url} → ${res.status}`);
      await cache.put(url, res);
    }));
  })());
}) as (e: never) => void);

sw.addEventListener("activate", ((e: SwEvent) => {
  e.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith("shell-") && name !== SHELL) await caches.delete(name);
    await sw.clients.claim();
  })());
}) as (e: never) => void);

sw.addEventListener("message", ((e: SwMessageEvent) => {
  const type = (e.data as { type?: string } | null)?.type;
  if (type === "SKIP_WAITING") void sw.skipWaiting();
  else if (type === "CLEAR_DATA_CACHES") {
    // Déconnexion : plus aucune image de la carte du restaurant sur l'appareil.
    e.waitUntil(caches.delete(UPLOADS).then(() => e.ports[0]?.postMessage({ done: true })));
  }
}) as (e: never) => void);

sw.addEventListener("fetch", ((e: SwFetchEvent) => {
  const req = e.request;
  const url = new URL(req.url);
  // Tout ce qui n'est pas un GET statique de notre origine passe directement au réseau, sans cache.
  if (req.method !== "GET" || url.origin !== sw.location.origin) return;
  if (NEVER.test(url.pathname) || req.headers.has("authorization")) return;

  if (req.mode === "navigate") { e.respondWith(navigate(req)); return; }
  if (precached.has(url.origin + url.pathname)) { e.respondWith(fromShell(req)); return; }
  if (url.pathname.startsWith("/uploads/")) { e.respondWith(cacheFirst(req, UPLOADS, MAX_UPLOADS, (r) => (r.headers.get("content-type") ?? "").startsWith("image/"))); return; }
  if (url.pathname.startsWith("/assets/")) { e.respondWith(cacheFirst(req, RUNTIME, 400, () => true)); return; }
}) as (e: never) => void);

async function fromShell(req: Request): Promise<Response> {
  const hit = await (await caches.open(SHELL)).match(req, { ignoreSearch: true });
  return hit ?? fetch(req);
}

/** Page : le réseau d'abord (déploiements visibles), sinon le shell mis en cache (hors ligne ou réseau trop lent). */
async function navigate(req: Request): Promise<Response> {
  const shell = async () => (await (await caches.open(SHELL)).match(abs("/index.html"))) ?? Response.error();
  try {
    return await Promise.race([
      fetch(req),
      new Promise<Response>((_, reject) => setTimeout(() => reject(new Error("timeout")), NAVIGATION_TIMEOUT_MS)),
    ]);
  } catch {
    return shell();
  }
}

async function cacheFirst(req: Request, name: string, max: number, ok: (r: Response) => boolean): Promise<Response> {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === "basic" && ok(res)) {
    await cache.put(req, res.clone());
    const keys = await cache.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k);
  }
  return res;
}

// ── Notifications push (X5B) ──

const ICON = "/icons/icon-192.png";
const BADGE = "/icons/badge-96.png";

sw.addEventListener("push", ((e: SwPushEvent) => { e.waitUntil(onPush(e)); }) as (e: never) => void);

async function onPush(e: SwPushEvent): Promise<void> {
  const p = parsePushPayload(e.data?.text() ?? null, sw.location.origin);
  // Application au premier plan : l'événement est déjà signalé à l'écran (temps réel) : une notification système ferait doublon.
  // Exception : le test demandé par l'utilisateur (bouton « Tester ») doit s'afficher même application ouverte.
  const windows = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (p.tag !== "test" && windows.some((w) => w.visibilityState === "visible")) return;
  await sw.registration.showNotification(p.title, {
    body: p.body, tag: p.tag, renotify: true, icon: ICON, badge: BADGE, lang: "fr", vibrate: [120, 60, 120], data: { url: p.url },
  });
}

sw.addEventListener("notificationclick", ((e: SwNotificationEvent) => {
  e.notification.close();
  e.waitUntil(openTarget((e.notification.data as { url?: unknown } | null)?.url));
}) as (e: never) => void);

/** Onglet du même restaurant : focalisé, puis l'application navigue (sans rechargement) ; sinon une nouvelle fenêtre sur l'adresse reçue. */
async function openTarget(raw: unknown): Promise<void> {
  const path = safeNotificationUrl(raw, sw.location.origin);
  const prefix = restaurantPrefix(path);
  const windows = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
  const same = prefix ? windows.find((w) => restaurantPrefix(new URL(w.url).pathname) === prefix) : undefined;
  if (same) {
    try { await same.focus(); } catch { /* focus refusé : le message suffit */ }
    same.postMessage({ type: "PUSH_NAVIGATE", url: path });
    return;
  }
  await sw.clients.openWindow(new URL(path, sw.location.origin).href);
}
