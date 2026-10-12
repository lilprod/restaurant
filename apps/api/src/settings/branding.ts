import { DEFAULT_THEME, Theme, themeToCssVars, themeWarnings } from "@restaurant/utils";

export interface Assets {
  logo?: string | null;
  logoDark?: string | null;
  favicon?: string | null;
}

/** Vue publique de la marque (page de connexion, en-tête, favicon) : tout ce qu'il faut pour habiller l'interface. */
export function composeBranding(
  branding: { displayName: string; tagline?: string; theme: Theme },
  assets: Assets,
) {
  const theme = { ...DEFAULT_THEME, ...branding.theme };
  return {
    displayName: branding.displayName,
    tagline: branding.tagline ?? null,
    logoUrl: assets.logo ?? null,
    logoDarkUrl: assets.logoDark ?? assets.logo ?? null,
    faviconUrl: assets.favicon ?? null,
    theme,
    cssVars: themeToCssVars(theme),
    warnings: themeWarnings(theme),
  };
}
