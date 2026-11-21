import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { PushGoneError } from "../src/notifications/drivers/push";
import type { PushDriver, PushMessage } from "../src/notifications/drivers/types";
import { NotificationsService } from "../src/notifications/notifications.service";
import { RetentionService } from "../src/security/retention.service";
import { asPlatform, createApp, login, resetDb, seedPlatform } from "./helpers";

const PW = "Cigale-Bleue74";
const V = "/api/v1";
const ZERO = "00000000-0000-4000-8000-000000000000";
const sub = (n: string, host = "fcm.googleapis.com") => ({
  endpoint: `https://${host}/fcm/send/${n}-${"x".repeat(60)}`,
  keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" },
});

describe("X5B Notifications push web de l'équipe (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let notif: NotificationsService;
  let root: string;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const pws: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  const subscribe = (who: string, n: string, host?: string) => api().post(`${V}/tenant/push/subscriptions`).set(as(who)).send(sub(n, host));
  const rows = (where = "") => asPlatform(prisma, (tx) => tx.$queryRawUnsafe<{ endpoint: string; userId: string; tenantId: string }[]>(`SELECT endpoint, "userId", "tenantId" FROM "PushSubscription" ${where}`));
  const journal = (who: string, q = "?channel=PUSH&pageSize=100") => api().get(`${V}/tenant/notifications${q}`).set(as(who)).expect(200).then((r) => r.body);
  /** Envois capturés par le pilote `log`, filtrés sur l'appareil (endpoint) d'un compte. */
  const sentTo = (n: string) => notif.pushOutbox.filter((m) => m.target.endpoint.includes(`/${n}-`)).map((m) => ({ ...JSON.parse(m.payload), ttl: m.ttl, urgency: m.urgency }));
  const reset = async () => { await notif.flush(); notif.pushOutbox.length = 0; };

  const tenantLogin = (slug: string, email: string, password = PW) =>
    api().post(`${V}/tenant/auth/login`).send({ tenantSlug: slug, email, password });
  const makeTenant = async (slug: string, planId: string) => {
    const res = await api().post(`${V}/platform/tenants`).set({ Authorization: `Bearer ${root}` }).send({
      name: `Chez ${slug}`, slug, email: `contact@${slug}.tg`, planId, admin: { firstName: "Ama", lastName: "Koffi", email: `admin@${slug}.tg`, password: PW },
    });
    expect(res.status).toBe(201);
    await asPlatform(prisma, (tx) => tx.user.updateMany({ where: { tenantId: res.body.id }, data: { mustChangePassword: false } }));
    ids[`t-${slug}`] = res.body.id;
  };
  const addStaff = async (slug: string, adminKey: string, who: string, role: string) => {
    const res = await api().post(`${V}/tenant/staff`).set(as(adminKey)).send({ email: `${who}@${slug}.tg`, firstName: who, lastName: "Test", role, phone: "91 00 00 01" });
    expect(res.status).toBe(201);
    const l = await tenantLogin(slug, `${who}@${slug}.tg`, res.body.temporaryPassword);
    await asPlatform(prisma, (tx) => tx.user.updateMany({ where: { email: `${who}@${slug}.tg` }, data: { mustChangePassword: false } }));
    ids[who] = res.body.id;
    pws[who] = res.body.temporaryPassword;
    tok[who] = (await tenantLogin(slug, `${who}@${slug}.tg`, res.body.temporaryPassword)).body.accessToken ?? l.body.accessToken;
  };

  beforeAll(async () => {
    prisma = new PrismaClient();
    await resetDb(prisma);
    const seed = await seedPlatform(prisma);
    await prisma.plan.update({ where: { id: seed.pro.id }, data: { features: { delivery: true } } });
    app = await createApp();
    notif = app.get(NotificationsService);
    root = (await login(app, "root@test.local")).body.accessToken;
    await makeTenant("lome", seed.pro.id);
    await makeTenant("voisin", seed.pro.id);
    tok.admin = (await tenantLogin("lome", "admin@lome.tg")).body.accessToken;
    tok.voisin = (await tenantLogin("voisin", "admin@voisin.tg")).body.accessToken;
    ids.voisinAdmin = (await api().get(`${V}/tenant/account/me`).set(as("voisin"))).body.id;
    for (const [who, role] of [["manager", "MANAGER"], ["waiter", "WAITER"], ["kitchen", "KITCHEN"], ["kossi", "DRIVER"], ["yao", "DRIVER"]] as const) await addStaff("lome", "admin", who, role);
    await addStaff("voisin", "voisin", "kitchenv", "KITCHEN");
    // Cuisine, zone, plats.
    const plats = (await api().post(`${V}/tenant/menu/categories`).set(as("manager")).send({ name: "Plats" })).body.id;
    ids.riz = (await api().post(`${V}/tenant/menu/items`).set(as("manager")).send({ categoryId: plats, name: "Riz sauce arachide", price: 3500, vatRate: 10 })).body.id;
    ids.zone = (await api().post(`${V}/tenant/delivery/zones`).set(as("manager")).send({ name: "Centre", neighborhoods: ["Tokoin"], fee: 1000, minOrder: 0, etaMinutes: 30 }).expect(201)).body.id;
    await api().patch(`${V}/tenant/settings/operations`).set(as("admin")).send({ deliveryEnabled: true }).expect(200);
    ids.tableA = (await api().post(`${V}/tenant/tables`).set(as("manager")).send({ label: "T1", capacity: 4 })).body.id;
  });
  afterAll(async () => {
    await notif.flush();
    await app.close();
    await prisma.$disconnect();
  });

  describe("configuration et abonnements", () => {
    it("config : clé publique et push actif ; sans jeton 401", async () => {
      expect((await api().get(`${V}/tenant/push/config`)).status).toBe(401);
      const res = await api().get(`${V}/tenant/push/config`).set(as("waiter")).expect(200);
      expect(res.body).toEqual({ enabled: true, publicKey: process.env.VAPID_PUBLIC_KEY });
      expect(JSON.stringify(res.body)).not.toContain(process.env.VAPID_PRIVATE_KEY!);
    });

    it("tout le personnel, livreur compris, peut s'abonner ; un client est refusé (403)", async () => {
      for (const who of ["admin", "manager", "waiter", "kitchen", "kossi"]) {
        const res = await subscribe(who, `role-${who}`).expect(200);
        expect(res.body).toMatchObject({ created: true, reassigned: false });
      }
      const signup = await api().post(`${V}/public/tenants/lome/customers`).send({ firstName: "Awa", lastName: "Client", email: "awa@lome.tg", password: PW, consent: true });
      expect(signup.status).toBe(201);
      tok.customer = (await tenantLogin("lome", "awa@lome.tg")).body.accessToken;
      expect((await subscribe("customer", "client")).status).toBe(403);
      expect((await api().get(`${V}/tenant/push/config`).set(as("customer"))).status).toBe(403);
      expect((await api().post(`${V}/tenant/push/test`).set(as("customer")).send({})).status).toBe(403);
      await api().delete(`${V}/tenant/push/subscriptions`).set(as("admin")).send({ endpoint: sub("role-admin").endpoint }).expect(204);
      await api().delete(`${V}/tenant/push/subscriptions`).set(as("manager")).send({ endpoint: sub("role-manager").endpoint }).expect(204);
      await api().delete(`${V}/tenant/push/subscriptions`).set(as("kossi")).send({ endpoint: sub("role-kossi").endpoint }).expect(204);
      await api().delete(`${V}/tenant/push/subscriptions`).set(as("kitchen")).send({ endpoint: sub("role-kitchen").endpoint }).expect(204);
      await api().delete(`${V}/tenant/push/subscriptions`).set(as("waiter")).send({ endpoint: sub("role-waiter").endpoint }).expect(204);
      expect(await rows()).toHaveLength(0);
    });

    it("validation : seul un service de push connu en https est accepté (anti-SSRF), clés obligatoires", async () => {
      for (const endpoint of ["http://fcm.googleapis.com/fcm/send/a", "https://127.0.0.1/x", "https://localhost/x", "https://evil.example.com/fcm", "https://fcm.googleapis.com.evil.com/x", "https://user:pw@fcm.googleapis.com/x", "n'importe quoi"]) {
        const res = await api().post(`${V}/tenant/push/subscriptions`).set(as("waiter")).send({ ...sub("v"), endpoint });
        expect([endpoint, res.status]).toEqual([endpoint, 400]);
        expect(res.body.errors?.length).toBeGreaterThan(0);
      }
      expect((await api().post(`${V}/tenant/push/subscriptions`).set(as("waiter")).send({ endpoint: sub("v").endpoint })).status).toBe(400);
      for (const host of ["updates.push.services.mozilla.com", "web.push.apple.com", "wns2-par02p.notify.windows.com"]) {
        expect((await subscribe("waiter", "ok", host)).status).toBe(200);
        await api().delete(`${V}/tenant/push/subscriptions`).set(as("waiter")).send({ endpoint: sub("ok", host).endpoint }).expect(204);
      }
    });

    it("création idempotente par endpoint (une seule ligne, userAgent abrégé)", async () => {
      const a = await api().post(`${V}/tenant/push/subscriptions`).set(as("waiter")).set("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36").send(sub("w1")).expect(200);
      const b = await subscribe("waiter", "w1").expect(200);   // sans User-Agent : l'abrégé déjà enregistré est conservé
      expect([a.body.created, b.body.created, b.body.id]).toEqual([true, false, a.body.id]);
      expect(await rows(`WHERE endpoint LIKE '%/w1-%'`)).toHaveLength(1);
      const ua = await asPlatform(prisma, (tx) => tx.pushSubscription.findUnique({ where: { id: a.body.id } }));
      expect(ua?.userAgent).toBe("Chrome · Android");
      expect(ua?.userId).toBe(ids.waiter);
    });

    it("un endpoint réutilisé par un autre compte est réattribué, même d'un autre restaurant (un appareil = un compte)", async () => {
      const res = await subscribe("kitchen", "w1").expect(200);
      expect(res.body).toMatchObject({ created: false, reassigned: true });
      expect(await rows(`WHERE endpoint LIKE '%/w1-%'`)).toEqual([expect.objectContaining({ userId: ids.kitchen, tenantId: ids["t-lome"] })]);
      const other = await subscribe("voisin", "w1").expect(200);
      expect(other.body.reassigned).toBe(true);
      expect(await rows(`WHERE endpoint LIKE '%/w1-%'`)).toEqual([expect.objectContaining({ userId: ids.voisinAdmin, tenantId: ids["t-voisin"] })]);
      // L'ancien compte ne peut plus le supprimer ni le tester ; celui du voisin, oui.
      await api().delete(`${V}/tenant/push/subscriptions`).set(as("kitchen")).send({ endpoint: sub("w1").endpoint }).expect(204);
      expect(await rows(`WHERE endpoint LIKE '%/w1-%'`)).toHaveLength(1);
      await api().delete(`${V}/tenant/push/subscriptions`).set(as("voisin")).send({ endpoint: sub("w1").endpoint }).expect(204);
      expect(await rows(`WHERE endpoint LIKE '%/w1-%'`)).toHaveLength(0);
    });

    it("test : 409 sans appareil, sinon une notification de test à soi-même (cet appareil)", async () => {
      expect((await api().post(`${V}/tenant/push/test`).set(as("waiter")).send({})).status).toBe(409);
      await subscribe("waiter", "wA").expect(200);
      await subscribe("waiter", "wB").expect(200);
      await reset();
      const res = await api().post(`${V}/tenant/push/test`).set(as("waiter")).send({ endpoint: sub("wA").endpoint }).expect(200);
      expect(res.body).toEqual({ sent: 1 });
      await notif.flush();
      expect(sentTo("wB")).toEqual([]);
      expect(sentTo("wA")).toEqual([{ title: "Notification de test", body: expect.stringContaining("Chez lome"), url: "/r/lome/impression", tag: "test", renotify: true, ttl: 300, urgency: "high" }]);
      const all = await api().post(`${V}/tenant/push/test`).set(as("waiter")).send({}).expect(200);
      expect(all.body.sent).toBe(2);
      await notif.flush();
    });
  });

  describe("événements poussés", () => {
    const delivery = (who: string) => api().post(`${V}/tenant/orders`).set(as(who)).send({
      type: "DELIVERY", customerName: "Afi Dossou", customerPhone: "90 55 44 33",
      delivery: { zoneId: ids.zone, neighborhood: "Tokoin", address: "Rue des Palmiers, villa 12", landmark: "Derrière la pharmacie du Marché" },
      items: [{ menuItemId: ids.riz, quantity: 2 }],
    });
    const dineIn = (who: string) => api().post(`${V}/tenant/orders`).set(as(who)).send({ type: "DINE_IN", tableId: ids.tableA, items: [{ menuItemId: ids.riz, quantity: 3 }] });
    const SENSITIVE = [/Palmiers/i, /pharmacie/i, /Tokoin/i, /55 ?44 ?33/, /Dossou/, /Afi/, /FCFA|XOF|CFA/, /\b\d{4,}\b/, /@/];

    beforeAll(async () => {
      await api().delete(`${V}/tenant/push/subscriptions`).set(as("waiter")).send({ endpoint: sub("wB").endpoint }).expect(204);
      await subscribe("kitchen", "k1").expect(200);
      await subscribe("kitchen", "k2").expect(200);
      await subscribe("kossi", "d1").expect(200);
      await subscribe("yao", "d2").expect(200);
      await subscribe("waiter", "wA").expect(200);
      await subscribe("manager", "m1").expect(200);
      await subscribe("voisin", "v1").expect(200);
    });

    it("cuisine : nouvelle commande → seulement les comptes KITCHEN du restaurant, un envoi par appareil, TTL court et urgence haute", async () => {
      await reset();
      const res = await dineIn("waiter").expect(201);
      ids.order = res.body.id;
      await notif.flush();
      const expected = { title: "Nouvelle commande", body: `Commande n°${res.body.number} · 3 articles.`, url: "/r/lome/cuisine", tag: `kitchen:${res.body.id}`, renotify: true, ttl: 300, urgency: "high" };
      expect(sentTo("k1")).toEqual([expected]);
      expect(sentTo("k2")).toEqual([expected]);
      for (const n of ["d1", "d2", "wA", "m1", "v1"]) expect(sentTo(n)).toEqual([]);    // ni le livreur, ni le serveur, ni le responsable, ni un autre restaurant
      expect(notif.pushOutbox).toHaveLength(2);
    });

    it("cuisine : articles ajoutés", async () => {
      await reset();
      await api().post(`${V}/tenant/orders/${ids.order}/items`).set(as("waiter")).send({ items: [{ menuItemId: ids.riz, quantity: 2 }] }).expect(200);
      await notif.flush();
      expect(sentTo("k1")).toEqual([expect.objectContaining({ title: "Articles ajoutés", url: "/r/lome/cuisine", body: expect.stringContaining("2 articles ajoutés") })]);
      expect(notif.pushOutbox).toHaveLength(2);
    });

    it("serveur : plats prêts puis commande prête, uniquement pour le serveur de la commande", async () => {
      await reset();
      await api().post(`${V}/tenant/orders/${ids.order}/advance`).set(as("kitchen")).send({ status: "READY" }).expect(200);
      await notif.flush();
      expect(sentTo("wA")).toEqual([expect.objectContaining({ title: "Commande prête", url: `/r/lome/commandes/${ids.order}`, tag: `order:${ids.order}`, body: expect.stringMatching(/^T1 · commande n°\d+ : tout est prêt\.$/) })]);
      expect(notif.pushOutbox).toHaveLength(1);
      await reset();
      await api().post(`${V}/tenant/orders/${ids.order}/advance`).set(as("kitchen")).send({ status: "READY" }).expect(409);   // rien à faire avancer : pas de second envoi
      await notif.flush();
      expect(notif.pushOutbox).toHaveLength(0);
    });

    it("serveur : une partie des plats prêts → « Plats prêts » (sans « tout est prêt »)", async () => {
      const t2 = (await api().post(`${V}/tenant/tables`).set(as("manager")).send({ label: "T2", capacity: 2 })).body.id;
      const o = (await api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "DINE_IN", tableId: t2, items: [{ menuItemId: ids.riz, quantity: 1 }, { menuItemId: ids.riz, quantity: 2 }] }).expect(201)).body;
      await reset();
      await api().post(`${V}/tenant/orders/${o.id}/items/${o.items[0].id}/status`).set(as("kitchen")).send({ status: "READY" }).expect(200);
      await notif.flush();
      expect(sentTo("wA")).toEqual([expect.objectContaining({ title: "Plats prêts", body: `T2 · commande n°${o.number} : des plats sont prêts à servir.` })]);
      await api().post(`${V}/tenant/orders/${o.id}/items/${o.items[1].id}/status`).set(as("kitchen")).send({ status: "READY" }).expect(200);
      await notif.flush();
      expect(sentTo("wA").map((m) => m.title)).toEqual(["Plats prêts", "Commande prête"]);
    });

    it("livreur : attribution, réattribution (retirée), commande prête à récupérer ; une seule alerte par événement", async () => {
      const order = (await delivery("waiter").expect(201)).body;
      const dlv = order.delivery.id as string;
      await reset();
      await api().post(`${V}/tenant/delivery/${dlv}/assign`).set(as("manager")).send({ driverId: ids.kossi }).expect(200);
      await notif.flush();
      expect(sentTo("d1")).toEqual([{ title: "Nouvelle livraison", body: `La commande n°${order.number} vous est attribuée.`, url: "/r/lome/mes-livraisons", tag: `delivery:${dlv}`, renotify: true, ttl: 300, urgency: "high" }]);
      expect(notif.pushOutbox).toHaveLength(1);

      await reset();
      await api().post(`${V}/tenant/delivery/${dlv}/assign`).set(as("manager")).send({ driverId: ids.yao }).expect(200);
      await notif.flush();
      expect(sentTo("d2")).toEqual([expect.objectContaining({ title: "Nouvelle livraison" })]);
      expect(sentTo("d1")).toEqual([expect.objectContaining({ title: "Livraison retirée", body: `La commande n°${order.number} a été confiée à un autre livreur.` })]);

      await reset();
      await api().post(`${V}/tenant/orders/${order.id}/advance`).set(as("kitchen")).send({ status: "READY" }).expect(200);
      await notif.flush();
      expect(sentTo("d2")).toEqual([expect.objectContaining({ title: "Commande prête", body: `La commande n°${order.number} est prête à récupérer.`, url: "/r/lome/mes-livraisons" })]);
      expect(sentTo("d1")).toEqual([]);
      expect(sentTo("wA")).toEqual([expect.objectContaining({ title: "Commande prête" })]);   // la serveuse qui a pris la commande est aussi prévenue
    });

    it("aucune donnée sensible dans les charges utiles (journal et pilote) ; journal X1 : une ligne PUSH par appareil, charge utile exacte", async () => {
      const text = (p: { title: string; body: string }) => `${p.title} ${p.body}`;
      const sent = notif.pushOutbox.map((m) => text(JSON.parse(m.payload)));
      const j = await journal("admin");
      expect(j.total).toBeGreaterThan(8);
      const logged = j.items.map((i: { payload: { title: string; body: string } }) => text(i.payload));
      for (const re of SENSITIVE) for (const t of [...sent, ...logged]) expect([re.source, t]).toEqual([re.source, expect.not.stringMatching(re)]);
      for (const it of j.items) {
        expect(it).toMatchObject({ channel: "PUSH", status: "SENT", canResend: false, attempts: 1 });
        expect(it.to).toMatch(/^Appareil ••/);
        expect(Object.keys(it.payload).sort()).toEqual(["body", "tag", "title", "url"]);
        expect(it.payload.url).toMatch(/^\/r\/lome\/[a-z-]+/);
        expect(it.payload.title.length).toBeLessThanOrEqual(30);
      }
      expect(j.items.some((it: { template: string }) => it.template === "push.delivery-assigned")).toBe(true);
      // Les modèles push sont aussi exposés sans fuite d'endpoint.
      expect(JSON.stringify(j)).not.toContain("fcm.googleapis.com");
      // Renvoi manuel d'une alerte périmée : refusé.
      expect((await api().post(`${V}/tenant/notifications/${j.items[0].id}/resend`).set(as("admin"))).status).toBe(409);
    });

    it("isolation : le journal et les envois d'un restaurant n'apparaissent pas chez un autre", async () => {
      const mine = await journal("voisin");
      expect(mine.total).toBe(0);
      expect(sentTo("v1")).toEqual([]);
      const filtered = await journal("admin", "?channel=EMAIL&pageSize=100");
      expect(filtered.items.every((i: { channel: string }) => i.channel === "EMAIL")).toBe(true);
    });

    it("préférences : événement désactivé ou canal push coupé → aucun envoi ; transactionnel (test) toujours envoyé", async () => {
      await api().patch(`${V}/tenant/settings/notifications`).set(as("admin")).send({ events: { pushKitchen: false } }).expect(200);
      await reset();
      await dineIn("waiter").expect(201);
      await notif.flush();
      expect(notif.pushOutbox).toHaveLength(0);
      await api().patch(`${V}/tenant/settings/notifications`).set(as("admin")).send({ events: { pushKitchen: true }, channels: { push: false } }).expect(200);
      await dineIn("waiter").expect(201);
      await notif.flush();
      expect(notif.pushOutbox).toHaveLength(0);
      await api().post(`${V}/tenant/push/test`).set(as("waiter")).send({}).expect(200);
      await notif.flush();
      expect(notif.pushOutbox.length).toBeGreaterThan(0);
      await api().patch(`${V}/tenant/settings/notifications`).set(as("admin")).send({ channels: { push: true } }).expect(200);
    });

    it("déduplication : même dedupeKey → un seul envoi par appareil", async () => {
      await reset();
      const input = { template: "push.kitchen-new-order" as const, data: { orderId: ids.order, number: 7, count: 1 }, tenantId: ids["t-lome"], audience: { role: "KITCHEN" as const }, dedupeKey: "test:dedupe:1" };
      expect(await notif.sendPush(input)).toEqual({ queued: 2 });
      expect(await notif.sendPush(input)).toEqual({ queued: 0 });
      await notif.flush();
      expect(notif.pushOutbox).toHaveLength(2);
    });
  });

  describe("pannes du service de push", () => {
    const real = () => notif.drivers.push;
    const stub = (send: (m: PushMessage) => Promise<void>) => { notif.drivers.push = { name: "stub", send } as PushDriver; };
    afterEach(() => { notif.drivers.push = real(); });
    let original: PushDriver;
    beforeAll(() => { original = notif.drivers.push; });
    afterAll(() => { notif.drivers.push = original; });
    const fire = (n: string) => notif.sendPush({ template: "push.test", data: {}, tenantId: ids["t-lome"], audience: { userIds: [ids.waiter], endpoint: sub(n).endpoint } }, { ignorePreferences: true });

    it("404 / 410 : abonnement supprimé, journal en échec, aucune reprise ; les autres appareils restent", async () => {
      await subscribe("waiter", "gone").expect(200);
      const calls: string[] = [];
      for (const status of [410, 404]) {
        await subscribe("waiter", "gone").expect(200);
        stub(async (m) => { calls.push(m.target.endpoint); throw new PushGoneError(status); });
        await fire("gone");
        await notif.flush();
        expect(await rows(`WHERE endpoint LIKE '%/gone-%'`)).toHaveLength(0);
      }
      expect(calls).toHaveLength(2);
      expect(await rows(`WHERE endpoint LIKE '%/wA-%'`)).toHaveLength(1);
      const last = (await journal("admin", "?channel=PUSH&status=FAILED")).items[0];
      expect(last).toMatchObject({ status: "FAILED", attempts: 1, error: expect.stringContaining("appareil supprimé") });
    });

    it("autre erreur : 5 tentatives puis échec, l'abonnement est conservé ; un succès à la 3e tentative est journalisé envoyé", async () => {
      await subscribe("waiter", "flaky").expect(200);
      let n = 0;
      stub(async () => { n++; throw new Error("Le service de push a répondu 503"); });
      await fire("flaky");
      await notif.flush();
      expect(n).toBe(5);
      expect(await rows(`WHERE endpoint LIKE '%/flaky-%'`)).toHaveLength(1);
      let m = 0;
      stub(async () => { if (++m < 3) throw new Error("Le service de push a répondu 503"); });
      await fire("flaky");
      await notif.flush();
      expect(m).toBe(3);
      const items = (await journal("admin", "?channel=PUSH&pageSize=5")).items;
      expect(items.slice(0, 2)).toEqual([expect.objectContaining({ status: "SENT", attempts: 3 }), expect.objectContaining({ status: "FAILED", attempts: 5 })]);
    });

    it("abonnement supprimé entre la mise en file et l'envoi : pas d'erreur, journal en échec", async () => {
      await subscribe("waiter", "late").expect(200);
      stub(async () => { await prisma.$executeRawUnsafe(`DELETE FROM "PushSubscription" WHERE endpoint LIKE '%/late-%'`); throw new Error("503"); });
      await fire("late");
      await notif.flush();
      expect((await journal("admin", "?channel=PUSH&pageSize=1")).items[0]).toMatchObject({ status: "FAILED", error: expect.stringContaining("désabonné") });
    });
  });

  describe("fin de session, désactivation, purge", () => {
    it("déconnexion : l'abonnement de CET appareil disparaît, pas celui d'un autre appareil du même compte ; révocation : tout part", async () => {
      await addStaff("lome", "admin", "extra", "WAITER");
      const a = (await tenantLogin("lome", "extra@lome.tg", pws.extra)).body;
      const b = (await tenantLogin("lome", "extra@lome.tg", pws.extra)).body;
      for (const [s, n] of [[a, "phone"], [b, "laptop"]] as const) await api().post(`${V}/tenant/push/subscriptions`).set({ Authorization: `Bearer ${s.accessToken}` }).send(sub(n)).expect(200);
      expect(await rows(`WHERE endpoint LIKE '%/phone-%' OR endpoint LIKE '%/laptop-%'`)).toHaveLength(2);
      await api().post(`${V}/tenant/auth/logout`).send({ refreshToken: a.refreshToken }).expect(204);
      expect((await rows(`WHERE endpoint LIKE '%/phone-%' OR endpoint LIKE '%/laptop-%'`)).map((r) => r.endpoint.includes("/laptop-"))).toEqual([true]);
      await api().post(`${V}/tenant/security/users/${ids.extra}/revoke-sessions`).set(as("admin")).expect(200);
      expect(await rows(`WHERE endpoint LIKE '%/laptop-%'`)).toHaveLength(0);
    });

    it("compte désactivé : tous ses abonnements sont supprimés et il ne reçoit plus rien", async () => {
      await subscribe("kitchen", "k1").expect(200);
      expect(await rows(`WHERE "userId" = '${ids.kitchen}'`)).not.toHaveLength(0);
      await api().patch(`${V}/tenant/security/users/${ids.kitchen}/active`).set(as("admin")).send({ isActive: false }).expect(200);
      expect(await rows(`WHERE "userId" = '${ids.kitchen}'`)).toHaveLength(0);
      await notif.flush();
      notif.pushOutbox.length = 0;
      await api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "DINE_IN", tableId: ids.tableA, items: [{ menuItemId: ids.riz, quantity: 1 }] }).expect(201);
      await notif.flush();
      expect(notif.pushOutbox).toHaveLength(0);
    });

    it("purge : abonnements inactifs depuis plus de 60 jours, ou dont la session est terminée", async () => {
      await subscribe("manager", "old").expect(200);
      await subscribe("manager", "fresh").expect(200);
      await asPlatform(prisma, (tx) => tx.$executeRawUnsafe(`UPDATE "PushSubscription" SET "lastSeenAt" = now() - interval '61 days' WHERE endpoint LIKE '%/old-%'`));
      await asPlatform(prisma, (tx) => tx.$executeRawUnsafe(`INSERT INTO "PushSubscription" (id, "tenantId", "userId", "sessionId", endpoint, p256dh, auth) VALUES (gen_random_uuid(), '${ids["t-lome"]}', '${ids.manager}', '${ZERO}', 'https://fcm.googleapis.com/fcm/send/orphan', 'x', 'y')`));
      const r = await app.get(RetentionService).purge();
      expect(r.pushSubscriptions).toBe(2);
      expect((await rows(`WHERE endpoint LIKE '%/old-%' OR endpoint LIKE '%/fresh-%' OR endpoint LIKE '%/orphan'`)).map((x) => x.endpoint.includes("/fresh-"))).toEqual([true]);
    });
  });

  describe("configuration absente", () => {
    it("sans clés VAPID : config désactivée, abonnement et test refusés (409), aucun envoi, aucune erreur", async () => {
      const key = process.env.VAPID_PUBLIC_KEY;
      const env = (notif as unknown as { env: { VAPID_PUBLIC_KEY?: string } }).env;
      env.VAPID_PUBLIC_KEY = undefined;
      try {
        expect((await api().get(`${V}/tenant/push/config`).set(as("waiter")).expect(200)).body).toEqual({ enabled: false, publicKey: null });
        expect((await subscribe("waiter", "nokey")).status).toBe(409);
        expect((await api().post(`${V}/tenant/push/test`).set(as("waiter")).send({})).status).toBe(409);
        expect(await notif.sendPush({ template: "push.test", data: {}, tenantId: ids["t-lome"], audience: { userIds: [ids.waiter] } })).toEqual({ queued: 0, skipped: "disabled" });
      } finally { env.VAPID_PUBLIC_KEY = key; }
    });
  });
});
