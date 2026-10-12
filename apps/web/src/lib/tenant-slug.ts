/** Sous-domaines qui ne désignent jamais un restaurant (alignés sur RESERVED_SLUGS de l'API). */
export const RESERVED_SUBDOMAINS = new Set([
  "www", "api", "admin", "app", "platform", "superadmin", "mail", "static", "assets", "docs", "status",
]);

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface SlugSource {
  hostname: string;
  pathname: string;
  /**
   * Domaine racine de l'application (ex. `monapp.com`), fourni par `VITE_ROOT_DOMAIN`.
   * `localhost` permet de tester `chez-kofi.localhost:5173` en local.
   */
  rootDomain?: string | null;
}

export interface ResolvedSlug {
  slug: string;
  /** `subdomain` : routes à la racine (`/login`) ; `path` : routes sous `/r/:slug`. */
  mode: "subdomain" | "path";
}

/**
 * Slug du restaurant courant. En production il vient du sous-domaine (`chez-kofi.monapp.com`) ;
 * à défaut (développement, aperçu) on le lit dans le chemin `/r/:slug/...`.
 */
export function resolveTenantSlug({ hostname, pathname, rootDomain }: SlugSource): ResolvedSlug | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const root = (rootDomain ?? "").toLowerCase().replace(/^\./, "");
  if (root && host.endsWith(`.${root}`)) {
    const label = host.slice(0, -(root.length + 1));
    // Un seul niveau de sous-domaine : `a.b.monapp.com` n'est pas un restaurant.
    if (label && !label.includes(".") && !RESERVED_SUBDOMAINS.has(label) && SLUG.test(label)) {
      return { slug: label, mode: "subdomain" };
    }
  }
  const m = /^\/r\/([^/?#]+)/.exec(pathname);
  if (m) {
    const slug = decodeURIComponent(m[1]!).toLowerCase();
    if (SLUG.test(slug)) return { slug, mode: "path" };
  }
  return null;
}

/** Préfixe des routes du restaurant selon le mode (`""` en sous-domaine, `/r/slug` sinon). */
export function tenantBasePath(r: ResolvedSlug): string {
  return r.mode === "subdomain" ? "" : `/r/${r.slug}`;
}

/** Résolution depuis `window.location` et la configuration Vite. */
export function resolveFromWindow(): ResolvedSlug | null {
  if (typeof window === "undefined") return null;
  return resolveTenantSlug({
    hostname: window.location.hostname,
    pathname: window.location.pathname,
    rootDomain: (import.meta.env.VITE_ROOT_DOMAIN as string | undefined) ?? "localhost",
  });
}
