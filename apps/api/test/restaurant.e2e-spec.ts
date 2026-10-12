import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { AddressInfo } from "node:net";
import { io, Socket } from "socket.io-client";
import request from "supertest";
import { asPlatform, createApp, login, resetDb, seedPlatform } from "./helpers";

const PW = "Cigale-Bleue74";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

describe("Phase 1 : menu, commandes, cuisine, encaissement (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let seed: Awaited<ReturnType<typeof seedPlatform>>;
  let root: string;
  let port: number;
  let tenantId: string;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const sockets: Socket[] = [];
  const V = "/api/v1";
  const api = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });

  const tenantLogin = async (slug: string, email: string, password = PW) =>
    (await api().post(`${V}/tenant/auth/login`).send({ tenantSlug: slug, email, password })).body.accessToken as string;
  const makeTenant = async (slug: string) => {
    const res = await api().post(`${V}/platform/tenants`).set({ Authorization: `Bearer ${root}` }).send({
      name: slug, slug, email: `contact@${slug}.tg`, planId: seed.starter.id,
      admin: { firstName: "Ama", lastName: "Koffi", email: `admin@${slug}.tg`, password: PW },
    });
    expect(res.status).toBe(201);
    await asPlatform(prisma, (tx) => tx.user.updateMany({ where: { tenantId: res.body.id }, data: { mustChangePassword: false } }));
    return res.body.id as string;
  };
  const connect = (token?: string) => new Promise<{ socket: Socket; ok: boolean; message?: string }>((resolve) => {
    const socket = io(`http://127.0.0.1:${port}/realtime`, { transports: ["websocket"], auth: token ? { token } : {}, reconnection: false });
    sockets.push(socket);
    socket.on("ready", () => resolve({ socket, ok: true }));
    socket.on("auth_error", (e: { message: string }) => resolve({ socket, ok: false, message: e.message }));
  });
  const next = <T = any>(socket: Socket, event: string, match: (p: T) => boolean = () => true, ms = 3000) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`événement ${event} non reçu`)), ms);
      const handler = (p: T) => { if (match(p)) { clearTimeout(timer); socket.off(event, handler); resolve(p); } };
      socket.on(event, handler);
    });

  beforeAll(async () => {
    prisma = new PrismaClient();
    await resetDb(prisma);
    seed = await seedPlatform(prisma);
    app = await createApp();
    await app.listen(0, "127.0.0.1");
    port = (app.getHttpServer().address() as AddressInfo).port;
    root = (await login(app, "root@test.local")).body.accessToken;
    tenantId = await makeTenant("maquis");
    tok.admin = await tenantLogin("maquis", "admin@maquis.tg");
  });
  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────── équipe ─────────────
  describe("équipe", () => {
    it("l'administrateur crée les comptes avec un mot de passe temporaire", async () => {
      for (const [who, role] of [["manager", "MANAGER"], ["waiter", "WAITER"], ["kitchen", "KITCHEN"]] as const) {
        const res = await api().post(`${V}/tenant/staff`).set(as("admin")).send({ email: `${who}@maquis.tg`, firstName: who, lastName: "Test", role });
        expect(res.status).toBe(201);
        expect(res.body.mustChangePassword).toBe(true);
        const l = await api().post(`${V}/tenant/auth/login`).send({ tenantSlug: "maquis", email: `${who}@maquis.tg`, password: res.body.temporaryPassword });
        expect(l.body.restriction).toBe("pwd-change");
        await asPlatform(prisma, (tx) => tx.user.updateMany({ where: { email: `${who}@maquis.tg` }, data: { mustChangePassword: false } }));
        tok[who] = l.body.accessToken;
        ids[who] = res.body.id;
      }
      expect((await api().post(`${V}/tenant/staff`).set(as("admin")).send({ email: "manager@maquis.tg", firstName: "x", lastName: "y", role: "WAITER" })).status).toBe(409);
    });

    it("seul l'administrateur gère l'équipe ; il ne peut pas changer son propre rôle", async () => {
      expect((await api().get(`${V}/tenant/staff`).set(as("manager"))).body).toHaveLength(4);
      expect((await api().get(`${V}/tenant/staff`).set(as("waiter"))).status).toBe(403);
      expect((await api().post(`${V}/tenant/staff`).set(as("manager")).send({ email: "a@b.tg", firstName: "a", lastName: "b", role: "WAITER" })).status).toBe(403);
      const me = (await api().get(`${V}/tenant/account/me`).set(as("admin"))).body.id;
      expect((await api().patch(`${V}/tenant/staff/${me}`).set(as("admin")).send({ role: "WAITER" })).status).toBe(409);
      expect((await api().patch(`${V}/tenant/staff/${ids.kitchen}`).set(as("admin")).send({ phone: "+22890000001" })).body.phone).toBe("+22890000001");
    });

    it("applique la limite d'utilisateurs du plan", async () => {
      await prisma.plan.update({ where: { id: seed.starter.id }, data: { maxUsers: 4 } });
      const res = await api().post(`${V}/tenant/staff`).set(as("admin")).send({ email: "extra@maquis.tg", firstName: "E", lastName: "X", role: "WAITER" });
      expect([res.status, res.body.code]).toEqual([409, "PLAN_LIMIT"]);
      await prisma.plan.update({ where: { id: seed.starter.id }, data: { maxUsers: null } });
    });
  });

  // ───────────── tables ─────────────
  describe("tables", () => {
    it("les responsables gèrent les tables, dans la limite du plan", async () => {
      for (const label of ["T1", "T2"]) {
        const res = await api().post(`${V}/tenant/tables`).set(as("manager")).send({ label, capacity: 4 });
        expect(res.status).toBe(201);
        ids[label] = res.body.id;
      }
      expect((await api().post(`${V}/tenant/tables`).set(as("manager")).send({ label: "T1", capacity: 2 })).status).toBe(409);
      expect((await api().post(`${V}/tenant/tables`).set(as("waiter")).send({ label: "T9", capacity: 2 })).status).toBe(403);
      await prisma.plan.update({ where: { id: seed.starter.id }, data: { maxTables: 2 } });
      expect((await api().post(`${V}/tenant/tables`).set(as("manager")).send({ label: "T3", capacity: 2 })).body.code).toBe("PLAN_LIMIT");
      await prisma.plan.update({ where: { id: seed.starter.id }, data: { maxTables: null } });
      const list = await api().get(`${V}/tenant/tables`).set(as("waiter"));
      expect(list.body.map((t: { label: string }) => t.label)).toEqual(["T1", "T2"]);
    });
  });

  // ───────────── menu ─────────────
  describe("menu", () => {
    it("crée catégories et plats avec options, allergènes et TVA par défaut", async () => {
      const plats = await api().post(`${V}/tenant/menu/categories`).set(as("manager")).send({ name: "Plats" });
      const boissons = await api().post(`${V}/tenant/menu/categories`).set(as("manager")).send({ name: "Boissons", sortOrder: 1 });
      ids.plats = plats.body.id; ids.boissons = boissons.body.id;

      const poulet = await api().post(`${V}/tenant/menu/items`).set(as("manager")).send({
        categoryId: ids.plats, name: "Poulet braisé", price: 3500, prepMinutes: 20,
        optionGroups: [{ name: "Accompagnement", minChoices: 1, maxChoices: 1, options: [{ name: "Alloco", extra: 500 }, { name: "Attiéké" }, { name: "Riz" }] }],
      });
      expect(poulet.status).toBe(201);
      expect(poulet.body.vatRate).toBe(18);                       // TVA par défaut du restaurant
      ids.poulet = poulet.body.id;
      ids.alloco = poulet.body.optionGroups[0].options.find((o: { name: string }) => o.name === "Alloco").id;
      ids.attieke = poulet.body.optionGroups[0].options.find((o: { name: string }) => o.name === "Attiéké").id;

      const fufu = await api().post(`${V}/tenant/menu/items`).set(as("manager")).send({ categoryId: ids.plats, name: "Fufu sauce arachide", price: 3000, allergenCodes: ["PEANUTS"] });
      expect(fufu.body.allergens).toEqual([{ code: "PEANUTS", name: "Arachides" }]);
      ids.fufu = fufu.body.id;
      const bissap = await api().post(`${V}/tenant/menu/items`).set(as("manager")).send({ categoryId: ids.boissons, name: "Bissap", price: 500, vatRate: 10 });
      ids.bissap = bissap.body.id;

      expect((await api().post(`${V}/tenant/menu/items`).set(as("manager")).send({
        categoryId: ids.plats, name: "X", price: 1, optionGroups: [{ name: "G", minChoices: 2, maxChoices: 1, options: [{ name: "a" }] }],
      })).status).toBe(400);
      expect((await api().post(`${V}/tenant/menu/items`).set(as("waiter")).send({ categoryId: ids.plats, name: "X", price: 1 })).status).toBe(403);
      const fr = await api().post(`${V}/tenant/menu/categories`).set(as("manager")).send({ name: "" });
      expect(fr.body.errors).toEqual([{ path: "name", message: "Obligatoire" }]);       // messages de validation en français
      expect((await api().delete(`${V}/tenant/menu/categories/${ids.plats}`).set(as("manager"))).status).toBe(409);
    });

    it("photo du plat, carte publique sans données internes", async () => {
      const up = await api().post(`${V}/tenant/menu/items/${ids.poulet}/image`).set(as("manager")).attach("file", PNG, { filename: "p.png" });
      expect(up.status).toBe(201);
      expect(up.body.imageUrl).toContain(`/tenants/${tenantId}/menu/`);
      const pub = await api().get(`${V}/public/tenants/maquis/menu`);
      expect(pub.status).toBe(200);
      expect(pub.body.categories.map((c: { name: string }) => c.name)).toEqual(["Plats", "Boissons"]);
      expect(JSON.stringify(pub.body)).not.toMatch(/vatRate|prepMinutes|sortOrder/);
    });

    it("la cuisine peut déclarer un plat épuisé, ce qui bloque la prise de commande", async () => {
      expect((await api().patch(`${V}/tenant/menu/items/${ids.bissap}/availability`).set(as("kitchen")).send({ isAvailable: false })).status).toBe(200);
      const pub = await api().get(`${V}/public/tenants/maquis/menu`);
      expect(pub.body.categories.map((c: { name: string }) => c.name)).toEqual(["Plats"]);
      const res = await api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "TAKEAWAY", items: [{ menuItemId: ids.bissap, quantity: 1 }] });
      expect([res.status, res.body.message]).toEqual([409, "« Bissap » n'est plus disponible"]);
      await api().patch(`${V}/tenant/menu/items/${ids.bissap}/availability`).set(as("kitchen")).send({ isAvailable: true });
    });
  });

  // ───────────── commandes et cuisine ─────────────
  describe("commande à table et cuisine en temps réel", () => {
    let kitchenSocket: Socket;
    beforeAll(async () => {
      const c = await connect(tok.kitchen);
      expect(c.ok).toBe(true);
      kitchenSocket = c.socket;
    });

    it("refuse les connexions temps réel non autorisées", async () => {
      expect((await connect()).ok).toBe(false);
      expect((await connect("faux")).message).toBe("Jeton invalide ou expiré");
      expect((await connect(root)).ok).toBe(false);                     // jeton plateforme
    });

    it("valide les options et la table, fige les prix et calcule la TVA incluse", async () => {
      expect((await api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "DINE_IN", items: [{ menuItemId: ids.bissap, quantity: 1 }] })).status).toBe(400);
      const missing = await api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "DINE_IN", tableId: ids.T1, items: [{ menuItemId: ids.poulet, quantity: 1 }] });
      expect([missing.status, missing.body.message]).toEqual([400, "« Poulet braisé » : choisissez une option pour « Accompagnement »"]);

      const created = next(kitchenSocket, "order.created");
      const res = await api().post(`${V}/tenant/orders`).set(as("waiter")).send({
        type: "DINE_IN", tableId: ids.T1, items: [
          { menuItemId: ids.poulet, quantity: 2, optionIds: [ids.alloco], instructions: "Bien pimenté" },
          { menuItemId: ids.bissap, quantity: 3 },
        ],
      });
      expect(res.status).toBe(201);
      ids.order1 = res.body.id;
      expect(res.body.number).toBe(1);
      expect(res.body.subtotal).toBe(9500);             // (3500 + 500) × 2 + 500 × 3
      expect(res.body.total).toBe(9500);
      expect(res.body.vat).toBe(1220 + 136);            // TVA 18 % sur 8000 + 10 % sur 1500
      expect(res.body.items[0]).toMatchObject({ name: "Poulet braisé", unitPrice: 3500, optionsExtra: 500, lineTotal: 8000, options: [{ name: "Alloco", extra: 500 }] });
      expect((await created).number).toBe(1);           // l'écran cuisine est prévenu
      const t1 = (await api().get(`${V}/tenant/tables`).set(as("waiter"))).body.find((t: { id: string }) => t.id === ids.T1);
      expect(t1.status).toBe("OCCUPIED");
      expect(t1.openOrders[0].number).toBe(1);
      // un changement de prix ultérieur ne modifie pas la commande
      await api().patch(`${V}/tenant/menu/items/${ids.bissap}`).set(as("manager")).send({ price: 700 });
      expect((await api().get(`${V}/tenant/orders/${ids.order1}`).set(as("waiter"))).body.total).toBe(9500);
    });

    it("la cuisine prépare, la salle sert ; chacun dans son rôle", async () => {
      const o = (await api().get(`${V}/tenant/orders/${ids.order1}`).set(as("waiter"))).body;
      const poulet = o.items[0].id;
      expect((await api().get(`${V}/tenant/kitchen`).set(as("kitchen"))).body.map((x: { number: number }) => x.number)).toEqual([1]);
      expect((await api().post(`${V}/tenant/orders/${ids.order1}/items/${poulet}/status`).set(as("waiter")).send({ status: "IN_PROGRESS" })).status).toBe(403);

      const updated = next(kitchenSocket, "order.updated", (p: { status: string }) => p.status === "IN_PROGRESS");
      const r1 = await api().post(`${V}/tenant/orders/${ids.order1}/items/${poulet}/status`).set(as("kitchen")).send({ status: "IN_PROGRESS" });
      expect(r1.body.status).toBe("IN_PROGRESS");
      expect(r1.body.items[0].startedAt).not.toBeNull();
      await updated;

      expect((await api().post(`${V}/tenant/orders/${ids.order1}/advance`).set(as("kitchen")).send({ status: "READY" })).body.status).toBe("READY");
      expect((await api().post(`${V}/tenant/orders/${ids.order1}/advance`).set(as("kitchen")).send({ status: "SERVED" })).status).toBe(403);
      const served = await api().post(`${V}/tenant/orders/${ids.order1}/advance`).set(as("waiter")).send({ status: "SERVED" });
      expect(served.body.status).toBe("DELIVERED");
      expect(served.body.closedAt).toBeNull();          // pas encore réglée
      expect((await api().get(`${V}/tenant/kitchen`).set(as("kitchen"))).body).toHaveLength(0);
    });

    it("ajout d'un article puis annulation par le serveur tant qu'il n'est pas lancé", async () => {
      const added = await api().post(`${V}/tenant/orders/${ids.order1}/items`).set(as("waiter")).send({ items: [{ menuItemId: ids.fufu, quantity: 1 }] });
      expect(added.body.status).toBe("IN_PROGRESS");
      expect(added.body.total).toBe(12500);
      const fufu = added.body.items.find((i: { name: string }) => i.name === "Fufu sauce arachide").id;
      expect((await api().patch(`${V}/tenant/orders/${ids.order1}/items/${fufu}`).set(as("waiter")).send({ quantity: 2 })).body.total).toBe(15500);
      const cancelled = await api().post(`${V}/tenant/orders/${ids.order1}/items/${fufu}/cancel`).set(as("waiter")).send({ reason: "Erreur de saisie" });
      expect(cancelled.body.total).toBe(9500);
      expect(cancelled.body.status).toBe("DELIVERED");
    });

    it("à emporter : un article lancé ne peut être annulé que par un responsable", async () => {
      const o = await api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "TAKEAWAY", customerName: "Ama", items: [{ menuItemId: ids.fufu, quantity: 1 }] });
      expect(o.body.number).toBe(2);
      expect(o.body.table).toBeNull();
      const item = o.body.items[0].id;
      await api().post(`${V}/tenant/orders/${o.body.id}/items/${item}/status`).set(as("kitchen")).send({ status: "IN_PROGRESS" });
      expect((await api().post(`${V}/tenant/orders/${o.body.id}/items/${item}/cancel`).set(as("waiter")).send({ reason: "Client parti" })).status).toBe(403);
      expect((await api().post(`${V}/tenant/orders/${o.body.id}/cancel`).set(as("waiter")).send({ reason: "Client parti" })).status).toBe(403);
      const c = await api().post(`${V}/tenant/orders/${o.body.id}/cancel`).set(as("manager")).send({ reason: "Client parti" });
      expect([c.body.status, c.body.total]).toEqual(["CANCELLED", 0]);
      expect(c.body.closedAt).not.toBeNull();
      expect((await api().post(`${V}/tenant/orders/${o.body.id}/items`).set(as("waiter")).send({ items: [{ menuItemId: ids.fufu, quantity: 1 }] })).status).toBe(409);
    });
  });

  // ───────────── encaissement ─────────────
  describe("encaissement et caisse", () => {
    it("ouvre la caisse (responsable) une seule fois", async () => {
      expect((await api().post(`${V}/tenant/register/open`).set(as("waiter")).send({ opening: 10000 })).status).toBe(403);
      expect((await api().post(`${V}/tenant/register/open`).set(as("manager")).send({ opening: 10000 })).status).toBe(201);
      expect((await api().post(`${V}/tenant/register/open`).set(as("manager")).send({ opening: 5000 })).status).toBe(409);
    });

    it("addition partagée en deux : espèces avec monnaie, puis Flooz ; la table se libère", async () => {
      const pay = (body: object) => api().post(`${V}/tenant/orders/${ids.order1}/payments`).set(as("waiter")).send(body);
      expect((await pay({ method: "CASH", amount: 4750, tendered: 4000 })).status).toBe(400);
      const cash = await pay({ method: "CASH", amount: 4750, tendered: 5000 });
      expect(cash.status).toBe(201);
      expect(cash.body.change).toBe(250);
      expect(cash.body.order.paymentStatus).toBe("PARTIAL");
      expect(cash.body.order.remaining).toBe(4750);

      expect((await pay({ method: "FLOOZ", amount: 4750 })).status).toBe(400);                 // référence obligatoire
      expect((await pay({ method: "FLOOZ", amount: 5000, reference: "FL-1" })).status).toBe(409); // dépasse le reste
      const flooz = await pay({ method: "FLOOZ", amount: 4750, tip: 500, reference: "FL-778899" });
      expect(flooz.body.order.paymentStatus).toBe("PAID");
      expect(flooz.body.order.tip).toBe(500);
      expect(flooz.body.order.closedAt).not.toBeNull();
      expect((await pay({ method: "CASH", amount: 100 })).status).toBe(409);
      const t1 = (await api().get(`${V}/tenant/tables`).set(as("waiter"))).body.find((t: { id: string }) => t.id === ids.T1);
      expect([t1.status, t1.openOrders]).toEqual(["FREE", []]);
    });

    it("un remboursement (responsable) rouvre la commande et la table", async () => {
      const o = (await api().get(`${V}/tenant/orders/${ids.order1}`).set(as("waiter"))).body;
      const flooz = o.payments.find((p: { method: string }) => p.method === "FLOOZ").id;
      expect((await api().post(`${V}/tenant/orders/${ids.order1}/payments/${flooz}/refund`).set(as("waiter")).send({ reason: "Erreur" })).status).toBe(403);
      const r = await api().post(`${V}/tenant/orders/${ids.order1}/payments/${flooz}/refund`).set(as("manager")).send({ reason: "Mauvais montant" });
      expect([r.body.paymentStatus, r.body.closedAt, r.body.remaining]).toEqual(["PARTIAL", null, 4750]);
      expect((await api().get(`${V}/tenant/tables`).set(as("waiter"))).body.find((t: { id: string }) => t.id === ids.T1).status).toBe("OCCUPIED");
      const again = await api().post(`${V}/tenant/orders/${ids.order1}/payments`).set(as("waiter")).send({ method: "TMONEY", amount: 4750, reference: "TM-1" });
      expect(again.body.order.closedAt).not.toBeNull();
    });

    it("deux encaissements simultanés ne dépassent jamais le total", async () => {
      const o = await api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "TAKEAWAY", items: [{ menuItemId: ids.fufu, quantity: 1 }] });
      const both = await Promise.all([1, 2].map(() =>
        api().post(`${V}/tenant/orders/${o.body.id}/payments`).set(as("waiter")).send({ method: "CARD", amount: 3000 })));
      expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
      expect((await api().get(`${V}/tenant/orders/${o.body.id}`).set(as("waiter"))).body.paidAmount).toBe(3000);
    });

    it("partage par article : quantités encaissées suivies et protégées", async () => {
      const o = await api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "DINE_IN", tableId: ids.T2, items: [
        { menuItemId: ids.poulet, quantity: 1, optionIds: [ids.attieke] }, { menuItemId: ids.bissap, quantity: 2 },
      ] });
      expect(o.body.total).toBe(3500 + 1400);                 // nouveau prix du bissap (700)
      const [poulet, bissap] = o.body.items;
      const p = await api().post(`${V}/tenant/orders/${o.body.id}/payments`).set(as("waiter")).send({ method: "CARD", amount: 3500, allocations: [{ orderItemId: poulet.id, quantity: 1 }] });
      expect(p.body.order.items[0].paidQuantity).toBe(1);
      expect((await api().post(`${V}/tenant/orders/${o.body.id}/payments`).set(as("waiter")).send({ method: "CASH", amount: 700, allocations: [{ orderItemId: bissap.id, quantity: 3 }] })).status).toBe(409);
      expect((await api().post(`${V}/tenant/orders/${o.body.id}/items/${poulet.id}/cancel`).set(as("manager")).send({ reason: "Offert" })).status).toBe(409);
      ids.order3 = o.body.id;
    });

    it("le service s'ajoute selon les paramètres", async () => {
      await api().patch(`${V}/tenant/settings/operations`).set(as("admin")).send({ serviceChargePercent: 10 });
      const o = await api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "TAKEAWAY", items: [{ menuItemId: ids.fufu, quantity: 1 }] });
      expect([o.body.subtotal, o.body.serviceCharge, o.body.total]).toEqual([3000, 300, 3300]);
      await api().patch(`${V}/tenant/settings/operations`).set(as("admin")).send({ serviceChargePercent: 0 });
    });

    it("ticket avec identité du restaurant et TVA par taux", async () => {
      await api().patch(`${V}/tenant/settings/business`).set(as("admin")).send({ tradeName: "Le Maquis", taxId: "NIF-42", receipt: { footerText: "Akpé !" } });
      const r = await api().get(`${V}/tenant/orders/${ids.order1}/receipt`).set(as("waiter"));
      expect(r.status).toBe(200);
      expect(r.body.restaurant).toMatchObject({ name: "Le Maquis", taxId: "NIF-42", footerText: "Akpé !" });
      expect(r.body.vatBreakdown).toEqual([{ rate: 10, base: 1364, vat: 136 }, { rate: 18, base: 6780, vat: 1220 }]);
      expect(r.body.order.payments).toHaveLength(3);
      expect((await api().get(`${V}/tenant/orders/${ids.order1}/receipt`).set(as("kitchen"))).status).toBe(403);
    });

    it("clôture de caisse avec écart", async () => {
      const cur = await api().get(`${V}/tenant/register/current`).set(as("waiter"));
      expect(cur.body.open).toBe(true);
      expect(cur.body.expectedCash).toBe(10000 + 4750 + 700 * 0);   // fond + espèces encaissées
      const closed = await api().post(`${V}/tenant/register/close`).set(as("manager")).send({ counted: 14700 });
      expect([closed.body.expectedCash, closed.body.session.difference]).toEqual([14750, -50]);
      expect((await api().get(`${V}/tenant/register/current`).set(as("waiter"))).body.open).toBe(false);
    });

    it("tableau de bord du jour", async () => {
      const d = await api().get(`${V}/tenant/dashboard`).set(as("manager"));
      expect(d.status).toBe(200);
      expect(d.body.revenue).toBe(4750 + 4750 + 3000 + 3500);        // paiements encaissés (hors remboursé)
      expect(d.body.tips).toBe(0);
      expect(d.body.ordersCount).toBe(4);                             // la commande annulée est exclue
      expect(d.body.topItems[0].name).toBeDefined();
      expect((await api().get(`${V}/tenant/dashboard`).set(as("waiter"))).status).toBe(403);
    });

    it("filtres de la liste des commandes", async () => {
      const open = await api().get(`${V}/tenant/orders?open=true`).set(as("waiter"));
      expect(open.body.items.every((o: { closedAt: string | null }) => o.closedAt === null)).toBe(true);
      const today = new Date().toISOString().slice(0, 10);
      expect((await api().get(`${V}/tenant/orders?date=${today}`).set(as("waiter"))).body.total).toBe(5);
      expect((await api().get(`${V}/tenant/orders?status=CANCELLED`).set(as("waiter"))).body.total).toBe(1);
    });
  });

  // ───────────── archivage et isolation ─────────────
  describe("archivage et isolation", () => {
    it("un plat déjà commandé est retiré de la carte mais l'historique reste lisible", async () => {
      expect((await api().delete(`${V}/tenant/menu/items/${ids.poulet}`).set(as("manager"))).body).toEqual({ archived: true });
      const menu = await api().get(`${V}/tenant/menu`).set(as("waiter"));
      expect(JSON.stringify(menu.body)).not.toContain("Poulet braisé");
      expect((await api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "TAKEAWAY", items: [{ menuItemId: ids.poulet, quantity: 1, optionIds: [ids.alloco] }] })).status).toBe(404);
      expect((await api().get(`${V}/tenant/orders/${ids.order1}`).set(as("waiter"))).body.items[0].name).toBe("Poulet braisé");
    });

    it("un autre restaurant ne voit ni les commandes ni les événements", async () => {
      await makeTenant("voisin");
      const other = await tenantLogin("voisin", "admin@voisin.tg");
      expect((await api().get(`${V}/tenant/orders/${ids.order1}`).set({ Authorization: `Bearer ${other}` })).status).toBe(404);
      expect((await api().get(`${V}/tenant/orders`).set({ Authorization: `Bearer ${other}` })).body.total).toBe(0);
      expect((await api().get(`${V}/tenant/menu`).set({ Authorization: `Bearer ${other}` })).body).toEqual([]);
      expect((await api().post(`${V}/tenant/orders`).set({ Authorization: `Bearer ${other}` }).send({ type: "TAKEAWAY", items: [{ menuItemId: ids.fufu, quantity: 1 }] })).status).toBe(404);

      const spy = await connect(other);
      let leaked = false;
      spy.socket.on("order.created", () => { leaked = true; });
      const own = next((await connect(tok.waiter)).socket, "order.created");
      await api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "TAKEAWAY", items: [{ menuItemId: ids.fufu, quantity: 1 }] });
      await own;
      await new Promise((r) => setTimeout(r, 200));
      expect(leaked).toBe(false);
    });
  });
});
