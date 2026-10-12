import {
  DEFAULT_PASSWORD_POLICY, DEFAULT_THEME, THEME_PRESETS, contrastRatio, readableTextOn, themeToCssVars, themeWarnings, tint, validatePassword,
} from "@restaurant/utils";
import { brandingInputSchema, localizationSchema, tenantSecuritySchema } from "@restaurant/validation";
import { composeBranding } from "./branding";
import { deepMerge } from "./deep-merge";

describe("thèmes", () => {
  it("calcule le contraste WCAG", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
  });
  it("choisit un texte lisible (blanc sur foncé, sombre sur clair)", () => {
    expect(readableTextOn("#1F2937")).toBe("#FFFFFF");
    expect(readableTextOn("#FDE68A")).toBe("#111827");
    for (const p of Object.values(THEME_PRESETS)) {
      expect(contrastRatio(p.primary, readableTextOn(p.primary))).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("produit les variables CSS et un fond doux", () => {
    const vars = themeToCssVars({ ...DEFAULT_THEME, radius: "lg", fontFamily: "poppins" });
    expect(vars["--color-primary"]).toBe(DEFAULT_THEME.primary);
    expect(vars["--radius"]).toBe("12px");
    expect(vars["--font-family"]).toContain("Poppins");
    expect(tint("#000000", 0.5)).toBe("#808080");
  });
  it("avertit si les couleurs sont presque identiques", () => {
    expect(themeWarnings({ ...DEFAULT_THEME, primary: "#336699", accent: "#336699" })).toHaveLength(1);
    expect(themeWarnings(DEFAULT_THEME)).toEqual([]);
  });
  it("compose la marque publique avec logo de repli", () => {
    const b = composeBranding({ displayName: "Chez Kofi", theme: DEFAULT_THEME }, { logo: "http://x/l.png", favicon: null });
    expect(b.logoDarkUrl).toBe("http://x/l.png");
    expect(b.faviconUrl).toBeNull();
    expect(b.cssVars["--color-on-primary"]).toMatch(/^#/);
  });
});

describe("schémas de réglages", () => {
  it("refuse une couleur invalide", () => {
    expect(brandingInputSchema.safeParse({ displayName: "Resto", theme: { ...DEFAULT_THEME, primary: "rouge" } }).success).toBe(false);
    expect(brandingInputSchema.safeParse({ displayName: "Resto", theme: DEFAULT_THEME }).success).toBe(true);
  });
  it("refuse un fuseau horaire inconnu", () => {
    const base = { locale: "fr", dateFormat: "DD/MM/YYYY", firstDayOfWeek: 1 };
    expect(localizationSchema.safeParse({ ...base, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(localizationSchema.safeParse({ ...base, timezone: "Africa/Lome" }).success).toBe(true);
  });
  it("borne la politique de sécurité", () => {
    const ok = { passwordPolicy: DEFAULT_PASSWORD_POLICY, maxFailedAttempts: 5, lockoutMinutes: 15, sessionDays: 30, passwordExpiryDays: 0, require2faRoles: [] };
    expect(tenantSecuritySchema.safeParse(ok).success).toBe(true);
    expect(tenantSecuritySchema.safeParse({ ...ok, maxFailedAttempts: 1 }).success).toBe(false);
    expect(tenantSecuritySchema.safeParse({ ...ok, passwordPolicy: { ...DEFAULT_PASSWORD_POLICY, minLength: 4 } }).success).toBe(false);
    expect(tenantSecuritySchema.safeParse({ ...ok, require2faRoles: ["CUSTOMER"] }).success).toBe(false);
  });
});

describe("politique de mot de passe", () => {
  it("applique les règles configurées", () => {
    expect(validatePassword("Cigale-Bleue74")).toEqual([]);
    expect(validatePassword("court1A")).toContain("Au moins 10 caractères");
    expect(validatePassword("toutenminuscule1")).toContain("Au moins une majuscule");
    expect(validatePassword("TOUTENMAJUSCULE1")).toContain("Au moins une minuscule");
    expect(validatePassword("PasDeChiffreIci")).toContain("Au moins un chiffre");
    expect(validatePassword("Cigale-Bleue74", { ...DEFAULT_PASSWORD_POLICY, requireSymbol: true })).toEqual([]);
    expect(validatePassword("CigaleBleue74", { ...DEFAULT_PASSWORD_POLICY, requireSymbol: true })).toContain("Au moins un symbole");
  });
  it("refuse les mots de passe courants ou dérivés de l'identité", () => {
    expect(validatePassword("MotDePasse1")).toContain("Mot de passe trop courant");
    expect(validatePassword("Kossigan-2026x", DEFAULT_PASSWORD_POLICY, { email: "kossigan@example.com" })).toContain("Ne doit pas contenir votre adresse email");
    expect(validatePassword("Mensah-Soleil99", DEFAULT_PASSWORD_POLICY, { names: ["Mensah"] })).toContain("Ne doit pas contenir votre nom");
  });
});

describe("fusion des réglages", () => {
  it("fusionne en profondeur et remplace les tableaux", () => {
    expect(deepMerge({ a: { b: 1, c: 2 }, t: [1, 2] }, { a: { b: 9 }, t: [3] })).toEqual({ a: { b: 9, c: 2 }, t: [3] });
  });
  it("ignore undefined mais accepte null et chaîne vide", () => {
    expect(deepMerge({ a: 1, b: 2 }, { a: undefined, b: null })).toEqual({ a: 1, b: null });
    expect(deepMerge({ x: "u" }, { x: "" })).toEqual({ x: "" });
  });
});
