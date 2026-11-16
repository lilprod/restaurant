import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { computeTotals, zonedDay } from "@restaurant/utils";
import pdf from "pdf-parse";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { io, Socket } from "socket.io-client";
import { NotificationsService } from "../src/notifications/notifications.service";
import { asPlatform, createApp, login, resetDb, seedPlatform } from "./helpers";

const PW = "Cigale-Bleue74";
const ZERO = "00000000-0000-0000-0000-000000000000";
const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const binary = (res: request.Response, cb: (e: Error | null, b: Buffer) => void) => { const c: Buffer[] = []; res.on("data", (x: Buffer) => c.push(x)); res.on("end", () => cb(null, Buffer.concat(c))); };

describe("X2 Livraison : zones, frais, dispatch, livreur, paiement à la livraison, rapprochement (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let notif: NotificationsService;
  let root: string;
  let port: number;
  const sockets: Socket[] = [];
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const V = "/api/v1";
  const api = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  const day = zonedDay(new Date(), "Africa/Lome");

  const tenantLogin = async (slug: string, email: string, password = PW) =>
    (await api().post(`${V}/tenant/auth/login`).send({ tenantSlug: slug, email, password })).body.accessToken as string;
  const makeTenant = async (slug: string, planId: string) => {
    const res = await api().post(`${V}/platform/tenants`).set({ Authorization: `Bearer ${root}` }).send({
      name: slug, slug, email: `contact@${slug}.tg`, planId, admin: { firstName: "Ama", lastName: "Koffi", email: `admin@${slug}.tg`, password: PW },
    });
    expect(res.status).toBe(201);
    await asPlatform(prisma, (tx) => tx.user.updateMany({ where: { tenantId: res.body.id }, data: { mustChangePassword: false } }));
    return res.body.id as string;
  };
  const addStaff = async (slug: string, who: string, role: string, phone?: string) => {
    const res = await api().post(`${V}/tenant/staff`).set(as("admin")).send({ email: `${who}@${slug}.tg`, firstName: who, lastName: "Test", role, phone });
    expect(res.status).toBe(201);
    const l = await api().post(`${V}/tenant/auth/login`).send({ tenantSlug: slug, email: `${who}@${slug}.tg`, password: res.body.temporaryPassword });
    await asPlatform(prisma, (tx) => tx.user.updateMany({ where: { email: `${who}@${slug}.tg` }, data: { mustChangePassword: false } }));
    ids[who] = res.body.id;
    return l.body.accessToken as string;
  };
  const connect = (token: string) => new Promise<Socket>((resolve, reject) => {
    const socket = io(`http://127.0.0.1:${port}/realtime`, { transports: ["websocket"], auth: { token }, reconnection: false });
    sockets.push(socket);
    socket.on("ready", () => resolve(socket));
    socket.on("auth_error", (e: { message: string }) => reject(new Error(e.message)));
  });
  const next = <T = any>(socket: Socket, event: string, match: (p: T) => boolean = () => true, ms = 3000) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`événement ${event} non reçu`)), ms);
      const handler = (p: T) => { if (match(p)) { clearTimeout(timer); socket.off(event, handler); resolve(p); } };
      socket.on(event, handler);
    });
  const delivery = (who: string, input: Partial<{ zoneId: string; neighborhood: string; address: string; landmark: string; phone: string; items: object[] }> = {}) =>
    api().post(`${V}/tenant/orders`).set(as(who)).send({
      type: "DELIVERY", customerName: "Afi", customerPhone: input.phone ?? "90 55 44 33",
      delivery: { zoneId: input.zoneId ?? ids.centre, neighborhood: input.neighborhood ?? "Tokoin", address: input.address ?? "Rue des Palmiers, villa 12", landmark: input.landmark ?? "Derrière la pharmacie du Marché" },
      items: input.items ?? [{ menuItemId: ids.riz, quantity: 2 }, { menuItemId: ids.jus, quantity: 1 }],
    });
  const kitchenReady = (orderId: string) => api().post(`${V}/tenant/orders/${orderId}/advance`).set(as("kitchen")).send({ status: "READY" }).expect(200);

  beforeAll(async () => {
    prisma = new PrismaClient();
    await resetDb(prisma);
    const seed = await seedPlatform(prisma);
    await prisma.plan.update({ where: { id: seed.pro.id }, data: { features: { delivery: true, reports: true } } });
    app = await createApp();
    await app.listen(0, "127.0.0.1");
    port = (app.getHttpServer().address() as AddressInfo).port;
    notif = app.get(NotificationsService);
    root = (await login(app, "root@test.local")).body.accessToken;
    ids.tenant = await makeTenant("lome", seed.pro.id);
    await makeTenant("voisin", seed.pro.id);
    await makeTenant("petit", seed.starter.id);
    tok.admin = await tenantLogin("lome", "admin@lome.tg");
    tok.manager = await addStaff("lome", "manager", "MANAGER");
    tok.waiter = await addStaff("lome", "waiter", "WAITER");
    tok.kitchen = await addStaff("lome", "kitchen", "KITCHEN");
    tok.kossi = await addStaff("lome", "kossi", "DRIVER", "91 00 00 01");
    tok.yao = await addStaff("lome", "yao", "DRIVER", "91 00 00 02");
    tok.other = await tenantLogin("voisin", "admin@voisin.tg");
    tok.petit = await tenantLogin("petit", "admin@petit.tg");

    await api().patch(`${V}/tenant/settings/operations`).set(as("admin")).send({ serviceChargePercent: 10 }).expect(200);
    const plats = (await api().post(`${V}/tenant/menu/categories`).set(as("manager")).send({ name: "Plats" })).body.id;
    const item = async (name: string, price: number, vatRate: number) =>
      (await api().post(`${V}/tenant/menu/items`).set(as("manager")).send({ categoryId: plats, name, price, vatRate })).body.id as string;
    ids.riz = await item("Riz sauce arachide", 3500, 10);
    ids.jus = await item("Jus de bissap", 1000, 18);
    ids.poulet = await item("Poulet braisé", 5000, 10);
  });
  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await app.close();
    await prisma.$disconnect();
  });

  describe("plan, réglage et zones", () => {
    it("sans la fonctionnalité du plan : 403 PLAN_FEATURE (zones, dispatch, prise de commande)", async () => {
      for (const [m, p] of [["get", "/tenant/delivery/zones"], ["get", "/tenant/delivery"], ["get", "/tenant/delivery/drivers"]] as const) {
        const res = await api()[m](`${V}${p}`).set(as("petit"));
        expect([p, res.status, res.body.code]).toEqual([p, 403, "PLAN_FEATURE"]);
      }
      const o = await api().post(`${V}/tenant/orders`).set(as("petit")).send({ type: "DELIVERY", items: [{ menuItemId: ZERO, quantity: 1 }], customerName: "A", customerPhone: "90554433", delivery: { zoneId: ZERO, neighborhood: "Tokoin", address: "Rue 1", landmark: "Pharmacie" } });
      expect([o.status, o.body.code]).toEqual([403, "PLAN_FEATURE"]);
    });

    it("zones par quartier : les responsables écrivent, la salle lit ; validation et doublons", async () => {
      const body = { name: "Centre", neighborhoods: ["Tokoin", "Nyékonakpoè", "tokoin"], landmarks: ["Pharmacie du Marché"], fee: 1000, minOrder: 5000, etaMinutes: 30 };
      expect((await api().post(`${V}/tenant/delivery/zones`).set(as("waiter")).send(body)).status).toBe(403);
      expect((await api().post(`${V}/tenant/delivery/zones`).set(as("kossi")).send(body)).status).toBe(403);
      const bad = await api().post(`${V}/tenant/delivery/zones`).set(as("manager")).send({ ...body, neighborhoods: [] });
      expect(bad.status).toBe(400);
      expect((await api().post(`${V}/tenant/delivery/zones`).set(as("manager")).send({ ...body, fee: -5 })).status).toBe(400);
      const ok = await api().post(`${V}/tenant/delivery/zones`).set(as("manager")).send(body).expect(201);
      expect(ok.body).toMatchObject({ name: "Centre", neighborhoods: ["Tokoin", "Nyékonakpoè"], fee: 1000, minOrder: 5000, etaMinutes: 30, isActive: true });
      ids.centre = ok.body.id;
      expect((await api().post(`${V}/tenant/delivery/zones`).set(as("manager")).send({ ...body, name: "CENTRE" })).status).toBe(409);
      ids.peri = (await api().post(`${V}/tenant/delivery/zones`).set(as("manager")).send({ name: "Périphérie", neighborhoods: ["Adidogomé"], fee: 2000, minOrder: 0, etaMinutes: 60 }).expect(201)).body.id;
      const list = await api().get(`${V}/tenant/delivery/zones`).set(as("waiter")).expect(200);
      expect(list.body.map((z: { name: string }) => z.name)).toEqual(["Centre", "Périphérie"]);
      const up = await api().patch(`${V}/tenant/delivery/zones/${ids.peri}`).set(as("manager")).send({ fee: 2500 }).expect(200);
      expect(up.body.fee).toBe(2500);
      await api().patch(`${V}/tenant/delivery/zones/${ids.peri}`).set(as("manager")).send({ fee: 2000 }).expect(200);
      expect((await api().patch(`${V}/tenant/delivery/zones/${ids.peri}`).set(as("manager")).send({})).status).toBe(400);
    });

    it("un autre restaurant ne voit ni ne modifie les zones", async () => {
      expect((await api().get(`${V}/tenant/delivery/zones`).set(as("other")).expect(200)).body).toEqual([]);
      expect((await api().patch(`${V}/tenant/delivery/zones/${ids.centre}`).set(as("other")).send({ fee: 1 })).status).toBe(404);
      expect((await api().delete(`${V}/tenant/delivery/zones/${ids.centre}`).set(as("other"))).status).toBe(404);
    });

    it("livraison désactivée dans les réglages : 409 ; puis activée", async () => {
      const off = await delivery("waiter");
      expect([off.status, off.body.message]).toEqual([409, "La livraison est désactivée dans les paramètres"]);
      await api().patch(`${V}/tenant/settings/operations`).set(as("admin")).send({ deliveryEnabled: true }).expect(200);
    });
  });

  describe("commande en livraison : frais, minimum, TVA", () => {
    it("les frais s'ajoutent au total (service sur les plats seulement), TVA au taux par défaut, calcul = computeTotals", async () => {
      const res = await delivery("waiter").expect(201);
      const o = res.body;
      ids.A = o.id;
      const expected = computeTotals({
        items: [{ lineTotal: 7000, vatRate: 10, status: "PENDING" }, { lineTotal: 1000, vatRate: 18, status: "PENDING" }],
        serviceChargePercent: 10, defaultVatRate: 18, deliveryFee: 1000,
      });
      expect(o).toMatchObject({ type: "DELIVERY", subtotal: 8000, serviceCharge: 800, deliveryFee: 1000, total: 9800, vat: expected.vat, remaining: 9800 });
      expect(expected.total).toBe(9800);
      expect(o.delivery).toMatchObject({ status: "PENDING", phase: "preparing", zone: { name: "Centre" }, neighborhood: "Tokoin", landmark: "Derrière la pharmacie du Marché", phone: "+22890554433", fee: 1000, driver: null });
      expect(new Date(o.delivery.eta).getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
      // Ticket : TVA par taux incluant service + frais
      const r = (await api().get(`${V}/tenant/orders/${ids.A}/receipt`).set(as("waiter")).expect(200)).body;
      expect(r.order.deliveryFee).toBe(1000);
      expect(r.vatBreakdown).toEqual(expected.vatBreakdown);
      expect(r.vatBreakdown.reduce((n: number, v: { vat: number }) => n + v.vat, 0)).toBe(o.vat);
    });

    it("la zone peut changer ensuite : frais et délai de la commande restent figés", async () => {
      await api().patch(`${V}/tenant/delivery/zones/${ids.centre}`).set(as("manager")).send({ fee: 1500 }).expect(200);
      expect((await api().get(`${V}/tenant/orders/${ids.A}`).set(as("waiter")).expect(200)).body).toMatchObject({ deliveryFee: 1000, total: 9800 });
      await api().patch(`${V}/tenant/delivery/zones/${ids.centre}`).set(as("manager")).send({ fee: 1000 }).expect(200);
    });

    it("minimum de commande (hors service et frais) : 409 DELIVERY_MINIMUM, rien n'est créé ; numérotation intacte", async () => {
      const before = await asPlatform(prisma, (tx) => tx.order.count());
      const res = await delivery("waiter", { items: [{ menuItemId: ids.jus, quantity: 2 }] });
      expect([res.status, res.body.code]).toEqual([409, "DELIVERY_MINIMUM"]);
      expect(res.body.message).toMatch(/Minimum de commande pour la zone « Centre » : 5 000 FCFA \(il manque 3 000 FCFA\)/);
      expect(await asPlatform(prisma, (tx) => tx.order.count())).toBe(before);
      expect((await delivery("waiter", { items: [{ menuItemId: ids.jus, quantity: 5 }] })).status).toBe(201); // 5 000 : exactement le minimum
    });

    it("validation : quartier hors zone, zone inconnue ou inactive, champs obligatoires", async () => {
      const q = await delivery("waiter", { neighborhood: "Adidogomé" });
      expect([q.status, q.body.message]).toEqual([400, "Le quartier « Adidogomé » n'est pas desservi par la zone « Centre »"]);
      expect((await delivery("waiter", { zoneId: ZERO })).status).toBe(404);
      const noLandmark = await delivery("waiter", { landmark: "" });
      expect(noLandmark.status).toBe(400);
      expect(noLandmark.body.errors.map((e: { path: string }) => e.path).join()).toContain("delivery.landmark");
      const noPhone = await api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "DELIVERY", customerName: "Afi", items: [{ menuItemId: ids.riz, quantity: 2 }], delivery: { zoneId: ids.centre, neighborhood: "Tokoin", address: "Rue 1", landmark: "Pharmacie" } });
      expect(noPhone.status).toBe(400);
      await api().patch(`${V}/tenant/delivery/zones/${ids.peri}`).set(as("manager")).send({ isActive: false }).expect(200);
      expect((await delivery("waiter", { zoneId: ids.peri, neighborhood: "Adidogomé" })).status).toBe(404);
      await api().patch(`${V}/tenant/delivery/zones/${ids.peri}`).set(as("manager")).send({ isActive: true }).expect(200);
      expect((await api().post(`${V}/tenant/orders`).set(as("kitchen")).send({ type: "DELIVERY" })).status).toBe(403);
    });

    it("une zone qui a servi ne se supprime pas (409) ; une zone vierge oui", async () => {
      expect((await api().delete(`${V}/tenant/delivery/zones/${ids.centre}`).set(as("manager"))).status).toBe(409);
      expect((await api().delete(`${V}/tenant/delivery/zones/${ids.peri}`).set(as("manager")).expect(200)).body).toEqual({ id: ids.peri, deleted: true });
    });
  });

  describe("dispatch, livreur, paiement à la livraison, rapprochement", () => {
    it("attribution : livreurs actifs seulement ; un livreur d'un autre rôle ou restaurant est refusé", async () => {
      const dr = (await api().get(`${V}/tenant/delivery/drivers`).set(as("waiter")).expect(200)).body;
      expect(dr.map((d: { name: string }) => d.name).sort()).toEqual(["kossi Test", "yao Test"]);
      const board = (await api().get(`${V}/tenant/delivery`).set(as("waiter")).expect(200)).body;
      const d = board.items.find((x: { order: { id: string } }) => x.order.id === ids.A);
      ids.dA = d.id;
      expect(d).toMatchObject({ status: "PENDING", phase: "preparing", order: { number: expect.any(Number), total: 9800, remaining: 9800, items: [{ name: "Riz sauce arachide", quantity: 2 }, { name: "Jus de bissap", quantity: 1 }] } });
      expect((await api().post(`${V}/tenant/delivery/${ids.dA}/assign`).set(as("waiter")).send({ driverId: ids.waiter })).status).toBe(404);
      expect((await api().post(`${V}/tenant/delivery/${ids.dA}/assign`).set(as("kitchen")).send({ driverId: ids.kossi })).status).toBe(403);
      expect((await api().post(`${V}/tenant/delivery/${ids.dA}/assign`).set(as("other")).send({ driverId: ids.kossi })).status).toBe(404);
      expect((await api().post(`${V}/tenant/delivery/${ids.dA}/assign`).set(as("waiter")).send({ driverId: "pas-un-uuid" })).status).toBe(400);
    });

    it("temps réel : le livreur ne rejoint pas la salle (aucune commande), reçoit seulement ses livraisons ; la salle reçoit delivery.updated", async () => {
      const floor = await connect(tok.waiter);
      const driver = await connect(tok.kossi);
      const driver2 = await connect(tok.yao);
      const seenByDriver: string[] = [];
      driver.onAny((e) => seenByDriver.push(e));
      const seenByOther: string[] = [];
      driver2.onAny((e) => seenByOther.push(e));
      const other = await connect(tok.other);
      const seenOutside: string[] = [];
      other.onAny((e) => seenOutside.push(e));

      const floorGot = next(floor, "delivery.updated", (p: any) => p.id === ids.dA && p.status === "ASSIGNED");
      const driverGot = next(driver, "delivery.updated", (p: any) => p.id === ids.dA && p.driver?.name === "kossi Test");
      const res = await api().post(`${V}/tenant/delivery/${ids.dA}/assign`).set(as("waiter")).send({ driverId: ids.kossi }).expect(200);
      expect(res.body).toMatchObject({ status: "ASSIGNED", driver: { id: ids.kossi, phone: "91 00 00 01" } });
      expect((await floorGot).driver.id).toBe(ids.kossi);
      expect((await driverGot).order.number).toBeGreaterThan(0);

      // La cuisine avance : la salle et le livreur assigné voient la préparation (phase), les autres livreurs rien.
      const prepGot = next(driver, "delivery.updated", (p: any) => p.id === ids.dA && p.phase === "ready");
      await kitchenReady(ids.A);
      expect((await prepGot).order.status).toBe("READY");
      await new Promise((r) => setTimeout(r, 150));
      expect(seenByDriver.filter((e) => e !== "ready")).toEqual(expect.arrayContaining(["delivery.updated"]));
      expect(seenByDriver).not.toContain("order.updated");
      expect(seenByDriver).not.toContain("order.created");
      expect(seenByOther.filter((e) => e !== "ready")).toEqual([]);
      expect(seenOutside.filter((e) => e !== "ready")).toEqual([]);
    });

    it("un livreur ne voit que ses livraisons ; routes du personnel et du livreur cloisonnées par rôle", async () => {
      const mine = (await api().get(`${V}/tenant/delivery/mine`).set(as("kossi")).expect(200)).body;
      expect(mine.items.map((d: { id: string }) => d.id)).toEqual([ids.dA]);
      expect((await api().get(`${V}/tenant/delivery/mine`).set(as("yao")).expect(200)).body.items).toEqual([]);
      for (const act of ["pickup", "deliver", "fail"]) {
        const r = await api().post(`${V}/tenant/delivery/mine/${ids.dA}/${act}`).set(as("yao")).send(act === "fail" ? { reason: "Test de refus" } : {});
        expect([act, r.status]).toEqual([act, 404]);
      }
      expect((await api().get(`${V}/tenant/delivery/mine/${ids.dA}`).set(as("yao"))).status).toBe(404);
      expect((await api().get(`${V}/tenant/delivery/mine/${ids.dA}`).set(as("kossi")).expect(200)).body.address).toBe("Rue des Palmiers, villa 12");
      // Le livreur n'a accès à rien d'autre ; le personnel n'a pas la vue livreur.
      for (const p of ["/tenant/orders", "/tenant/delivery", "/tenant/delivery/zones", "/tenant/delivery/drivers", "/tenant/delivery/settlements", "/tenant/kitchen", "/tenant/register/current", `/tenant/delivery/${ids.dA}`, "/tenant/staff", "/tenant/dashboard"]) {
        const r = await api().get(`${V}${p}`).set(as("kossi"));
        expect([p, r.status]).toEqual([p, 403]);
      }
      for (const who of ["waiter", "manager", "admin", "kitchen"]) expect((await api().get(`${V}/tenant/delivery/mine`).set(as(who))).status).toBe(403);
      expect((await api().get(`${V}/tenant/account/me`).set(as("kossi")).expect(200)).body.role).toBe("DRIVER");
      expect((await api().get(`${V}/tenant/delivery/mine`).set(as("other"))).status).toBe(403);
    });

    it("« en route » : SMS au client avec le numéro du livreur, une seule fois ; refusé tant que la commande n'est pas prête", async () => {
      await api().patch(`${V}/tenant/settings/notifications`).set(as("admin")).send({ channels: { email: true, sms: true } }).expect(200);
      // Commande B : pas prête
      ids.B = (await delivery("waiter", { items: [{ menuItemId: ids.poulet, quantity: 2 }], neighborhood: "Nyékonakpoè", phone: "91 22 33 44" }).expect(201)).body.id;
      ids.dB = (await api().get(`${V}/tenant/delivery`).set(as("manager")).expect(200)).body.items.find((x: any) => x.order.id === ids.B).id;
      await api().post(`${V}/tenant/delivery/${ids.dB}/assign`).set(as("manager")).send({ driverId: ids.kossi }).expect(200);
      const early = await api().post(`${V}/tenant/delivery/mine/${ids.dB}/pickup`).set(as("kossi"));
      expect([early.status, early.body.message]).toEqual([409, "La commande n'est pas encore prête : attendez la cuisine"]);

      notif.smsOutbox.length = 0;
      const res = await api().post(`${V}/tenant/delivery/mine/${ids.dA}/pickup`).set(as("kossi")).expect(200);
      expect(res.body).toMatchObject({ status: "ON_THE_WAY", phase: "on_the_way" });
      await notif.flush();
      expect(notif.smsOutbox).toHaveLength(1);
      expect(notif.smsOutbox[0].to).toBe("+22890554433");
      expect(notif.smsOutbox[0].text).toMatch(/n°\d+ est en route.*kossi.*\+22891000001/);
      expect(notif.smsOutbox[0].text).not.toMatch(/http/);
      expect((await api().post(`${V}/tenant/delivery/mine/${ids.dA}/pickup`).set(as("kossi"))).status).toBe(409);
      await notif.flush();
      expect(notif.smsOutbox).toHaveLength(1);
      // Une livraison en route ne change plus de livreur
      expect((await api().post(`${V}/tenant/delivery/${ids.dA}/assign`).set(as("manager")).send({ driverId: ids.yao })).status).toBe(409);
    });

    it("le lien de suivi du client montre l'étape de livraison, sans adresse ni montant", async () => {
      const link = (await api().get(`${V}/tenant/orders/${ids.A}/tracking-link`).set(as("waiter")).expect(200)).body;
      const v = (await api().get(`${V}/public/tracking/${link.token}`).expect(200)).body;
      expect(v).toMatchObject({ type: "DELIVERY", typeLabel: "Livraison", stage: "on_the_way", delivery: { status: "ON_THE_WAY", neighborhood: "Tokoin", driver: { firstName: "kossi", phone: "+22891000001" } } });
      expect(JSON.stringify(v)).not.toMatch(/Palmiers|pharmacie|Afi|9055|total|fee/i);
      ids.trackA = link.token;
    });

    it("remise : le reste à payer est encaissé par le livreur (moyen obligatoire, référence Flooz), commande réglée et clôturée, SMS « livrée »", async () => {
      const noMethod = await api().post(`${V}/tenant/delivery/mine/${ids.dA}/deliver`).set(as("kossi")).send({});
      expect([noMethod.status, noMethod.body.message]).toEqual([400, "Indiquez le moyen d'encaissement"]);
      expect((await api().post(`${V}/tenant/delivery/mine/${ids.dA}/deliver`).set(as("kossi")).send({ method: "FLOOZ" })).status).toBe(400); // référence obligatoire
      expect((await api().post(`${V}/tenant/delivery/mine/${ids.dA}/deliver`).set(as("kossi")).send({ method: "CASH", tendered: 5000 })).status).toBe(400); // somme remise insuffisante
      await api().post(`${V}/tenant/register/open`).set(as("manager")).send({ opening: 10000 }).expect(201);

      notif.smsOutbox.length = 0;
      // Deux remises simultanées : une seule aboutit (verrou de la commande)
      const [r1, r2] = await Promise.all([1, 2].map(() => api().post(`${V}/tenant/delivery/mine/${ids.dA}/deliver`).set(as("kossi")).send({ method: "CASH", tendered: 10000 })));
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      const done = [r1, r2].find((r) => r.status === 200)!.body;
      expect(done).toMatchObject({ status: "DELIVERED", phase: "delivered", settledAt: null, order: { paymentStatus: "PAID", remaining: 0, total: 9800 } });
      const o = (await api().get(`${V}/tenant/orders/${ids.A}`).set(as("waiter")).expect(200)).body;
      expect(o).toMatchObject({ status: "DELIVERED", paymentStatus: "PAID", paidAmount: 9800, closedAt: expect.any(String) });
      expect(o.payments).toHaveLength(1);
      expect(o.payments[0]).toMatchObject({ method: "CASH", amount: 9800, tendered: 10000, change: 200 });
      expect(o.items.every((i: { status: string }) => i.status === "SERVED")).toBe(true);
      await notif.flush();
      expect(notif.smsOutbox).toHaveLength(1);
      expect(notif.smsOutbox[0].text).toMatch(/n°\d+ a été livrée/);
      // Le paiement n'est pas encore en caisse
      const cash = (await api().get(`${V}/tenant/register/current`).set(as("manager")).expect(200)).body;
      expect(cash.expectedCash).toBe(10000);
      expect(cash.paymentsCount).toBe(0);
      expect((await api().post(`${V}/tenant/delivery/mine/${ids.dA}/fail`).set(as("kossi")).send({ reason: "Trop tard" })).status).toBe(409);
    });

    it("rapprochement à son retour : responsables seulement, caisse ouverte obligatoire, une seule fois ; les espèces entrent dans la caisse attendue", async () => {
      const s = (await api().get(`${V}/tenant/delivery/settlements`).set(as("manager")).expect(200)).body;
      expect(s.registerOpen).toBe(true);
      expect(s.drivers).toHaveLength(1);
      expect(s.drivers[0]).toMatchObject({ driver: { id: ids.kossi, name: "kossi Test" }, count: 1, total: 9800, byMethod: { CASH: 9800 }, deliveries: [{ id: ids.dA, amount: 9800, method: "CASH" }] });
      expect((await api().get(`${V}/tenant/delivery/settlements`).set(as("waiter"))).status).toBe(403);
      expect((await api().post(`${V}/tenant/delivery/settlements`).set(as("waiter")).send({ driverId: ids.kossi })).status).toBe(403);
      expect((await api().post(`${V}/tenant/delivery/settlements`).set(as("other")).send({ driverId: ids.kossi })).status).toBe(409); // rien chez eux (et pas de caisse)
      expect((await api().post(`${V}/tenant/delivery/settlements`).set(as("manager")).send({ driverId: ids.yao })).status).toBe(409);

      const ok = await api().post(`${V}/tenant/delivery/settlements`).set(as("manager")).send({ driverId: ids.kossi }).expect(200);
      expect(ok.body).toEqual({ count: 1, total: 9800, byMethod: { CASH: 9800 } });
      const cash = (await api().get(`${V}/tenant/register/current`).set(as("manager")).expect(200)).body;
      expect(cash).toMatchObject({ expectedCash: 19800, paymentsCount: 1 });
      expect((await api().post(`${V}/tenant/delivery/settlements`).set(as("manager")).send({ driverId: ids.kossi })).status).toBe(409);
      expect((await api().get(`${V}/tenant/delivery/settlements`).set(as("manager")).expect(200)).body.drivers).toEqual([]);
      const audit = await asPlatform(prisma, (tx) => tx.auditLog.findMany({ where: { tenantId: ids.tenant, action: { startsWith: "delivery." } } }));
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["delivery.zone.create", "delivery.assign", "delivery.complete", "delivery.settle"]));
    });

    it("rapprochement sans caisse ouverte : 409", async () => {
      // Commande C livrée en Flooz, caisse fermée
      const c = (await delivery("waiter", { items: [{ menuItemId: ids.poulet, quantity: 1 }, { menuItemId: ids.riz, quantity: 1 }] }).expect(201)).body;
      const dC = c.delivery.id as string;
      await api().post(`${V}/tenant/delivery/${dC}/assign`).set(as("waiter")).send({ driverId: ids.yao }).expect(200);
      await kitchenReady(c.id);
      await api().post(`${V}/tenant/delivery/mine/${dC}/pickup`).set(as("yao")).expect(200);
      const reg = (await api().get(`${V}/tenant/register/current`).set(as("manager"))).body;
      await api().post(`${V}/tenant/register/close`).set(as("manager")).send({ counted: reg.expectedCash }).expect(200);
      const done = await api().post(`${V}/tenant/delivery/mine/${dC}/deliver`).set(as("yao")).send({ method: "FLOOZ", reference: "FL-778899" }).expect(200);
      expect(done.body.order.paymentStatus).toBe("PAID");
      const none = await api().post(`${V}/tenant/delivery/settlements`).set(as("manager")).send({ driverId: ids.yao });
      expect([none.status, none.body.message]).toEqual([409, "Ouvrez la caisse avant de rapprocher les encaissements d'un livreur"]);
      await api().post(`${V}/tenant/register/open`).set(as("manager")).send({ opening: 0 }).expect(201);
      const ok = await api().post(`${V}/tenant/delivery/settlements`).set(as("manager")).send({ driverId: ids.yao }).expect(200);
      expect(ok.body.byMethod).toEqual({ FLOOZ: 10350 });
    });

    it("échec de livraison : motif obligatoire, la salle reprend la main (nouvelle attribution), l'annulation interrompt la livraison", async () => {
      // B (poulet ×2) : prête, partie, échec
      await kitchenReady(ids.B);
      await api().post(`${V}/tenant/delivery/mine/${ids.dB}/pickup`).set(as("kossi")).expect(200);
      expect((await api().post(`${V}/tenant/delivery/mine/${ids.dB}/fail`).set(as("kossi")).send({ reason: "" })).status).toBe(400);
      const f = await api().post(`${V}/tenant/delivery/mine/${ids.dB}/fail`).set(as("kossi")).send({ reason: "Client injoignable" }).expect(200);
      expect(f.body).toMatchObject({ status: "FAILED", phase: "failed", failReason: "Client injoignable" });
      expect((await api().get(`${V}/tenant/orders/${ids.B}`).set(as("waiter")).expect(200)).body).toMatchObject({ paymentStatus: "UNPAID", closedAt: null });
      const again = await api().post(`${V}/tenant/delivery/${ids.dB}/assign`).set(as("waiter")).send({ driverId: ids.yao }).expect(200);
      expect(again.body).toMatchObject({ status: "ASSIGNED", failReason: null, driver: { id: ids.yao } });
      expect((await api().get(`${V}/tenant/delivery/mine`).set(as("kossi")).expect(200)).body.items.find((d: { id: string }) => d.id === ids.dB)).toBeUndefined();
      // Annulation de la commande (responsables) : la livraison disparaît du tableau
      await api().post(`${V}/tenant/orders/${ids.B}/cancel`).set(as("manager")).send({ reason: "Client absent" }).expect(200);
      const row = await asPlatform(prisma, (tx) => tx.delivery.findUniqueOrThrow({ where: { id: ids.dB } }));
      expect(row).toMatchObject({ status: "FAILED", failReason: "Commande annulée" });
      expect((await api().get(`${V}/tenant/delivery`).set(as("manager")).expect(200)).body.items.some((d: { id: string }) => d.id === ids.dB)).toBe(false);
      expect((await api().get(`${V}/tenant/orders/${ids.B}`).set(as("manager")).expect(200)).body).toMatchObject({ total: 0, deliveryFee: 0 });
    });

    it("livraison déjà réglée avant la remise : pas d'encaissement par le livreur", async () => {
      const p = (await delivery("waiter", { items: [{ menuItemId: ids.riz, quantity: 2 }] }).expect(201)).body;
      await api().post(`${V}/tenant/orders/${p.id}/payments`).set(as("waiter")).send({ method: "CARD", amount: p.total }).expect(201);
      await api().post(`${V}/tenant/delivery/${p.delivery.id}/assign`).set(as("waiter")).send({ driverId: ids.kossi }).expect(200);
      await kitchenReady(p.id);
      await api().post(`${V}/tenant/delivery/mine/${p.delivery.id}/pickup`).set(as("kossi")).expect(200);
      const done = await api().post(`${V}/tenant/delivery/mine/${p.delivery.id}/deliver`).set(as("kossi")).send({}).expect(200);
      expect(done.body).toMatchObject({ status: "DELIVERED", collectedPaymentId: null, order: { paymentStatus: "PAID" } });
      expect((await api().get(`${V}/tenant/orders/${p.id}`).set(as("waiter"))).body.closedAt).not.toBeNull();
    });
  });

  describe("facture, rapports et isolation", () => {
    it("la facture PDF affiche les frais de livraison ; le total est celui de la commande", async () => {
      const res = await api().get(`${V}/tenant/orders/${ids.A}/invoice.pdf`).set(as("waiter")).buffer(true).parse(binary).expect(200);
      const text = nbsp((await pdf(res.body as Buffer)).text);
      expect(text).toContain("Frais de livraison");
      expect(text).toMatch(/Frais de livraison\s*1\s000\sFCFA/);
      expect(text).toMatch(/TOTAL TTC\s*9\s800\sFCFA/);
      expect(text).toContain("Livraison");
    });

    it("rapports : frais de livraison dans la synthèse, TVA collectée = somme des commandes, type « Livraison », export CSV", async () => {
      const q = `from=${day}&to=${day}`;
      const sales = (await api().get(`${V}/tenant/reports/sales?${q}`).set(as("manager")).expect(200)).body;
      const rows = await asPlatform(prisma, (tx) => tx.order.findMany({ where: { tenantId: ids.tenant, cancelledAt: null } }));
      const fees = rows.reduce((n, o) => n + o.deliveryFee, 0);
      expect(fees).toBeGreaterThanOrEqual(1000);
      expect(sales.summary.deliveryFee).toBe(fees);
      expect(sales.summary.ordersTotal).toBe(rows.reduce((n, o) => n + o.total, 0));
      expect(sales.summary.ordersTotal).toBe(sales.summary.subtotal + sales.summary.serviceCharge + sales.summary.deliveryFee);
      const del = sales.byType.find((t: { type: string }) => t.type === "DELIVERY");
      expect(del.orders).toBe(rows.filter((o) => o.type === "DELIVERY").length);
      expect(del.total).toBe(rows.filter((o) => o.type === "DELIVERY").reduce((n, o) => n + o.total, 0));
      const vat = (await api().get(`${V}/tenant/reports/vat?${q}`).set(as("manager")).expect(200)).body;
      expect(vat.totals.vat).toBe(rows.reduce((n, o) => n + o.vat, 0));
      expect(vat.totals.ttc).toBe(sales.summary.ordersTotal);
      const csv = (await api().get(`${V}/tenant/reports/export/orders?${q}&format=csv`).set(as("manager")).expect(200)).text;
      expect(csv).toContain("Service (FCFA);Livraison (FCFA);Dont TVA (FCFA)");
      const doc = await api().get(`${V}/tenant/reports/export/sales?${q}&format=csv`).set(as("manager")).expect(200);
      expect(doc.text).toContain("Frais de livraison (FCFA)");
    });

    it("isolation : un autre restaurant ne voit ni la livraison ni la commande (404), le tableau est vide", async () => {
      expect((await api().get(`${V}/tenant/delivery/${ids.dA}`).set(as("other"))).status).toBe(404);
      expect((await api().get(`${V}/tenant/delivery`).set(as("other")).expect(200)).body.items).toEqual([]);
      expect((await api().get(`${V}/tenant/delivery/${ZERO}`).set(as("manager"))).status).toBe(404);
      expect((await api().get(`${V}/tenant/delivery/settlements`).set(as("other")).expect(200)).body.drivers).toEqual([]);
    });

    it("un compte client n'atteint aucune route de livraison (403)", async () => {
      await api().post(`${V}/public/tenants/lome/customers`).send({ firstName: "Awa", lastName: "Koffi", email: "awa@x.tg", password: "Mangue-Verte-58", consent: true }).expect(201);
      tok.awa = await tenantLogin("lome", "awa@x.tg", "Mangue-Verte-58");
      for (const [m, p] of [["get", "/tenant/delivery"], ["get", "/tenant/delivery/zones"], ["get", "/tenant/delivery/mine"], ["post", `/tenant/delivery/${ids.dA}/assign`]] as const) {
        expect([p, (await api()[m](`${V}${p}`).set(as("awa")).send({})).status]).toEqual([p, 403]);
      }
    });
  });
});
