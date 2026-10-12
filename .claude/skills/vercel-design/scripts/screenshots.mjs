#!/usr/bin/env node
/**
 * Captures d'écran de contrôle : chaque route × thème (clair/sombre) × largeur (bureau/mobile).
 *
 * Usage :
 *   node .claude/skills/vercel-design/scripts/screenshots.mjs \
 *     --url http://localhost:5173 --routes "/admin,/admin/restaurants" --out <dossier>
 *
 * Options :
 *   --url <base>            URL de l'app (défaut http://localhost:5173)
 *   --routes <a,b,c>        chemins à capturer (défaut "/")
 *   --out <dossier>         dossier de sortie (défaut ./screens)
 *   --widths <1440,390>     largeurs en px (hauteur auto : 900 bureau, 844 mobile)
 *   --themes <light,dark>   thèmes, via prefers-color-scheme (l'app suit le système par défaut)
 *   --login <script.mjs>    module exportant `default async (page, baseUrl) => {}` exécuté une fois avant les captures
 *                           (ex. remplir le formulaire de connexion) ; la session est ensuite réutilisée
 *   --full-page             capture toute la hauteur de la page
 *   --reduced-motion        émule prefers-reduced-motion: reduce
 *   --wait <ms>             attente après chargement, pour laisser finir les animations (défaut 600)
 *
 * Playwright : utilise `playwright` ou `playwright-core` s'il est résolvable, sinon le dossier indiqué par
 * PW_DIR (installation : `npm i --prefix "$PW_DIR" playwright-core`). Navigateur : CHROMIUM_PATH, sinon
 * /opt/pw-browsers/chromium s'il existe, sinon celui de Playwright. Ne lance jamais `playwright install` ici.
 */
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? def : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);

const baseUrl = opt("url", "http://localhost:5173").replace(/\/$/, "");
const routes = opt("routes", "/").split(",").map((r) => r.trim()).filter(Boolean);
const out = resolve(opt("out", "screens"));
const widths = opt("widths", "1440,390").split(",").map(Number);
const themes = opt("themes", "light,dark").split(",");
const loginScript = opt("login", null);
const wait = Number(opt("wait", "600"));

async function loadChromium() {
  for (const name of ["playwright", "playwright-core"]) {
    try { return (await import(name)).chromium; } catch {}
  }
  if (process.env.PW_DIR) {
    const req = createRequire(join(resolve(process.env.PW_DIR), "noop.js"));
    for (const name of ["playwright", "playwright-core"]) {
      try { return req(name).chromium; } catch {}
    }
  }
  console.error(
    "Playwright introuvable. Installez-le hors du dépôt puis relancez :\n" +
    '  export PW_DIR="$TMPDIR/pw" && npm i --prefix "$PW_DIR" playwright-core\n',
  );
  process.exit(2);
}

const slug = (route) => (route === "/" ? "home" : route.replace(/^\//, "").replace(/[^\w-]+/g, "_"));

const chromium = await loadChromium();
const executablePath = process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const browser = await chromium.launch({ executablePath });
mkdirSync(out, { recursive: true });

// Une seule session de navigateur pour toutes les captures : l'app fait tourner son jeton de rafraîchissement,
// donc réutiliser la même session dans plusieurs contextes déconnecterait les suivants.
const ctx = await browser.newContext({ viewport: { width: widths[0], height: 900 }, locale: "fr-FR", timezoneId: "Africa/Lome" });
const page = await ctx.newPage();
if (loginScript) {
  const mod = await import(pathToFileURL(resolve(loginScript)).href);
  await mod.default(page, baseUrl);
}

const files = [];
const problems = [];
let current = "";
page.on("pageerror", (e) => problems.push(`[${current}] erreur JS : ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") problems.push(`[${current}] console : ${m.text()}`); });
for (const theme of themes) {
  await page.emulateMedia({ colorScheme: theme === "dark" ? "dark" : "light", reducedMotion: flag("reduced-motion") ? "reduce" : "no-preference" });
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    for (const route of routes) {
      current = `${theme} ${width}px ${route}`;
      await page.goto(baseUrl + route, { waitUntil: "networkidle" }).catch((e) => problems.push(`${route} : ${e.message}`));
      await page.waitForTimeout(wait);
      // Débordement horizontal : signe classique d'une mise en page mobile cassée.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) problems.push(`[${current}] débordement horizontal de ${overflow}px`);
      const file = join(out, `${slug(route)}-${theme}-${width}.png`);
      await page.screenshot({ path: file, fullPage: flag("full-page") });
      files.push(file);
    }
  }
}
await ctx.close();
await browser.close();

console.log(`${files.length} captures dans ${out}`);
for (const f of files) console.log("  " + f);
if (problems.length) {
  console.log(`\n${problems.length} problème(s) détecté(s) :`);
  for (const p of [...new Set(problems)]) console.log("  - " + p);
  process.exitCode = 1;
}
