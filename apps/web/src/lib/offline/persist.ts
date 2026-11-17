import type { Profile } from "@restaurant/api-client";
import type { Query, QueryClient } from "@tanstack/react-query";
import { deleteTenantDb, idbAll, idbDelete, idbGet, idbPut } from "./idb";

/**
 * Données conservées sur l'appareil pour travailler hors ligne : la carte (plats, formules, promotions), les tables et
 * deux réglages d'exploitation — rien d'autre (ni commandes, ni clients, ni montants encaissés, ni rapports).
 * Stockage : IndexedDB, une base par restaurant ; l'instantané porte l'identifiant de l'utilisateur qui l'a produit.
 */
const MAX_AGE_MS = 14 * 24 * 3_600_000;
const SAVE_DELAY_MS = 1500;

/** Clés TanStack Query (sous `["tenant", slug]`) qui peuvent être conservées. */
export function isPersistableKey(key: readonly unknown[], root: readonly unknown[]): boolean {
  if (key.length <= root.length || !root.every((p, i) => key[i] === p)) return false;
  const [a, b] = key.slice(root.length) as [unknown, unknown];
  if (a === "menu") return true;                                   // carte, formules, promotions, allergènes
  if (a === "tables") return true;
  if (a === "settings") return b === "operations" || b === "localization";
  return false;
}

/** Les tables arrivent avec leurs commandes ouvertes (montants, paiements) : ces lignes-là ne quittent jamais la mémoire. */
function scrub(key: readonly unknown[], root: readonly unknown[], data: unknown): unknown {
  if (key[root.length] === "tables" && Array.isArray(data)) return data.map((t) => ({ ...(t as object), openOrders: [] }));
  return data;
}

interface Snapshot { savedAt: number; userId: string; entries: { key: unknown[]; data: unknown; updatedAt: number }[] }
interface StoredProfile { savedAt: number; user: Profile }

export function snapshotOf(qc: QueryClient, root: readonly unknown[], userId: string, now = Date.now()): Snapshot {
  const entries = qc.getQueryCache().findAll({ predicate: (q: Query) => q.state.status === "success" && isPersistableKey(q.queryKey, root) })
    .map((q) => ({ key: [...q.queryKey], data: scrub(q.queryKey, root, q.state.data), updatedAt: q.state.dataUpdatedAt }));
  return { savedAt: now, userId, entries };
}

/** Remet l'instantané dans le cache (sans écraser des données plus récentes). Retourne le nombre d'entrées restaurées. */
export function restoreSnapshot(qc: QueryClient, root: readonly unknown[], snap: Snapshot | undefined, userId: string, now = Date.now()): number {
  if (!snap || snap.userId !== userId || now - snap.savedAt > MAX_AGE_MS) return 0;
  let n = 0;
  for (const e of snap.entries) {
    if (!isPersistableKey(e.key, root) || qc.getQueryData(e.key)) continue;
    qc.setQueryData(e.key, e.data, { updatedAt: e.updatedAt });
    n++;
  }
  return n;
}

export async function loadSnapshot(slug: string) {
  try { return await idbGet<Snapshot>(slug, "kv", "cache"); } catch { return undefined; }
}

/** Enregistre l'instantané du cache, en différé, à chaque mise à jour d'une requête conservable. Retourne l'arrêt de l'abonnement. */
export function autoSaveSnapshot(qc: QueryClient, slug: string, root: readonly unknown[], userId: string): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    timer = undefined;
    const snap = snapshotOf(qc, root, userId);
    if (snap.entries.length) void idbPut(slug, "kv", snap, "cache").catch(() => undefined);   // jamais d'instantané vide (ni après une déconnexion)
  };
  const unsub = qc.getQueryCache().subscribe((ev) => {
    if (ev.type !== "updated" || ev.action.type !== "success" || !isPersistableKey(ev.query.queryKey, root)) return;
    if (!timer) timer = setTimeout(save, SAVE_DELAY_MS);
  });
  return () => { unsub(); if (timer) clearTimeout(timer); };     // pas d'écriture à l'arrêt : une déconnexion vient d'effacer la base
}

// ── profil (démarrage hors ligne) ──
export async function saveProfile(slug: string, user: Profile) {
  try { await idbPut(slug, "kv", { savedAt: Date.now(), user } satisfies StoredProfile, "profile"); } catch { /* stockage indisponible */ }
}
export async function loadProfile(slug: string): Promise<Profile | null> {
  try {
    const p = await idbGet<StoredProfile>(slug, "kv", "profile");
    return p && Date.now() - p.savedAt <= MAX_AGE_MS && !p.user.restriction ? p.user : null;
  } catch { return null; }
}

/** Compte différent de celui qui a produit les données stockées (même appareil) : tout est effacé avant de continuer. */
export async function resetIfOtherUser(slug: string, userId: string) {
  try {
    const p = await idbGet<StoredProfile>(slug, "kv", "profile");
    const queued = await idbAll<{ userId: string }>(slug, "queue");
    if ((p && p.user.id !== userId) || queued.some((r) => r.userId !== userId)) await wipeTenantData(slug);
  } catch { /* rien à comparer */ }
}

// ── effacement ──
/** Images de la carte mises en cache par le service worker. */
async function clearServiceWorkerCaches() {
  try { await caches.delete("uploads-v1"); } catch { /* Cache Storage indisponible */ }
  try {
    const sw = (await navigator.serviceWorker?.getRegistration())?.active;
    if (sw) { const ch = new MessageChannel(); sw.postMessage({ type: "CLEAR_DATA_CACHES" }, [ch.port2]); }
  } catch { /* pas de service worker */ }
}

/** Déconnexion : plus aucune donnée du restaurant sur l'appareil (base IndexedDB, images, brouillons de commande). */
export async function wipeTenantData(slug: string) {
  await deleteTenantDb(slug);
  await clearServiceWorkerCaches();
  try {
    for (const store of [sessionStorage, localStorage]) {
      for (const k of Object.keys(store)) if (k.startsWith(`pos:${slug}:`)) store.removeItem(k);
    }
  } catch { /* stockage indisponible */ }
}

/** Session expirée (non volontaire) : on efface les données de la carte mais on garde la file de commandes non envoyées. */
export async function wipeCachesKeepQueue(slug: string) {
  try { await idbDelete(slug, "kv", "cache"); await idbDelete(slug, "kv", "profile"); } catch { /* rien à effacer */ }
  await clearServiceWorkerCaches();
}
