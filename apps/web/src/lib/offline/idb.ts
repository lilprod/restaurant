/**
 * Mini-enveloppe IndexedDB (sans dépendance) : une base PAR RESTAURANT (`restaurant-offline:<slug>`), deux magasins.
 * - `kv`    : instantané de la carte / des tables (clé « cache ») et profil de l'utilisateur (clé « profile ») ;
 * - `queue` : commandes saisies hors ligne, en attente d'envoi.
 * Supprimer la base (`deleteTenantDb`) efface tout ce qui concerne ce restaurant sur l'appareil.
 */
export const dbName = (slug: string) => `restaurant-offline:${slug}`;

const opened = new Map<string, Promise<IDBDatabase>>();

export function openTenantDb(slug: string): Promise<IDBDatabase> {
  let p = opened.get(slug);
  if (!p) {
    p = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB indisponible")); return; }
      const req = indexedDB.open(dbName(slug), 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "id" });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); opened.delete(slug); };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("Base verrouillée"));
    });
    opened.set(slug, p);
    p.catch(() => opened.delete(slug));
  }
  return p;
}

const wrap = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

export async function idbGet<T>(slug: string, store: "kv" | "queue", key: string): Promise<T | undefined> {
  const db = await openTenantDb(slug);
  return wrap<T | undefined>(db.transaction(store).objectStore(store).get(key));
}
export async function idbPut(slug: string, store: "kv" | "queue", value: unknown, key?: string): Promise<void> {
  const db = await openTenantDb(slug);
  const tx = db.transaction(store, "readwrite");
  const os = tx.objectStore(store);
  await wrap(key === undefined ? os.put(value) : os.put(value, key));
}
export async function idbDelete(slug: string, store: "kv" | "queue", key: string): Promise<void> {
  const db = await openTenantDb(slug);
  await wrap(db.transaction(store, "readwrite").objectStore(store).delete(key));
}
export async function idbAll<T>(slug: string, store: "kv" | "queue"): Promise<T[]> {
  const db = await openTenantDb(slug);
  return wrap<T[]>(db.transaction(store).objectStore(store).getAll());
}
export async function idbClear(slug: string, store: "kv" | "queue"): Promise<void> {
  const db = await openTenantDb(slug);
  await wrap(db.transaction(store, "readwrite").objectStore(store).clear());
}

/** Supprime la base entière du restaurant. */
export async function deleteTenantDb(slug: string): Promise<void> {
  const p = opened.get(slug);
  opened.delete(slug);
  if (p) { try { (await p).close(); } catch { /* déjà fermée */ } }
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName(slug));
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
