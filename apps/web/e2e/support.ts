import { execFileSync } from "node:child_process";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

/** Restaurant dédié aux scénarios (créé au besoin avec la carte de démonstration) : le restaurant « demo » n'est pas touché. */
export const SLUG = process.env.E2E_SLUG ?? "e2e";
export const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo-Resto-2026";   // comptes de développement locaux
export const email = (role: "admin" | "manager" | "waiter" | "kitchen") => `${role}@${SLUG}.demo`;

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://app:app@localhost:5433/restaurant";
const API = `${process.env.E2E_BASE_URL ?? "http://localhost:5173"}/api/v1`;
const API_DIR = new URL("../../api", import.meta.url).pathname;

/** Requête SQL directe (réglages de plan, nettoyage) ; la RLS ne s'applique pas à ce rôle de développement. */
export function sql(query: string): string {
  return execFileSync("psql", [DB_URL, "-Atc", query], { encoding: "utf8" }).trim();
}

/** Crée le restaurant de test s'il n'existe pas (idempotent). */
export function ensureRestaurant() {
  if (sql(`select count(*) from "Tenant" where slug = '${SLUG}'`) !== "0") return;
  execFileSync("pnpm", ["exec", "tsx", "prisma/seed-demo.ts", SLUG, "--create"], {
    cwd: API_DIR, stdio: "pipe", env: { ...process.env, DATABASE_URL: DB_URL },
  });
}

export async function loginUi(page: Page, who: "admin" | "manager" | "waiter" | "kitchen", path = "") {
  await page.goto(`/r/${SLUG}/login`);
  await page.getByLabel("Email").fill(email(who));
  await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL((u) => !u.pathname.endsWith("/login"));
  if (path) await page.goto(`/r/${SLUG}${path}`);
}

/** Nouvel « appareil » : contexte de navigateur isolé (sa propre session). */
export async function newDevice(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  return { ctx, page: await ctx.newPage() };
}

/** Appel API authentifié (préparation des données d'un scénario). */
export async function apiAs(who: "admin" | "manager" | "waiter" | "kitchen") {
  const res = await fetch(`${API}/tenant/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantSlug: SLUG, email: email(who), password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  const { accessToken } = (await res.json()) as { accessToken: string };
  return async <T = any>(method: string, path: string, body?: unknown): Promise<T> => {
    const r = await fetch(`${API}${path}`, {
      method, headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 204) return undefined as T;
    return (await r.json()) as T;
  };
}
