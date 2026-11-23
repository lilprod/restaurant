import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

/**
 * Parcours navigateur, lancés en CI (job web-e2e) et en local par `E2E_DATABASE_URL=… bash scripts/ci/web-e2e.sh` (base neuve, build de production).
 * À la main sur le serveur de dev : `pnpm --filter web test:e2e` (les parcours du service worker se sautent alors).
 * Prérequis : `bash scripts/dev/setup-db.sh && bash scripts/dev/start.sh` (API :3000 + web :5173).
 * Navigateur : CHROMIUM_PATH, sinon /opt/pw-browsers/chromium s'il existe, sinon celui de Playwright. Ne jamais lancer `playwright install` ici.
 */
const executablePath = process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.pw.ts",
  workers: 1,                     // les scénarios partagent un restaurant et modifient la base
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    locale: "fr-FR",
    timezoneId: "Africa/Lome",
    viewport: { width: 1280, height: 800 },
    launchOptions: { executablePath },
    // Sans navigateur imposé (CI) : Chromium complet en mode sans interface. Le « headless shell » par défaut refuse les
    // notifications (permission « denied » même accordée), ce qui empêche de tester le push web.
    channel: executablePath ? undefined : "chromium",
    trace: "off",
  },
});
