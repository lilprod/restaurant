/**
 * Exemple de script de connexion pour screenshots.mjs (--login).
 * Adapter les sélecteurs aux libellés réels de l'écran de connexion.
 * Identifiants : variables d'environnement, jamais en dur dans le dépôt.
 *   SHOT_PATH=/admin/login SHOT_EMAIL=superadmin@restaurant.local SHOT_PASSWORD=... \
 *   node .claude/skills/vercel-design/scripts/screenshots.mjs --login .claude/skills/vercel-design/scripts/login-example.mjs ...
 */
export default async function login(page, baseUrl) {
  await page.goto(baseUrl + (process.env.SHOT_PATH ?? "/admin/login"), { waitUntil: "networkidle" });
  await page.getByLabel(/e-?mail/i).fill(process.env.SHOT_EMAIL ?? "");
  await page.getByLabel(/mot de passe/i).fill(process.env.SHOT_PASSWORD ?? "");
  await page.getByRole("button", { name: /se connecter|connexion/i }).click();
  await page.waitForURL((url) => !/login|connexion/.test(url.pathname), { timeout: 15_000 });
}
