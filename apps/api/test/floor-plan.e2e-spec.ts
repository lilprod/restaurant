import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { AddressInfo } from "node:net";
import { io, Socket } from "socket.io-client";
import request from "supertest";
import { asPlatform, createApp, login, resetDb, seedPlatform } from "./helpers";

const PW = "Cigale-Bleue74";

describe("P2B Plan de salle : salles, mise en page, fusion, transfert de commande (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let root: string;
  let port: number;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const sockets: Socket[] = [];
  const V = "/api/v1";
  const api = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  const tenantLogin = async (slug: string, email: string) =>
    (await api().post(`${V}/tenant/auth/login`).send({ tenantSlug: slug, email, password: PW })).body.accessToken as string;
  const makeTenant = async (slug: string, planId: string) => {
    const res = await api().post(`${V}/platform/tenants`).set({ Authorization: `Bearer ${root}` }).send({
      name: slug, slug, email: `contact@${slug}.tg`, planId, admin: { firstName: "Ama", lastName: "Koffi", email: `admin@${slug}.tg`, password: PW },
    });
    expect(res.status).toBe(201);
    await asPlatform(prisma, (tx) => tx.user.updateMany({ where: { tenantId: res.body.id }, data: { mustChangePassword: false } }));
    return res.body.id as string;
  };
  const addStaff = async (slug: string, who: string, role: string) => {
    const res = await api().post(`${V}/tenant/staff`).set(as("admin")).send({ email: `${who}@${slug}.tg`, firstName: who, lastName: "Test", role });
    expect(res.status).toBe(201);
    const l = await api().post(`${V}/tenant/auth/login`).send({ tenantSlug: slug, email: `${who}@${slug}.tg`, password: res.body.temporaryPassword });
    await asPlatform(prisma, (tx) => tx.user.updateMany({ where: { email: `${who}@${slug}.tg` }, data: { mustChangePassword: false } }));
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
  const table = async (who: string, id: string) => (await api().get(`${V}/tenant/tables`).set(as(who))).body.find((t: { id: string }) => t.id === id);
  const order = (tableId: string) =>
    api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "DINE_IN", tableId, items: [{ menuItemId: ids.item, quantity: 1, optionIds: [] }] });
  const geo = (id: string, over: object = {}) => ({ id, posX: 100, posY: 100, width: 90, height: 90, shape: "round", rotation: 0, ...over });

  beforeAll(async () => {
    prisma = new PrismaClient();
    await resetDb(prisma);
    const seed = await seedPlatform(prisma);
    app = await createApp();
    await app.listen(0, "127.0.0.1");
    port = (app.getHttpServer().address() as AddressInfo).port;
    root = (await login(app, "root@test.local")).body.accessToken;
    await makeTenant("baobab", seed.pro.id);
    await makeTenant("voisin", seed.pro.id);
    tok.admin = await tenantLogin("baobab", "admin@baobab.tg");
    tok.manager = await addStaff("baobab", "manager", "MANAGER");
    tok.waiter = await addStaff("baobab", "waiter", "WAITER");
    tok.kitchen = await addStaff("baobab", "kitchen", "KITCHEN");
    tok.other = await tenantLogin("voisin", "admin@voisin.tg");
    for (const [label, capacity] of [["T1", 2], ["T2", 4], ["T3", 4], ["T4", 6]] as const) {
      const r = await api().post(`${V}/tenant/tables`).set(as("admin")).send({ label, capacity });
      expect(r.status).toBe(201);
      ids[label] = r.body.id;
    }
    ids.otherTable = (await api().post(`${V}/tenant/tables`).set(as("other")).send({ label: "V1", capacity: 4 }).expect(201)).body.id;
    const cat = await api().post(`${V}/tenant/menu/categories`).set(as("admin")).send({ name: "Plats" }).expect(201);
    ids.item = (await api().post(`${V}/tenant/menu/items`).set(as("admin")).send({ categoryId: cat.body.id, name: "Fufu", price: 2500 }).expect(201)).body.id;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await app.close();
    await prisma.$disconnect();
  });

  describe("salles", () => {
    it("liste, création, doublon, renommage, rôles et isolation", async () => {
      const list = await api().get(`${V}/tenant/floor-plans`).set(as("kitchen")).expect(200);
      expect(list.body).toEqual([expect.objectContaining({ name: "Salle principale", width: 1000, height: 700, tableCount: 4 })]);
      ids.main = list.body[0].id;
      await api().post(`${V}/tenant/floor-plans`).set(as("waiter")).send({ name: "Terrasse" }).expect(403);
      const sock = await connect(tok.waiter);
      const evt = next(sock, "floorplan.updated", (p: any) => p.name === "Terrasse");
      const t = await api().post(`${V}/tenant/floor-plans`).set(as("manager")).send({ name: "Terrasse", width: 800, height: 500 }).expect(201);
      await evt;
      ids.terrace = t.body.id;
      await api().post(`${V}/tenant/floor-plans`).set(as("manager")).send({ name: "terrasse" }).expect(409);
      await api().post(`${V}/tenant/floor-plans`).set(as("manager")).send({ name: "" }).expect(400);
      expect((await api().patch(`${V}/tenant/floor-plans/${ids.terrace}`).set(as("manager")).send({ name: "Jardin" }).expect(200)).body.name).toBe("Jardin");
      expect((await api().get(`${V}/tenant/floor-plans`).set(as("other"))).body).toHaveLength(1);   // seule sa propre salle
      await api().patch(`${V}/tenant/floor-plans/${ids.terrace}`).set(as("other")).send({ name: "X" }).expect(404);
    });

    it("une table se crée dans la salle choisie, avec sa géométrie ; une salle non vide ne se supprime pas", async () => {
      const r = await api().post(`${V}/tenant/tables`).set(as("manager"))
        .send({ label: "J1", capacity: 2, floorPlanId: ids.terrace, shape: "round", width: 70, height: 70, posX: 50, posY: 60, rotation: 45 }).expect(201);
      ids.J1 = r.body.id;
      const t = await table("waiter", ids.J1);
      expect(t).toMatchObject({ floorPlanId: ids.terrace, shape: "round", width: 70, height: 70, posX: 50, posY: 60, rotation: 45, mergedIntoId: null, mergedTables: [] });
      await api().post(`${V}/tenant/tables`).set(as("manager")).send({ label: "Z", capacity: 2, floorPlanId: ids.otherTable }).expect(404);   // un identifiant d'un autre restaurant n'existe pas ici
      await api().post(`${V}/tenant/tables`).set(as("manager")).send({ label: "Z", capacity: 2, floorPlanId: "00000000-0000-4000-8000-000000000000" }).expect(404);
      await api().delete(`${V}/tenant/floor-plans/${ids.terrace}`).set(as("manager")).expect(409);
      await api().put(`${V}/tenant/floor-plans/${ids.terrace}/layout`).set(as("manager")).send({ tables: [geo(ids.J1, { posX: 700, width: 70, height: 70 })] }).expect(200);
      await api().patch(`${V}/tenant/floor-plans/${ids.terrace}`).set(as("manager")).send({ width: 400 }).expect(409);   // J1 dépasserait de la salle
      await api().patch(`${V}/tenant/floor-plans/${ids.terrace}`).set(as("manager")).send({ height: 100 }).expect(400);
      await api().delete(`${V}/tenant/tables/${ids.J1}`).set(as("manager")).expect(200);
      await api().delete(`${V}/tenant/floor-plans/${ids.terrace}`).set(as("waiter")).expect(403);
      await api().delete(`${V}/tenant/floor-plans/${ids.terrace}`).set(as("manager")).expect(200);
      await api().delete(`${V}/tenant/floor-plans/${ids.main}`).set(as("manager")).expect(409);   // dernière salle
    });
  });

  describe("mise en page", () => {
    it("enregistrée en lot, relue à l'identique, diffusée ; bornes, rôles et isolation", async () => {
      const sock = await connect(tok.waiter);
      const evt = next(sock, "table.updated", (p: any) => p.id === ids.T1 && p.posX === 300);
      const body = { tables: [geo(ids.T1, { posX: 300, posY: 200, shape: "rect", width: 140, height: 80, rotation: 90 }), geo(ids.T2, { posX: 500, posY: 200 })] };
      await api().put(`${V}/tenant/floor-plans/${ids.main}/layout`).set(as("waiter")).send(body).expect(403);
      const res = await api().put(`${V}/tenant/floor-plans/${ids.main}/layout`).set(as("manager")).send(body).expect(200);
      expect((await evt)).toMatchObject({ posX: 300, posY: 200, shape: "rect", width: 140, height: 80, rotation: 90 });
      const again = await table("kitchen", ids.T1);
      expect(again).toMatchObject({ posX: 300, posY: 200, shape: "rect", width: 140, height: 80, rotation: 90 });
      expect(res.body.find((t: any) => t.id === ids.T1)).toMatchObject({ posX: 300, width: 140 });
      // bornes, forme, doublon, salle étrangère
      expect((await api().put(`${V}/tenant/floor-plans/${ids.main}/layout`).set(as("manager")).send({ tables: [geo(ids.T1, { posX: 950 })] })).status).toBe(400);
      expect((await api().put(`${V}/tenant/floor-plans/${ids.main}/layout`).set(as("manager")).send({ tables: [geo(ids.T1, { shape: "triangle" })] })).status).toBe(400);
      expect((await api().put(`${V}/tenant/floor-plans/${ids.main}/layout`).set(as("manager")).send({ tables: [geo(ids.T1), geo(ids.T1)] })).status).toBe(400);
      await api().put(`${V}/tenant/floor-plans/${ids.main}/layout`).set(as("manager")).send({ tables: [geo(ids.otherTable)] }).expect(404);
      await api().put(`${V}/tenant/floor-plans/${ids.main}/layout`).set(as("other")).send({ tables: [geo(ids.T1)] }).expect(404);
      // J1 puis T1/T2 (lecture « plateforme » : la RLS masque sinon les lignes du restaurant)
      expect(await asPlatform(prisma, (tx) => tx.auditLog.count({ where: { action: "floorplan.layout" } }))).toBe(2);
    });
  });

  describe("fusion et séparation", () => {
    it("capacité cumulée, rôles, une seule salle, états refusés", async () => {
      await api().post(`${V}/tenant/tables/merge`).set(as("kitchen")).send({ tableIds: [ids.T1, ids.T2] }).expect(403);
      await api().post(`${V}/tenant/tables/merge`).set(as("waiter")).send({ tableIds: [ids.T1] }).expect(400);
      await api().post(`${V}/tenant/tables/merge`).set(as("waiter")).send({ tableIds: [ids.T1, ids.otherTable] }).expect(404);
      const sock = await connect(tok.waiter);
      const evt = next(sock, "table.updated", (p: any) => p.id === ids.T3 && p.mergedIntoId === ids.T2);
      const m = await api().post(`${V}/tenant/tables/merge`).set(as("waiter")).send({ tableIds: [ids.T2, ids.T3] }).expect(200);
      await evt;
      expect(m.body).toMatchObject({ id: ids.T2, capacity: 8, mergedTables: [{ id: ids.T3, label: "T3", capacity: 4 }] });
      expect((await table("waiter", ids.T3)).mergedIntoId).toBe(ids.T2);
      await api().post(`${V}/tenant/tables/merge`).set(as("waiter")).send({ tableIds: [ids.T3, ids.T4] }).expect(409);   // T3 déjà absorbée
      // pas de commande sur une table absorbée ; la capacité d'une fusion ne se modifie pas à la main
      expect((await order(ids.T3)).status).toBe(409);
      await api().patch(`${V}/tenant/tables/${ids.T2}`).set(as("manager")).send({ capacity: 5 }).expect(409);
      await api().patch(`${V}/tenant/tables/${ids.T2}`).set(as("manager")).send({ capacity: 8 }).expect(200);
      await api().delete(`${V}/tenant/tables/${ids.T3}`).set(as("manager")).expect(409);
      const s = await api().post(`${V}/tenant/tables/${ids.T3}/split`).set(as("waiter")).expect(200);   // depuis l'une ou l'autre
      expect(s.body).toMatchObject({ id: ids.T2, capacity: 4, mergedTables: [] });
      expect((await table("waiter", ids.T3)).mergedIntoId).toBeNull();
      await api().post(`${V}/tenant/tables/${ids.T2}/split`).set(as("waiter")).expect(409);   // plus fusionnée
    });

    it("une commande ouverte garde la fusion : table principale, séparation refusée jusqu'à l'encaissement", async () => {
      const o = await order(ids.T3).expect(201);
      const o2 = await order(ids.T4).expect(201);
      // commandes sur deux tables : refus
      const refused = await api().post(`${V}/tenant/tables/merge`).set(as("waiter")).send({ tableIds: [ids.T3, ids.T4] });
      expect(refused.status).toBe(409);
      expect(refused.body.message).toMatch(/plusieurs tables/);
      await api().post(`${V}/tenant/orders/${o2.body.id}/cancel`).set(as("manager")).send({ reason: "Test" }).expect(200);
      // T4 libre redevient absorbable : la table qui porte la commande devient la principale, même si elle est citée en second
      const m = await api().post(`${V}/tenant/tables/merge`).set(as("waiter")).send({ tableIds: [ids.T4, ids.T3] }).expect(200);
      expect(m.body).toMatchObject({ id: ids.T3, capacity: 10 });
      expect(m.body.openOrders).toHaveLength(1);
      expect((await api().post(`${V}/tenant/tables/${ids.T3}/split`).set(as("waiter"))).status).toBe(409);
      // encaissement puis service : la commande se clôt, la séparation devient possible
      await api().post(`${V}/tenant/orders/${o.body.id}/payments`).set(as("waiter")).send({ method: "CASH", amount: o.body.total, tendered: o.body.total }).expect(201);
      await api().post(`${V}/tenant/orders/${o.body.id}/advance`).set(as("kitchen")).send({ status: "READY" }).expect(200);
      await api().post(`${V}/tenant/orders/${o.body.id}/advance`).set(as("waiter")).send({ status: "SERVED" }).expect(200);
      expect((await table("waiter", ids.T3)).status).toBe("FREE");
      await api().post(`${V}/tenant/tables/${ids.T3}/split`).set(as("waiter")).expect(200);
    });

    it("deux fusions simultanées de la même table : une seule aboutit", async () => {
      const [a, b] = await Promise.all([
        api().post(`${V}/tenant/tables/merge`).set(as("waiter")).send({ tableIds: [ids.T1, ids.T2] }),
        api().post(`${V}/tenant/tables/merge`).set(as("waiter")).send({ tableIds: [ids.T3, ids.T2] }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const ok = a.status === 200 ? a : b;
      await api().post(`${V}/tenant/tables/${ok.body.id}/split`).set(as("waiter")).expect(200);
    });

    it("la fusion est refusée si une réservation est en cours ou proche, et les disponibilités tiennent compte de la capacité cumulée", async () => {
      // T1 réservée dans l'heure : ne peut pas être absorbée
      const start = new Date(Date.now() + 30 * 60_000);
      const r = await api().post(`${V}/tenant/reservations`).set(as("manager")).send({ guestName: "Ama", partySize: 2, startsAt: start.toISOString(), tableIds: [ids.T1], force: true, overrideReason: "test" });
      expect(r.status).toBe(201);
      const refused = await api().post(`${V}/tenant/tables/merge`).set(as("waiter")).send({ tableIds: [ids.T2, ids.T1] });
      expect(refused.status).toBe(409);
      expect(refused.body.message).toMatch(/réservation/);
      await api().post(`${V}/tenant/reservations/${r.body.id}/cancel`).set(as("manager")).send({}).expect(200);
      // fusion T2+T3 (8 places) : un groupe de 7 tient sur le plan fusionné en une seule table
      await api().post(`${V}/tenant/tables/merge`).set(as("waiter")).send({ tableIds: [ids.T2, ids.T3] }).expect(200);
      const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
      await api().put(`${V}/tenant/opening-hours`).set(as("manager")).send({ ranges: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "11:00", closesAt: "23:00", slotMinutes: 30 })) }).expect(200);
      const av = await api().get(`${V}/tenant/reservations/availability?date=${day}&partySize=7`).set(as("waiter")).expect(200);
      const slot = av.body.slots.find((s: any) => s.available);
      expect(slot.tables.map((t: any) => t.id)).toEqual([ids.T2]);   // une table, 8 places
      await api().post(`${V}/tenant/tables/${ids.T2}/split`).set(as("waiter")).expect(200);
    });
  });

  describe("transfert de commande", () => {
    it("table libre, statuts des deux tables, diffusion, audit", async () => {
      const o = await order(ids.T1).expect(201);
      expect((await table("waiter", ids.T1)).status).toBe("OCCUPIED");
      const sock = await connect(tok.waiter);
      const from = next(sock, "table.updated", (p: any) => p.id === ids.T1 && p.status === "FREE" && p.openOrders.length === 0);
      const to = next(sock, "table.updated", (p: any) => p.id === ids.T2 && p.status === "OCCUPIED" && p.openOrders[0]?.id === o.body.id);
      const upd = next(sock, "order.updated", (p: any) => p.id === o.body.id && p.table.id === ids.T2);
      await api().post(`${V}/tenant/orders/${o.body.id}/move`).set(as("kitchen")).send({ tableId: ids.T2 }).expect(403);
      const res = await api().post(`${V}/tenant/orders/${o.body.id}/move`).set(as("waiter")).send({ tableId: ids.T2 }).expect(200);
      expect(res.body.table).toEqual({ id: ids.T2, label: "T2" });
      await Promise.all([from, to, upd]);
      expect(await asPlatform(prisma, (tx) => tx.auditLog.count({ where: { action: "order.move" } }))).toBe(1);
      // refus : même table, table occupée, introuvable (autre restaurant), table absorbée
      await api().post(`${V}/tenant/orders/${o.body.id}/move`).set(as("waiter")).send({ tableId: ids.T2 }).expect(409);
      const o3 = await order(ids.T3).expect(201);
      expect((await api().post(`${V}/tenant/orders/${o.body.id}/move`).set(as("waiter")).send({ tableId: ids.T3 })).body.message).toMatch(/occupée/);
      await api().post(`${V}/tenant/orders/${o.body.id}/move`).set(as("waiter")).send({ tableId: ids.otherTable }).expect(404);
      await api().post(`${V}/tenant/orders/${o.body.id}/move`).set(as("other")).send({ tableId: ids.T4 }).expect(404);
      await api().post(`${V}/tenant/orders/${o3.body.id}/cancel`).set(as("manager")).send({ reason: "Test" }).expect(200);
      // encaissement après transfert : la table d'arrivée se libère à la clôture
      await api().post(`${V}/tenant/orders/${o.body.id}/payments`).set(as("waiter")).send({ method: "CASH", amount: res.body.total, tendered: res.body.total }).expect(201);
      await api().post(`${V}/tenant/orders/${o.body.id}/advance`).set(as("kitchen")).send({ status: "READY" }).expect(200);
      await api().post(`${V}/tenant/orders/${o.body.id}/advance`).set(as("waiter")).send({ status: "SERVED" }).expect(200);
      expect((await table("waiter", ids.T2)).status).toBe("FREE");
      await api().post(`${V}/tenant/orders/${o.body.id}/move`).set(as("waiter")).send({ tableId: ids.T4 }).expect(409);   // commande terminée
    });

    it("une commande à emporter ne se transfère pas ; vers une table absorbée : refus", async () => {
      const take = await api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "TAKEAWAY", items: [{ menuItemId: ids.item, quantity: 1, optionIds: [] }] }).expect(201);
      await api().post(`${V}/tenant/orders/${take.body.id}/move`).set(as("waiter")).send({ tableId: ids.T4 }).expect(409);
      await api().post(`${V}/tenant/orders/${take.body.id}/cancel`).set(as("manager")).send({ reason: "Test" }).expect(200);
      await api().post(`${V}/tenant/tables/merge`).set(as("waiter")).send({ tableIds: [ids.T3, ids.T4] }).expect(200);
      const o = await order(ids.T1).expect(201);
      await api().post(`${V}/tenant/orders/${o.body.id}/move`).set(as("waiter")).send({ tableId: ids.T4 }).expect(409);
      await api().post(`${V}/tenant/orders/${o.body.id}/move`).set(as("waiter")).send({ tableId: ids.T3 }).expect(200);   // vers la principale
      expect((await table("waiter", ids.T3)).openOrders).toHaveLength(1);
    });

    it("deux transferts simultanés vers la même table : un seul aboutit", async () => {
      await api().post(`${V}/tenant/tables/${ids.T3}/split`).set(as("waiter")).expect(409);   // occupée
      const a = (await api().get(`${V}/tenant/orders?open=true`).set(as("waiter"))).body.items.find((x: any) => x.table?.id === ids.T3);
      await api().post(`${V}/tenant/orders/${a.id}/cancel`).set(as("manager")).send({ reason: "Test" }).expect(200);
      await api().post(`${V}/tenant/tables/${ids.T3}/split`).set(as("waiter")).expect(200);
      const [o1, o2] = [await order(ids.T1).expect(201), await order(ids.T2).expect(201)];
      const [r1, r2] = await Promise.all([
        api().post(`${V}/tenant/orders/${o1.body.id}/move`).set(as("waiter")).send({ tableId: ids.T4 }),
        api().post(`${V}/tenant/orders/${o2.body.id}/move`).set(as("waiter")).send({ tableId: ids.T4 }),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    });

    it("la réservation installée suit la commande ; table réservée au même moment : refus", async () => {
      // tables libérées
      for (const o of (await api().get(`${V}/tenant/orders?open=true`).set(as("waiter"))).body.items) {
        await api().post(`${V}/tenant/orders/${o.id}/cancel`).set(as("manager")).send({ reason: "Nettoyage" }).expect(200);
      }
      const w = await api().post(`${V}/tenant/reservations`).set(as("waiter")).send({ guestName: "Kossi", partySize: 2, source: "WALK_IN", tableIds: [ids.T1] }).expect(201);
      await api().post(`${V}/tenant/reservations/${w.body.id}/seat`).set(as("waiter")).expect(200);
      const o = await api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "DINE_IN", tableId: ids.T1, reservationId: w.body.id, items: [{ menuItemId: ids.item, quantity: 1, optionIds: [] }] }).expect(201);
      // T2 réservée par un autre client dans l'heure : transfert refusé, rien n'a changé
      const later = await api().post(`${V}/tenant/reservations`).set(as("manager")).send({ guestName: "Ama", partySize: 2, startsAt: new Date(Date.now() + 30 * 60_000).toISOString(), tableIds: [ids.T2], force: true, overrideReason: "test" }).expect(201);
      const refused = await api().post(`${V}/tenant/orders/${o.body.id}/move`).set(as("waiter")).send({ tableId: ids.T2 });
      expect(refused.status).toBe(409);
      expect((await api().get(`${V}/tenant/orders/${o.body.id}`).set(as("waiter"))).body.table.id).toBe(ids.T1);
      await api().post(`${V}/tenant/reservations/${later.body.id}/cancel`).set(as("manager")).send({}).expect(200);
      await api().post(`${V}/tenant/orders/${o.body.id}/move`).set(as("waiter")).send({ tableId: ids.T2 }).expect(200);
      const r = (await api().get(`${V}/tenant/reservations/${w.body.id}`).set(as("waiter"))).body;
      expect(r.tables.map((t: any) => t.id)).toEqual([ids.T2]);
      expect((await table("waiter", ids.T1)).status).toBe("FREE");
      expect((await table("waiter", ids.T2)).status).toBe("OCCUPIED");
      await api().post(`${V}/tenant/reservations/${w.body.id}/complete`).set(as("waiter")).expect(200);   // la fin du repas libère bien la nouvelle table (commande encore ouverte : reste occupée)
      expect((await table("waiter", ids.T2)).status).toBe("OCCUPIED");
    });
  });
});
