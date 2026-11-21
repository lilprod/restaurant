/**
 * Charge utile d'une notification push (X5B) : lue par le service worker (`sw.ts`) et testée sans navigateur.
 * La charge vient du serveur mais est traitée comme une entrée non fiable : types vérifiés, longueurs bornées,
 * adresse de clic ramenée à l'origine de l'application (jamais d'adresse externe).
 */
export interface PushPayload {
  title: string;
  body: string;
  /** Adresse interne à ouvrir au clic (`/r/<slug>/...`), toujours de l'origine de l'application. */
  url: string;
  /** Regroupe les alertes d'un même objet : la plus récente remplace la précédente (et sonne de nouveau). */
  tag: string;
}

export const FALLBACK_PUSH: PushPayload = { title: "Nouvelle alerte", body: "Ouvrez l'application pour voir le détail.", url: "/", tag: "alerte" };

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Ramène une adresse à un chemin de l'origine donnée ; toute adresse d'une autre origine (ou illisible) devient `/`. */
export function safeNotificationUrl(raw: unknown, origin: string): string {
  if (typeof raw !== "string" || !raw || raw.length > 500) return "/";
  try {
    const u = new URL(raw, origin);
    if (u.origin !== origin) return "/";
    return `${u.pathname}${u.search}${u.hash}`;
  } catch { return "/"; }
}

/** `raw` : texte JSON reçu (ou rien). Toute anomalie donne une alerte générique : une notification doit toujours être affichée. */
export function parsePushPayload(raw: string | null | undefined, origin: string): PushPayload {
  let data: unknown;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!data || typeof data !== "object") return { ...FALLBACK_PUSH };
  const d = data as Record<string, unknown>;
  const title = text(d.title, 80);
  if (!title) return { ...FALLBACK_PUSH };
  return { title, body: text(d.body, 240), url: safeNotificationUrl(d.url, origin), tag: text(d.tag, 80) || FALLBACK_PUSH.tag };
}

/** Un onglet appartient au restaurant visé quand son chemin commence par `/r/<slug>` (ou, hors `/r/`, quand l'adresse est à la racine). */
export function restaurantPrefix(path: string): string | null {
  return /^\/r\/[^/]+/.exec(path)?.[0] ?? null;
}
