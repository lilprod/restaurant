/** Thèmes et marque : logique pure partagée entre l'API, le web et le mobile. */

export type ThemeMode = "light" | "dark" | "system";
export type FontKey = "inter" | "poppins" | "roboto" | "nunito" | "lato" | "system";
export type RadiusKey = "none" | "sm" | "md" | "lg" | "xl";

export interface Theme {
  mode: ThemeMode;
  primary: string;
  accent: string;
  fontFamily: FontKey;
  radius: RadiusKey;
  /** L'écran cuisine (KDS) reste sombre quel que soit le mode choisi. */
  kitchenDark: boolean;
}

export const FONT_STACKS: Record<FontKey, string> = {
  inter: "'Inter', system-ui, sans-serif",
  poppins: "'Poppins', system-ui, sans-serif",
  roboto: "'Roboto', system-ui, sans-serif",
  nunito: "'Nunito', system-ui, sans-serif",
  lato: "'Lato', system-ui, sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
};

export const RADIUS_VALUES: Record<RadiusKey, string> = { none: "0px", sm: "4px", md: "8px", lg: "12px", xl: "20px" };

export const THEME_PRESETS: Record<string, { label: string; primary: string; accent: string }> = {
  terracotta: { label: "Terracotta", primary: "#C2410C", accent: "#F59E0B" },
  olive: { label: "Olive", primary: "#4D7C0F", accent: "#EAB308" },
  ocean: { label: "Océan", primary: "#0369A1", accent: "#14B8A6" },
  charbon: { label: "Charbon", primary: "#1F2937", accent: "#F97316" },
  bordeaux: { label: "Bordeaux", primary: "#9F1239", accent: "#D97706" },
  safran: { label: "Safran", primary: "#B45309", accent: "#16A34A" },
};

export const DEFAULT_THEME: Theme = {
  mode: "system",
  ...pick(THEME_PRESETS.terracotta),
  fontFamily: "inter",
  radius: "md",
  kitchenDark: true,
};

function pick(p: { primary: string; accent: string }) {
  return { primary: p.primary, accent: p.accent };
}

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Luminance relative WCAG 2.x. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste WCAG entre deux couleurs (1 à 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Couleur de texte lisible (blanc ou quasi-noir) sur un fond donné. */
export function readableTextOn(bg: string): "#FFFFFF" | "#111827" {
  return contrastRatio(bg, "#FFFFFF") >= contrastRatio(bg, "#111827") ? "#FFFFFF" : "#111827";
}

/** Mélange `hex` avec du blanc (amount 0..1) : sert aux fonds « doux » (badges, survols). */
export function tint(hex: string, amount: number): string {
  const [r, g, b] = channels(hex).map((v) => Math.round(v + (255 - v) * amount));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function themeWarnings(theme: Theme): string[] {
  const out: string[] = [];
  if (contrastRatio(theme.primary, "#FFFFFF") < 1.5 && contrastRatio(theme.primary, "#111827") < 1.5) {
    out.push("La couleur principale est trop proche du fond.");
  }
  if (contrastRatio(theme.primary, theme.accent) < 1.3) {
    out.push("Les couleurs principale et d'accent sont presque identiques.");
  }
  return out;
}

/** Variables CSS à injecter sur `:root` (ou à mapper vers les styles React Native). */
export function themeToCssVars(theme: Theme): Record<string, string> {
  return {
    "--color-primary": theme.primary,
    "--color-on-primary": readableTextOn(theme.primary),
    "--color-primary-soft": tint(theme.primary, 0.88),
    "--color-accent": theme.accent,
    "--color-on-accent": readableTextOn(theme.accent),
    "--color-accent-soft": tint(theme.accent, 0.88),
    "--radius": RADIUS_VALUES[theme.radius],
    "--font-family": FONT_STACKS[theme.fontFamily],
  };
}
