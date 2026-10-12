import type { PublicBranding } from "@restaurant/api-client";
import { contrastRatio, readableTextOn, tint, HEX_COLOR, type FontKey } from "@restaurant/utils";

/**
 * Polices de marque auto-hébergées (@fontsource), chargées à la demande : aucun appel à un service tiers,
 * fonctionne hors ligne, et seul le restaurant qui choisit Poppins télécharge Poppins.
 */
const FONT_LOADERS: Partial<Record<FontKey, () => Promise<unknown>>> = {
  inter: () => import("@fontsource-variable/inter"),
  roboto: () => import("@fontsource-variable/roboto"),
  nunito: () => import("@fontsource-variable/nunito"),
  poppins: () => Promise.all([import("@fontsource/poppins/400.css"), import("@fontsource/poppins/500.css"), import("@fontsource/poppins/600.css"), import("@fontsource/poppins/700.css")]),
  lato: () => Promise.all([import("@fontsource/lato/400.css"), import("@fontsource/lato/700.css")]),
};
/** Les versions « variables » s'enregistrent sous un autre nom de famille. */
const FAMILY_ALIASES: Record<string, string> = { Inter: "Inter Variable", Roboto: "Roboto Variable", Nunito: "Nunito Variable" };
const loaded = new Set<FontKey>();

export function ensureBrandFont(font: FontKey | undefined) {
  if (!font || loaded.has(font)) return;
  const load = FONT_LOADERS[font];
  if (!load) return;
  loaded.add(font);
  load().catch(() => loaded.delete(font));
}

const APPLIED_KEYS = new Set<string>();

const DARK_SURFACE = "#0A0A0A";

/**
 * Complète les variables de l'API :
 * - `--brand-font` : la police de la marque puis Geist (et non system-ui) si elle ne charge pas ;
 * - `--color-primary-dark` / `--color-on-primary-dark` : variante pour le mode sombre quand la couleur est
 *   trop proche du fond noir (ex. « Charbon ») — même principe que Vercel (bouton noir en clair, blanc en sombre).
 *   Calculé avec les fonctions de contraste partagées (@restaurant/utils).
 */
export function deriveBrandVars(vars: Record<string, string>): Record<string, string> {
  const out = { ...vars };
  const primary = vars["--color-primary"];
  if (primary && HEX_COLOR.test(primary)) {
    // Toujours défini (même égal à la couleur d'origine) pour qu'un aperçu n'hérite pas de la marque de la page.
    const tooDark = contrastRatio(primary, DARK_SURFACE) < 2.2;
    const dark = tooDark ? tint(primary, 0.86) : primary;
    out["--color-primary-dark"] = dark;
    out["--color-on-primary-dark"] = tooDark ? readableTextOn(dark) : vars["--color-on-primary"] ?? readableTextOn(primary);
  }
  const font = vars["--font-family"];
  if (font) {
    const first = font.split(",")[0]!.trim();
    const alias = FAMILY_ALIASES[first.replace(/['"]/g, "")];
    out["--brand-font"] = /system-ui|-apple-system/.test(first) ? font : `${first}, ${alias ? `"${alias}", ` : ""}"Geist Variable", system-ui, sans-serif`;
  }
  return out;
}

/** Applique les variables CSS de la marque sur :root (`<html>`), sans toucher aux jetons neutres. */
export function applyCssVars(vars: Record<string, string>, target: HTMLElement = document.documentElement) {
  for (const key of APPLIED_KEYS) if (!(key in vars)) target.style.removeProperty(key);
  APPLIED_KEYS.clear();
  for (const [k, v] of Object.entries(vars)) {
    if (!k.startsWith("--")) continue;
    target.style.setProperty(k, v);
    APPLIED_KEYS.add(k);
  }
}

/** Met à jour `<link rel="icon">` (ou revient au favicon par défaut). */
export function applyFavicon(url: string | null | undefined) {
  if (typeof document === "undefined") return;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  const href = url || "/favicon.svg";
  link.type = href.endsWith(".svg") ? "image/svg+xml" : href.endsWith(".ico") ? "image/x-icon" : "";
  link.href = href;
}

export function applyBranding(b: PublicBranding | null | undefined, title?: string) {
  if (!b) return;
  applyCssVars(deriveBrandVars(b.cssVars));
  applyFavicon(b.faviconUrl);
  ensureBrandFont(b.theme?.fontFamily);
  if (title) document.title = title;
}
