import { expect, test, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import { apiAs, ensureRestaurant, loginUi, SLUG, sql } from "./support";

/**
 * X5B : notifications push web de l'équipe. À lancer sur le BUILD de production derrière nginx (CSP stricte), API démarrée avec des clés VAPID
 * de test et `PUSH_DRIVER=log` (rien ne sort du serveur) : `E2E_BASE_URL=http://localhost:8081 pnpm --filter web test:e2e push`.
 *
 * Le service de push du navigateur (FCM…) est injoignable dans ce bac à sable : `PushManager.subscribe` est simulé (abonnement factice persistant),
 * tout le reste est réel (autorisation, service worker de production, API, journal X1). Le gestionnaire `push` du service worker reçoit de vrais
 * événements `push` livrés par le protocole DevTools (`ServiceWorker.deliverPushMessage`) avec la charge utile LUE DANS LE JOURNAL de l'API.
 * Le clic est un `notificationclick` synthétique (un clic sur une notification du système n'est pas pilotable) ; `clients.openWindow` y est intercepté.
 */
test.skip(!/^http:\/\/localhost:(8\d{3}|4173)/.test(process.env.E2E_BASE_URL ?? ""), "Service worker : lancer sur le build de production (nginx :8081 ou vite preview :4173).");
test.describe.configure({ mode: "serial" });

const ORIGIN = process.env.E2E_BASE_URL ?? "http://localhost:8081";
const tenantId = () => sql(`select id from "Tenant" where slug = '${SLUG}'`);
const pushRows = (where = "true") => sql(`select count(*) from "PushSubscription" where "tenantId" = '${tenantId()}' and ${where}`);
const demoPushLogs = () => Number(sql(`select count(*) from "NotificationLog" where channel = 'PUSH' and "tenantId" = (select id from "Tenant" where slug = 'demo')`));

/** Simule UNIQUEMENT le service de push du navigateur : abonnement factice, conservé entre les rechargements. */
async function fakePushService(ctx: BrowserContext, opts: { permission?: "denied" } = {}) {
  await ctx.addInitScript((o) => {
    const KEY = "__fake-push";
    const toB64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
    const make = (s: { id: string; key: string }) => ({
      endpoint: `https://fcm.googleapis.com/fcm/send/${s.id}`,
      options: { applicationServerKey: Uint8Array.from(atob(s.key), (c) => c.charCodeAt(0)).buffer },
      toJSON() { return { endpoint: this.endpoint, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } }; },
      async unsubscribe() { localStorage.removeItem(KEY); return true; },
    });
    if (window.PushManager) {
      PushManager.prototype.getSubscription = async () => { const s = localStorage.getItem(KEY); return s ? (make(JSON.parse(s)) as unknown as PushSubscription) : null; };
      PushManager.prototype.subscribe = async (options?: PushSubscriptionOptionsInit) => {
        const s = { id: `pw-${crypto.randomUUID()}-${"x".repeat(40)}`, key: toB64(options!.applicationServerKey as ArrayBuffer) };
        localStorage.setItem(KEY, JSON.stringify(s));
        return make(s) as unknown as PushSubscription;
      };
    }
    if (o.permission === "denied") Object.defineProperty(Notification, "permission", { get: () => "denied" });
  }, opts);
}

async function swControlled(page: Page) {
  await page.waitForFunction(async () => { const r = await navigator.serviceWorker?.getRegistration(); return !!r?.active && !!navigator.serviceWorker.controller; }, null, { timeout: 30_000 });
}
const fakeEndpoint = (page: Page) => page.evaluate(() => { const s = localStorage.getItem("__fake-push"); return s ? `https://fcm.googleapis.com/fcm/send/${JSON.parse(s).id}` : null; });
const shown = (page: Page) => page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg!.getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, icon: new URL(n.icon).pathname, badge: new URL(n.badge).pathname, renotify: (n as Notification & { renotify: boolean }).renotify, url: (n.data as { url: string }).url }));
});

/** Livre un VRAI événement `push` au service worker (protocole DevTools, sans service de push). */
async function deliverPush(cdp: CDPSession, registrationId: string, data: unknown) {
  await cdp.send("ServiceWorker.deliverPushMessage", { origin: ORIGIN, registrationId, data: typeof data === "string" ? data : JSON.stringify(data) });
}
async function registrationId(cdp: CDPSession): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("inscription du service worker introuvable")), 15_000);
    cdp.on("ServiceWorker.workerRegistrationUpdated", (e: { registrations: { registrationId: string; scopeURL: string }[] }) => {
      const r = e.registrations.find((x) => x.scopeURL.startsWith(ORIGIN));
      if (r) { clearTimeout(timer); resolve(r.registrationId); }
    });
    void cdp.send("ServiceWorker.enable");
  });
}

type Logged = { template: string; status: string; to: string; payload: { title: string; body: string; url: string; tag: string } };
async function journal(): Promise<Logged[]> {
  const admin = await apiAs("admin");
  return (await admin("GET", "/tenant/notifications?channel=PUSH&pageSize=100")).items as Logged[];
}

/** La livraison est une fonctionnalité du plan : le restaurant de test passe temporairement sur un plan qui l'inclut (rétabli à la fin). */
let originalPlan = "";
let originalOps: string | null = null;
test.beforeAll(() => {
  ensureRestaurant();
  const where = `"tenantId" = '${tenantId()}'`;
  sql(`delete from "PushSubscription" where ${where}`);                                       // scénario rejouable : état propre
  sql(`delete from "NotificationLog" where channel = 'PUSH' and ${where}`);
  originalPlan = sql(`select "planId" from "Subscription" where ${where}`);
  sql(`update "Subscription" set "planId" = (select id from "Plan" where features->>'delivery' = 'true' order by "sortOrder" limit 1) where ${where}`);
  originalOps = sql(`select value::text from "Setting" where key = 'operations' and ${where}`) || null;
  sql(`insert into "Setting" ("tenantId", key, value) values ('${tenantId()}', 'operations', '{"deliveryEnabled": true}')
       on conflict ("tenantId", key) do update set value = "Setting".value || '{"deliveryEnabled": true}'::jsonb`);
});
test.afterAll(() => {
  const where = `"tenantId" = '${tenantId()}'`;
  if (originalPlan) sql(`update "Subscription" set "planId" = '${originalPlan}' where ${where}`);
  if (originalOps) sql(`update "Setting" set value = '${originalOps.replace(/'/g, "''")}'::jsonb where key = 'operations' and ${where}`);
  else sql(`delete from "Setting" where key = 'operations' and ${where}`);
});

test.describe("Notifications push de l'équipe (build de production, nginx, CSP stricte)", () => {
  test("serveur : activation sur geste, événements du restaurant journalisés (X1), affichage par le service worker, clic, déconnexion", async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext();
    await ctx.grantPermissions(["notifications"], { origin: ORIGIN });
    await fakePushService(ctx);
    const page = await ctx.newPage();
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(e.message));
    page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text()); });

    // ── Activation : le bouton déclenche l'autorisation puis l'abonnement ──
    await loginUi(page, "waiter");
    await swControlled(page);
    await page.goto(`/r/${SLUG}/impression`);
    const card = page.getByRole("heading", { name: "Notifications sur cet appareil" });
    await expect(card).toBeVisible();
    await expect(page.getByTestId("push-state")).toHaveAttribute("data-state", "off");
    expect(await pushRows()).toBe("0");                                                   // rien n'est enregistré avant le geste
    await page.getByRole("button", { name: "Activer" }).click();
    await expect(page.getByTestId("push-state")).toHaveAttribute("data-state", "on");
    const endpoint = (await fakeEndpoint(page))!;
    expect(endpoint).toMatch(/^https:\/\/fcm\.googleapis\.com\/fcm\/send\/pw-/);
    expect(sql(`select "userId" = (select id from "User" where email = 'waiter@${SLUG}.demo') from "PushSubscription" where endpoint = '${endpoint}'`)).toBe("t");
    expect(await pushRows(`endpoint = '${endpoint}'`)).toBe("1");
    await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/push-card-on-1280.png` : undefined });

    // Bouton « Tester » : envoi au journal, charge utile exacte
    await page.getByRole("button", { name: "Tester" }).click();
    await expect.poll(async () => (await journal()).filter((j) => j.template === "push.test").length).toBe(1);
    expect((await journal()).find((j) => j.template === "push.test")).toMatchObject({ status: "SENT", payload: { title: "Notification de test", url: `/r/${SLUG}/impression`, tag: "test" } });

    // ── Événements du restaurant : livraison attribuée, commande prête, nouvelle commande ──
    const kitchen = await apiAs("kitchen"), driver = await apiAs("driver"), manager = await apiAs("manager"), waiter = await apiAs("waiter");
    const sub = (n: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/pw-${n}-${"x".repeat(40)}`, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } });
    expect((await kitchen("POST", "/tenant/push/subscriptions", sub("kitchen"))).created).toBeDefined();
    expect((await driver("POST", "/tenant/push/subscriptions", sub("driver"))).created).toBeDefined();
    const menu = (await waiter("GET", "/tenant/menu")) as { items: { id: string; optionGroups: unknown[]; isAvailable?: boolean }[] }[];
    const dish = menu.flatMap((c) => c.items).find((i) => i.optionGroups.length === 0 && i.isAvailable !== false)!;
    const tables = (await waiter("GET", "/tenant/tables")) as { id: string; status: string; isActive: boolean }[];
    const table = tables.find((t) => t.isActive && t.status === "FREE")!;
    const demoBefore = demoPushLogs();

    const order = await waiter("POST", "/tenant/orders", { type: "DINE_IN", tableId: table.id, items: [{ menuItemId: dish.id, quantity: 2 }] });
    expect(order.id).toBeTruthy();
    await kitchen("POST", `/tenant/orders/${order.id}/advance`, { status: "READY" });

    // Livraison : commande, attribution au livreur, cuisine prête
    const zones = (await manager("GET", "/tenant/delivery/zones")) as { id: string; neighborhoods: string[] }[];
    const dOrder = await waiter("POST", "/tenant/orders", {
      type: "DELIVERY", customerName: "Client Test", customerPhone: "90 55 44 33",
      delivery: { zoneId: zones[0]!.id, neighborhood: zones[0]!.neighborhoods[0], address: "Rue des Palmiers, villa 12", landmark: "Près de la pharmacie" },
      items: [{ menuItemId: dish.id, quantity: 4 }],      // au-dessus du minimum de la zone
    });
    expect(dOrder.delivery?.id, JSON.stringify(dOrder)).toBeTruthy();
    const drivers = (await manager("GET", "/tenant/delivery/drivers")) as { id: string }[];
    expect((await manager("POST", `/tenant/delivery/${dOrder.delivery.id}/assign`, { driverId: drivers[0]!.id })).id).toBeTruthy();
    await kitchen("POST", `/tenant/orders/${dOrder.id}/advance`, { status: "READY" });

    await expect.poll(async () => (await journal()).length, { timeout: 15_000 }).toBe(7);
    const log = await journal();
    const find = (template: string) => log.filter((j) => j.template === template && j.status === "SENT");
    // Un seul envoi par événement et par appareil
    expect(find("push.kitchen-new-order")).toHaveLength(2);                              // 2 commandes × 1 appareil cuisine
    expect(find("push.delivery-assigned")).toHaveLength(1);
    expect(find("push.delivery-ready")).toHaveLength(1);
    expect(find("push.order-ready")).toHaveLength(2);                                    // commande sur place + livraison : le serveur qui l'a prise
    expect(find("push.delivery-assigned")[0]!.payload).toEqual({ title: "Nouvelle livraison", body: `La commande n°${dOrder.number} vous est attribuée.`, url: `/r/${SLUG}/mes-livraisons`, tag: `delivery:${dOrder.delivery.id}` });
    expect(find("push.delivery-ready")[0]!.payload).toMatchObject({ title: "Commande prête", url: `/r/${SLUG}/mes-livraisons` });
    expect(find("push.kitchen-new-order").map((j) => j.payload.url)).toEqual([`/r/${SLUG}/cuisine`, `/r/${SLUG}/cuisine`]);
    const readyForWaiter = find("push.order-ready").find((j) => j.payload.tag === `order:${order.id}`)!;
    expect(readyForWaiter.payload).toMatchObject({ title: "Commande prête", url: `/r/${SLUG}/commandes/${order.id}` });
    // Aucune donnée sensible (adresse, téléphone, nom, montants) dans ce qui part vers les appareils
    const texts = log.map((j) => `${j.payload.title} ${j.payload.body}`).join("\n");       // ce qui s'affiche sur l'écran verrouillé
    for (const re of [/Palmiers/i, /pharmacie/i, /55 ?44 ?33/, /Client Test/, /FCFA|XOF/, /\b\d{4,}\b/]) expect(texts).not.toMatch(re);
    // Isolation : rien n'est parti vers un autre restaurant
    expect(demoPushLogs()).toBe(demoBefore);

    // ── Service worker : le gestionnaire `push` affiche la notification (application fermée) ──
    const ctl = await ctx.newPage();
    const cdp = await ctx.newCDPSession(ctl);
    const regId = await registrationId(cdp);
    await page.goto("about:blank");                                                         // plus aucun onglet de l'application : l'alerte doit s'afficher
    await deliverPush(cdp, regId, readyForWaiter.payload);
    await page.goto(`/r/${SLUG}/impression`);
    await expect.poll(async () => (await shown(page)).length, { timeout: 15_000 }).toBe(1);
    expect(await shown(page)).toEqual([{
      title: "Commande prête", body: readyForWaiter.payload.body, tag: `order:${order.id}`, icon: "/icons/icon-192.png", badge: "/icons/badge-96.png", renotify: true, url: `/r/${SLUG}/commandes/${order.id}`,
    }]);
    // Même `tag` : l'alerte est remplacée (une seule notification par commande)
    await page.goto("about:blank");
    await deliverPush(cdp, regId, { ...readyForWaiter.payload, body: "Mise à jour" });
    await page.goto(`/r/${SLUG}/impression`);
    await expect.poll(async () => (await shown(page))[0]?.body, { timeout: 15_000 }).toBe("Mise à jour");
    expect(await shown(page)).toHaveLength(1);

    // Application visible : pas de doublon avec les messages à l'écran (sauf le test demandé par l'utilisateur)
    await deliverPush(cdp, regId, { title: "Nouvelle commande", body: "Commande n°9 · 1 article.", url: `/r/${SLUG}/cuisine`, tag: "kitchen:visible" });
    await page.waitForTimeout(1500);
    expect((await shown(page)).map((n) => n.tag)).toEqual([`order:${order.id}`]);
    await deliverPush(cdp, regId, { title: "Notification de test", body: "Test", url: `/r/${SLUG}/impression`, tag: "test" });
    await expect.poll(async () => (await shown(page)).map((n) => n.tag).sort(), { timeout: 15_000 }).toEqual([`order:${order.id}`, "test"]);

    // Charge illisible ou adresse externe : alerte générique, jamais d'erreur ni d'adresse hors de l'origine
    await page.goto("about:blank");
    await deliverPush(cdp, regId, "pas du json");
    await deliverPush(cdp, regId, { title: "Piège", body: "x", url: "https://evil.example.org/phish", tag: "piege" });
    await page.goto(`/r/${SLUG}/impression`);
    await expect.poll(async () => (await shown(page)).map((n) => n.tag).sort(), { timeout: 15_000 }).toEqual(["alerte", `order:${order.id}`, "piege", "test"]);
    expect((await shown(page)).find((n) => n.tag === "piege")!.url).toBe("/");

    // ── notificationclick (événement synthétique, openWindow intercepté) ──
    const click = (tag: string, withOpenSpy: boolean) => ctx.serviceWorkers()[0]!.evaluate(async ({ tag, withOpenSpy }) => {
      const sw = self as unknown as { registration: ServiceWorkerRegistration; clients: Clients; dispatchEvent(e: Event): boolean };
      const opened: string[] = [];
      if (withOpenSpy) (sw.clients as unknown as { openWindow: (u: string) => Promise<null> }).openWindow = async (u) => { opened.push(u); return null; };
      const n = (await sw.registration.getNotifications({ tag }))[0]!;
      const e = new NotificationEvent("notificationclick", { notification: n });
      sw.dispatchEvent(e);
      await new Promise((r) => setTimeout(r, 800));
      return { opened, stillShown: (await sw.registration.getNotifications({ tag })).length };
    }, { tag, withOpenSpy });
    // 1) un onglet du restaurant est ouvert : il navigue (sans rechargement) vers la bonne page
    await page.evaluate(() => { (window as unknown as { __same: string }).__same = "pas rechargé"; });
    const r1 = await click(`order:${order.id}`, true);
    expect(r1.opened).toEqual([]);
    expect(r1.stillShown).toBe(0);                                                          // notification fermée
    await expect(page).toHaveURL(new RegExp(`/r/${SLUG}/commandes/${order.id}$`));
    expect(await page.evaluate(() => (window as unknown as { __same?: string }).__same)).toBe("pas rechargé");
    // 2) adresse externe : jamais ouverte, retour à l'accueil de l'application
    await page.goto("about:blank");
    const r2 = await click("piege", true);
    expect(r2.opened).toEqual([`${ORIGIN}/`]);
    // 3) aucun onglet : ouverture de la page visée (nouvelle fenêtre, adresse de l'origine)
    const r3 = await click("test", true);
    expect(r3.opened).toEqual([`${ORIGIN}/r/${SLUG}/impression`]);

    // ── Déconnexion : abonnement supprimé côté navigateur ET côté API ──
    await page.goto(`/r/${SLUG}/impression`);
    await expect(page.getByTestId("push-state")).toHaveAttribute("data-state", "on");
    await page.locator("aside button", { hasText: "Serveur" }).click();
    await page.getByRole("menuitem", { name: "Se déconnecter" }).click();
    await expect.poll(() => pushRows(`endpoint = '${endpoint}'`)).toBe("0");
    expect(await fakeEndpoint(page)).toBeNull();
    // Les autres appareils (cuisine, livreur) restent abonnés
    expect(await pushRows(`endpoint like '%pw-kitchen-%' or endpoint like '%pw-driver-%'`)).toBe("2");
    expect(problems).toEqual([]);
    await ctx.close();
  });

  test("livreur : rappel sur l'accueil, activation sans passer par l'impression, désactivation", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.grantPermissions(["notifications"], { origin: ORIGIN });
    await fakePushService(ctx);
    const page = await ctx.newPage();
    await loginUi(page, "driver");
    await swControlled(page);
    await expect(page).toHaveURL(new RegExp(`/r/${SLUG}/mes-livraisons$`));
    const reminder = page.getByTestId("push-reminder");
    await expect(reminder).toBeVisible();
    await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/push-reminder-driver-390.png` : undefined });
    await reminder.getByRole("button", { name: "Activer" }).click();
    await expect(reminder).toBeHidden();
    const endpoint = (await fakeEndpoint(page))!;
    expect(await pushRows(`endpoint = '${endpoint}'`)).toBe("1");
    // Écran « Notifications » du livreur : état activé, désactivation
    await page.goto(`/r/${SLUG}/impression`);
    await expect(page.getByRole("heading", { name: "Notifications sur cet appareil" })).toBeVisible();
    await expect(page.getByText("Commandes hors ligne")).toHaveCount(0);                    // le livreur ne voit que ses notifications
    await page.getByRole("button", { name: "Désactiver" }).click();
    await expect(page.getByTestId("push-state")).toHaveAttribute("data-state", "off");
    await expect.poll(() => pushRows(`endpoint = '${endpoint}'`)).toBe("0");
    await ctx.close();
  });

  test("changement de compte sur le même appareil : l'abonnement suit le compte connecté", async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.grantPermissions(["notifications"], { origin: ORIGIN });
    await fakePushService(ctx);
    const page = await ctx.newPage();
    await loginUi(page, "kitchen", "/impression");
    await swControlled(page);
    await page.getByRole("button", { name: "Activer" }).click();
    await expect(page.getByTestId("push-state")).toHaveAttribute("data-state", "on");
    const endpoint = (await fakeEndpoint(page))!;
    const owner = () => sql(`select u.email from "PushSubscription" p join "User" u on u.id = p."userId" where p.endpoint = '${endpoint}'`);
    expect(owner()).toBe(`kitchen@${SLUG}.demo`);
    // Session expirée de la cuisine (jetons effacés sans déconnexion), puis le gérant se connecte sur le même appareil
    await ctx.clearCookies();
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k !== "__fake-push" && /token|refresh|session/i.test(k)) localStorage.removeItem(k); });
    await loginUi(page, "manager", "/impression");
    await expect.poll(owner, { timeout: 15_000 }).toBe(`manager@${SLUG}.demo`);
    await ctx.close();
  });

  test("états de la carte : autorisation refusée (marche à suivre), iPhone non installé (ajout à l'écran d'accueil)", async ({ browser }) => {
    const denied = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await fakePushService(denied, { permission: "denied" });
    const p1 = await denied.newPage();
    await loginUi(p1, "waiter", "/impression");
    await swControlled(p1);
    await expect(p1.getByTestId("push-state")).toHaveAttribute("data-state", "denied");
    await expect(p1.getByText("Les notifications sont bloquées pour ce site")).toBeVisible();
    await expect(p1.getByRole("button", { name: "Activer" })).toHaveCount(0);
    await p1.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/push-card-denied-390.png` : undefined });
    await denied.close();

    const iphone = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    });
    await iphone.addInitScript(() => { delete (window as { PushManager?: unknown }).PushManager; delete (window as { Notification?: unknown }).Notification; });   // Safari iOS hors application installée
    const p2 = await iphone.newPage();
    await loginUi(p2, "waiter", "/impression");
    await expect(p2.getByTestId("push-state")).toHaveAttribute("data-state", "ios-install");
    await expect(p2.getByText("Sur iPhone, ajoutez d'abord l'application à l'écran d'accueil")).toBeVisible();
    await expect(p2.getByRole("button", { name: "Activer" })).toHaveCount(0);
    await p2.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/push-card-ios-390.png` : undefined });
    await iphone.close();
  });
});
