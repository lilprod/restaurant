import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { apiAs, email, ensureRestaurant, loginUi, PASSWORD, SLUG, sql } from "./support";

/**
 * X5 : PWA hors ligne et impression. À lancer sur le BUILD de production (service worker), de préférence derrière nginx
 * avec la CSP stricte : `E2E_BASE_URL=http://localhost:8081 pnpm --filter web test:e2e offline`.
 */
test.skip(!/^http:\/\/localhost:(8\d{3}|4173)/.test(process.env.E2E_BASE_URL ?? ""), "Service worker : lancer sur le build de production (nginx :8081 ou vite preview :4173).");
test.beforeAll(() => ensureRestaurant());

const orderCount = () => Number(sql(`select count(*) from "Order" where "tenantId" = (select id from "Tenant" where slug = '${SLUG}')`));
const keyRows = () => Number(sql(`select count(*) from "IdempotencyKey" where "tenantId" = (select id from "Tenant" where slug = '${SLUG}')`));

/** Remplace window.print : enregistre le contenu de la zone d'impression au moment de l'appel. */
async function stubPrint(ctx: BrowserContext) {
  await ctx.addInitScript(() => {
    (window as any).__prints = [];
    window.print = () => { (window as any).__prints.push((document.getElementById("print-host") as HTMLElement | null)?.innerText ?? ""); };
  });
}
const prints = (page: Page) => page.evaluate(() => (window as any).__prints as string[]);

async function swControlled(page: Page) {
  await page.waitForFunction(async () => { const r = await navigator.serviceWorker?.getRegistration(); return !!r?.active && !!navigator.serviceWorker.controller; }, null, { timeout: 30_000 });
}
const readDb = (page: Page, slug: string) => page.evaluate(async (slug) => {
  const dbs = await indexedDB.databases();
  if (!dbs.some((d) => d.name === `restaurant-offline:${slug}`)) return null;
  return new Promise<{ kv: string[]; queue: any[]; cache: any }>((resolve) => {
    const r = indexedDB.open(`restaurant-offline:${slug}`);
    r.onsuccess = () => {
      const db = r.result; const tx = db.transaction(["kv", "queue"]);
      const kv = tx.objectStore("kv").getAllKeys(); const q = tx.objectStore("queue").getAll(); const c = tx.objectStore("kv").get("cache");
      tx.oncomplete = () => { resolve({ kv: kv.result as string[], queue: q.result, cache: c.result }); db.close(); };
    };
  });
}, slug);

/** Plat sans option (ajout direct au panier), choisi par l'API ; retourne son nom. */
async function simpleDish() {
  const waiter = await apiAs("waiter");
  const menu = (await waiter("GET", "/tenant/menu")) as { items: { name: string; price: number; isAvailable?: boolean; optionGroups: unknown[] }[] }[];
  return menu.flatMap((c) => c.items).find((i) => i.optionGroups.length === 0 && i.price > 0 && i.isAvailable !== false)!.name;
}
async function pickTableAndDish(page: Page) {
  const name = await simpleDish();
  await page.getByRole("button", { name: /Choisir la table|^Table/ }).first().click();
  await page.getByRole("dialog", { name: "Choisir la table" }).getByRole("button", { name: /pl\./ }).first().click();
  await page.getByRole("button", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},`) }).first().click();
  return name;
}

test.describe("PWA hors ligne", () => {
  test("commande saisie sans réseau : mise en file, ticket cuisine hors ligne, envoyée UNE SEULE FOIS malgré une réponse perdue", async ({ browser }) => {
    const ctx = await browser.newContext();
    await stubPrint(ctx);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) errors.push(m.text()); });

    await loginUi(page, "waiter");
    await swControlled(page);

    // Réglage de l'appareil : ticket cuisine automatique (navigateur)
    await page.goto(`/r/${SLUG}/impression`);
    await page.getByRole("switch", { name: "Ticket cuisine automatique" }).click();
    await expect(page.getByRole("switch", { name: "Ticket cuisine automatique" })).toBeChecked();

    // En ligne : la carte et les tables sont conservées sur l'appareil
    await page.goto(`/r/${SLUG}/commandes/nouvelle`);
    await expect(page.getByRole("tab").first()).toBeVisible();
    await expect.poll(async () => (await readDb(page, SLUG))?.kv.sort().join(","), { timeout: 15_000 }).toBe("cache,profile");
    const snapshot = (await readDb(page, SLUG))!.cache;
    expect(snapshot.entries.map((e: any) => e.key.slice(2).join("/")).sort()).toEqual(expect.arrayContaining(["menu", "tables"]));
    expect(JSON.stringify(snapshot).match(/"total"|"paidAmount"|accessToken|refreshToken/i)).toBeNull();

    // ── Coupure réseau, rechargement de la page : l'application démarre depuis le service worker ──
    await ctx.setOffline(true);
    await page.reload();
    await expect(page.getByRole("tab").first()).toBeVisible({ timeout: 15_000 });     // carte lue sur l'appareil
    await expect(page.getByTestId("offline-status")).toContainText("Hors ligne");
    await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/offline-pos-1280.png` : undefined });

    const before = orderCount();
    const dish = await pickTableAndDish(page);
    await page.getByRole("button", { name: /Enregistrer hors ligne/ }).last().click();
    await expect(page.getByText(/Commande enregistrée hors ligne/)).toBeVisible();
    await expect(page.getByTestId("offline-status")).toContainText("1 commande en attente");
    expect(orderCount()).toBe(before);                                                                       // rien côté serveur

    // Ticket cuisine imprimé tout de suite, avec une référence locale et le plat, par poste
    await expect.poll(async () => (await prints(page)).length).toBe(1);
    const ticket = (await prints(page))[0]!;
    expect(ticket).toMatch(/CUISINE/); expect(ticket).toMatch(/HORS LIGNE\s*L-[A-Z0-9]{4}/); expect(ticket).toContain(dish);
    const queued = (await readDb(page, SLUG))!.queue;
    expect(queued).toHaveLength(1);
    expect(queued[0].id).toMatch(/^[0-9a-f-]{36}$/);                                                          // clé d'idempotence

    // ── Retour du réseau, mais la RÉPONSE du premier envoi est perdue : le serveur a créé la commande, le client ne le sait pas ──
    let dropped = 0; const replayed: string[] = [];
    await page.route("**/api/v1/tenant/orders", async (route) => {
      if (route.request().method() === "POST" && dropped === 0) { dropped++; await route.fetch(); await route.abort("connectionreset"); return; }
      await route.continue();
    });
    page.on("response", (r) => { if (r.url().endsWith("/api/v1/tenant/orders") && r.request().method() === "POST") replayed.push(r.headers()["idempotent-replayed"] ?? "no"); });
    await ctx.setOffline(false);

    await expect(page.getByText(/Commande n°\d+ envoyée en cuisine/)).toBeVisible({ timeout: 40_000 });
    expect(dropped).toBe(1);
    expect(replayed).toEqual(["true"]);                                                                       // 2e envoi = réponse rejouée
    expect(orderCount()).toBe(before + 1);                                                                    // UNE seule commande
    await expect(page.getByTestId("offline-status")).toHaveCount(0);
    expect((await readDb(page, SLUG))!.queue).toHaveLength(0);
    expect(keyRows()).toBeGreaterThan(0);
    // pas de nouveau ticket à l'envoi (déjà imprimé hors ligne)
    expect((await prints(page)).length).toBe(1);

    // ── Aucune réponse de l'API dans les caches du navigateur ──
    const cached = await page.evaluate(async () => {
      const out: string[] = [];
      for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) out.push(`${n} ${new URL(r.url).pathname}`);
      return out;
    });
    expect(cached.length).toBeGreaterThan(20);
    expect(cached.filter((c) => /\/api\/|socket\.io/.test(c))).toEqual([]);
    expect(cached.some((c) => c.includes("/index.html"))).toBe(true);

    expect(errors).toEqual([]);
    await ctx.close();
  });

  test("déconnexion : plus aucune donnée du restaurant ; avertissement si des commandes ne sont pas envoyées", async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginUi(page, "waiter", "/commandes/nouvelle");
    await swControlled(page);
    await expect(page.getByRole("tab").first()).toBeVisible();
    await expect.poll(async () => (await readDb(page, SLUG))?.kv.length).toBe(2);

    await ctx.setOffline(true);
    await pickTableAndDish(page);
    await page.getByRole("button", { name: /Enregistrer hors ligne/ }).last().click();
    await expect(page.getByTestId("offline-status")).toContainText("1 commande en attente");
    await page.goto(`/r/${SLUG}/impression`);
    await expect(page.getByTestId("offline-queue").getByRole("listitem")).toHaveCount(1);
    await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/offline-queue-1280.png` : undefined });

    // Avec une commande non envoyée : confirmation avant de tout supprimer ; on reste connecté
    await page.locator("aside button", { hasText: "Serveur" }).click();
    await page.getByRole("menuitem", { name: "Se déconnecter" }).click();
    const dlg = page.getByRole("alertdialog").or(page.getByRole("dialog", { name: "Commandes non envoyées" }));
    await expect(dlg).toContainText("n'a pas encore été envoyée");
    await dlg.getByRole("button", { name: "Rester connecté" }).click();
    expect((await readDb(page, SLUG))!.queue).toHaveLength(1);

    // Réseau revenu : la commande part, puis la déconnexion vide tout
    await ctx.setOffline(false);
    await expect(page.getByTestId("offline-status")).toHaveCount(0, { timeout: 40_000 });
    await page.locator("aside button", { hasText: "Serveur" }).click();
    await page.getByRole("menuitem", { name: "Se déconnecter" }).click();
    await page.waitForURL(/\/login/);
    await expect.poll(() => readDb(page, SLUG)).toBeNull();
    const left = await page.evaluate(async () => ({
      caches: await caches.keys(),
      uploads: (await caches.has("uploads-v1")),
      storage: Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter((k) => /pos:|license|refresh/.test(k) && !/refresh$/.test(k)),
    }));
    expect(left.uploads).toBe(false);
    expect(left.storage).toEqual([]);
    await ctx.close();
  });

  test("aucune donnée d'un restaurant visible depuis un autre sur le même appareil", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginUi(page, "waiter", "/commandes/nouvelle");
    await expect(page.getByRole("tab").first()).toBeVisible();
    await expect.poll(async () => (await readDb(page, SLUG))?.kv.length).toBe(2);

    // Même appareil, autre restaurant (« demo ») : sa propre base, ses propres identifiants
    await page.goto("/r/demo/login");
    await page.getByLabel("Email").fill("waiter@demo.demo");
    await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await page.waitForURL((u) => !u.pathname.endsWith("/login"));
    await page.goto("/r/demo/commandes/nouvelle");
    await expect(page.getByRole("tab").first()).toBeVisible();
    await expect.poll(async () => (await readDb(page, "demo"))?.kv.length).toBe(2);
    const a = (await readDb(page, SLUG))!, b = (await readDb(page, "demo"))!;
    const ids = (s: any) => new Set<string>(JSON.stringify(s.cache).match(/[0-9a-f]{8}-[0-9a-f-]{27}/g));
    const A = ids(a), B = ids(b);
    expect(A.size).toBeGreaterThan(10); expect(B.size).toBeGreaterThan(10);
    expect([...A].filter((x) => B.has(x))).toEqual([]);                                                       // aucun identifiant en commun
    // L'instantané d'un restaurant n'est jamais restauré dans l'autre : les requêtes de « demo » portent la racine ["tenant","demo"]
    expect(b.cache.entries.every((e: any) => e.key[1] === "demo")).toBe(true);
    expect(a.cache.entries.every((e: any) => e.key[1] === SLUG)).toBe(true);
    await ctx.close();
  });

  test("encaissement hors ligne interdit (message clair, bouton désactivé)", async ({ browser }) => {
    const waiter = await apiAs("waiter");
    const menu = (await waiter("GET", "/tenant/menu")) as { items: { id: string; price: number; optionGroups: unknown[] }[] }[];
    const dish = menu.flatMap((c) => c.items).find((i) => i.optionGroups.length === 0 && i.price > 0)!;
    const order = await waiter("POST", "/tenant/orders", { type: "TAKEAWAY", items: [{ menuItemId: dish.id, quantity: 1 }] });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginUi(page, "waiter", `/commandes/${order.id}/encaisser`);
    const pay = page.getByRole("button", { name: /^Encaisser/ }).last();
    await expect(pay).toBeVisible();
    await ctx.setOffline(true);
    await expect(page.getByText("Encaissement impossible hors ligne").first()).toBeVisible();
    await expect(pay).toBeDisabled();
    await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/offline-checkout-1280.png` : undefined });
    await ctx.setOffline(false);
    await expect(page.getByText("Encaissement impossible hors ligne")).toHaveCount(0, { timeout: 15_000 });
    await ctx.close();
  });
});

test.describe("Impression ESC/POS (faux port série)", () => {
  test("test d'impression, ticket cuisine automatique et réimpression", async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      const bytes: number[] = [];
      (window as any).__serial = bytes;
      const port = { getInfo: () => ({ usbVendorId: 0x4b43, usbProductId: 0x3830 }), open: async () => undefined, close: async () => undefined,
        writable: { getWriter: () => ({ write: async (d: Uint8Array) => { bytes.push(...d); }, releaseLock: () => undefined }) } };
      Object.defineProperty(navigator, "serial", { value: { getPorts: async () => [port], requestPort: async () => port }, configurable: true });
    });
    await stubPrint(ctx);
    const page = await ctx.newPage();
    await loginUi(page, "waiter", "/impression");
    await page.getByRole("radio", { name: /Série/ }).click();
    await page.getByRole("button", { name: "Connecter une imprimante" }).click();
    await expect(page.getByText(/Série USB/)).toBeVisible();
    await page.getByRole("button", { name: "Imprimer un ticket de test" }).click();
    await expect(page.getByText("Ticket de test envoyé")).toBeVisible();
    const sent = () => page.evaluate(() => (window as any).__serial as number[]);
    let b = await sent();
    expect(b.slice(0, 5)).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
    expect(Buffer.from(b).toString("latin1")).toContain("TEST D'IMPRESSION");
    expect(b.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0]);                                                       // coupe

    await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/print-settings-1280.png` : undefined });
    await page.getByRole("switch", { name: "Ticket cuisine automatique" }).click();

    // Création d'une commande EN LIGNE : le ticket cuisine part sur l'imprimante ESC/POS, pas sur le navigateur
    await page.goto(`/r/${SLUG}/commandes/nouvelle`);       // (la page est rechargée : le faux port repart de zéro)
    const before = (await sent()).length;
    const dish = await pickTableAndDish(page);
    await page.getByRole("button", { name: /Envoyer en cuisine/ }).last().click();
    await page.waitForURL(/\/commandes\/[0-9a-f-]{36}$/);
    await expect.poll(async () => (await sent()).length).toBeGreaterThan(before);
    b = (await sent()).slice(before);
    const txt = Buffer.from(b).toString("latin1");
    expect(txt).toContain("CUISINE"); expect(txt).toContain(dish); expect(txt).toMatch(/N.{1,2} \d+/);
    expect(await prints(page)).toHaveLength(0);                                                               // pilote navigateur non utilisé

    // Réimpression manuelle : le ticket est marqué (É = 0x90 en CP858)
    const n = (await sent()).length;
    await page.getByTestId("reprint-kitchen").click();
    await expect.poll(async () => (await sent()).length).toBeGreaterThan(n);
    const re = (await sent()).slice(n);
    expect(re).toEqual(expect.arrayContaining([0x90]));
    expect(Buffer.from(re).toString("latin1")).toContain("R");
    expect(Buffer.from(re).toString("latin1")).toContain("IMPRESSION");
    // ── Pilote navigateur : ticket rendu en 80 mm, gros caractères, par poste ──
    await page.goto(`/r/${SLUG}/impression`);
    await page.getByRole("radio", { name: /Navigateur/ }).click();
    await page.goto(`/r/${SLUG}/commandes/nouvelle`);
    const dish2 = await pickTableAndDish(page);
    await page.getByRole("button", { name: /Envoyer en cuisine/ }).last().click();
    await page.waitForURL(/\/commandes\/[0-9a-f-]{36}$/);
    await expect.poll(async () => (await prints(page)).length).toBe(1);
    const t = (await prints(page))[0]!;
    expect(t).toContain("CUISINE"); expect(t).toContain(dish2);
    expect(t).toMatch(/ENTRÉES|PLATS|BOISSONS|DESSERTS/);                                                                   // en-tête de poste en majuscules
    await page.getByTestId("reprint-kitchen").click();
    await expect.poll(async () => (await prints(page)).length).toBe(2);
    expect((await prints(page))[1]).toContain("RÉIMPRESSION");
    await ctx.close();
  });

});

void email;
