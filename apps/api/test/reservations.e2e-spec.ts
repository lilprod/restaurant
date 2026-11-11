import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { addDays, reminderInstant, zonedDay } from "@restaurant/utils";
import { AddressInfo } from "node:net";
import { io, Socket } from "socket.io-client";
import request from "supertest";
import { NotificationsService } from "../src/notifications/notifications.service";
import { ReservationsTasks } from "../src/reservations/reservations.tasks";
import { asPlatform, createApp, login, resetDb, seedPlatform } from "./helpers";

const PW = "Cigale-Bleue74";

describe("P2A Réservations : disponibilités, double réservation, cycle de vie, liste d'attente, en ligne (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let notif: NotificationsService;
  let tasks: ReservationsTasks;
  let root: string;
  let port: number;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const sockets: Socket[] = [];
  const V = "/api/v1";
  const api = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  // Restaurant à Lomé (UTC+0) : l'heure locale = l'heure UTC. Jour de test : J+3.
  const D = addDays(zonedDay(new Date(), "Africa/Lome"), 3);
  const at = (hhmm: string, day = D) => `${day}T${hhmm}:00.000Z`;

  const tenantLogin = async (slug: string, email: string, password = PW) =>
    (await api().post(`${V}/tenant/auth/login`).send({ tenantSlug: slug, email, password })).body.accessToken as string;
  const makeTenant = async (slug: string, planId: string) => {
    const res = await api().post(`${V}/platform/tenants`).set({ Authorization: `Bearer ${root}` }).send({
      name: slug, slug, email: `contact@${slug}.tg`, phone: "22 21 00 00", planId,
      admin: { firstName: "Ama", lastName: "Koffi", email: `admin@${slug}.tg`, password: PW },
    });
    expect(res.status).toBe(201);
    await asPlatform(prisma, (tx) => tx.user.updateMany({ where: { tenantId: res.body.id }, data: { mustChangePassword: false } }));
    return res.body.id as string;
  };
  const addStaff = async (slug: string, who: string, role: string, admin = "admin") => {
    const res = await api().post(`${V}/tenant/staff`).set(as(admin)).send({ email: `${who}@${slug}.tg`, firstName: who, lastName: "Test", role });
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
  const book = (who: string, body: Record<string, unknown>) =>
    api().post(`${V}/tenant/reservations`).set(as(who)).send({ guestName: "Kossi Mensah", guestPhone: "90 11 22 33", ...body });
  const action = (who: string, id: string, act: string, body: object = {}) => api().post(`${V}/tenant/reservations/${id}/${act}`).set(as(who)).send(body);
  const lastMail = (to: string) => [...notif.outbox].reverse().find((m) => m.to === to);

  beforeAll(async () => {
    prisma = new PrismaClient();
    await resetDb(prisma);
    const seed = await seedPlatform(prisma);
    app = await createApp();
    await app.listen(0, "127.0.0.1");
    port = (app.getHttpServer().address() as AddressInfo).port;
    notif = app.get(NotificationsService);
    tasks = app.get(ReservationsTasks);
    root = (await login(app, "root@test.local")).body.accessToken;
    ids.tenant = await makeTenant("baobab", seed.pro.id);
    ids.other = await makeTenant("voisin", seed.pro.id);
    tok.admin = await tenantLogin("baobab", "admin@baobab.tg");
    tok.manager = await addStaff("baobab", "manager", "MANAGER");
    tok.waiter = await addStaff("baobab", "waiter", "WAITER");
    tok.kitchen = await addStaff("baobab", "kitchen", "KITCHEN");
    tok.otherAdmin = await tenantLogin("voisin", "admin@voisin.tg");
    for (const [label, capacity] of [["T2", 2], ["T4", 4], ["T6", 6]] as const) {
      const r = await api().post(`${V}/tenant/tables`).set(as("admin")).send({ label, capacity });
      expect(r.status).toBe(201);
      ids[label] = r.body.id;
    }
    await api().post(`${V}/tenant/tables`).set(as("otherAdmin")).send({ label: "V1", capacity: 4 }).expect(201);
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await app.close();
    await prisma.$disconnect();
  });

  describe("horaires, fermetures, réglages", () => {
    const week = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "11:00", closesAt: "23:00", slotMinutes: 30 }));

    it("seuls les responsables modifient les horaires ; plages qui se chevauchent refusées", async () => {
      await api().put(`${V}/tenant/opening-hours`).set(as("waiter")).send({ ranges: week }).expect(403);
      const bad = await api().put(`${V}/tenant/opening-hours`).set(as("manager"))
        .send({ ranges: [{ weekday: 1, opensAt: "12:00", closesAt: "15:00" }, { weekday: 1, opensAt: "14:30", closesAt: "18:00" }] });
      expect(bad.status).toBe(400);
      expect(bad.body.errors[0].path).toBe("ranges.1.opensAt");
      const ok = await api().put(`${V}/tenant/opening-hours`).set(as("manager")).send({ ranges: week });
      expect(ok.status).toBe(200);
      expect(ok.body.ranges).toHaveLength(7);
      const read = await api().get(`${V}/tenant/opening-hours`).set(as("kitchen")).expect(200);
      expect(read.body.ranges[0]).toEqual({ weekday: 0, opensAt: "11:00", closesAt: "23:00", slotMinutes: 30 });
      // l'autre restaurant n'a aucun horaire
      expect((await api().get(`${V}/tenant/opening-hours`).set(as("otherAdmin"))).body.ranges).toEqual([]);
    });

    it("fermeture exceptionnelle : aucune disponibilité ce jour-là, doublon refusé, suppression", async () => {
      const day = addDays(D, 2);
      await api().post(`${V}/tenant/closures`).set(as("waiter")).send({ date: day }).expect(403);
      const c = await api().post(`${V}/tenant/closures`).set(as("manager")).send({ date: day, reason: "Fête nationale" });
      expect(c.status).toBe(201);
      expect(c.body.affectedReservations).toEqual([]);
      await api().post(`${V}/tenant/closures`).set(as("manager")).send({ date: day }).expect(409);
      const av = await api().get(`${V}/tenant/reservations/availability?date=${day}&partySize=2`).set(as("waiter")).expect(200);
      expect(av.body).toMatchObject({ closed: true, closureReason: "Fête nationale", slots: [] });
      expect((await api().get(`${V}/tenant/closures`).set(as("kitchen"))).body).toHaveLength(1);
      expect((await api().get(`${V}/tenant/closures`).set(as("otherAdmin"))).body).toHaveLength(0);
      await api().delete(`${V}/tenant/closures/${c.body.id}`).set(as("otherAdmin")).expect(404);
      await api().delete(`${V}/tenant/closures/${c.body.id}`).set(as("manager")).expect(204);
    });

    it("section de réglages « reservations » : lecture par le personnel, écriture par l'administrateur", async () => {
      const r = await api().get(`${V}/tenant/settings/reservations`).set(as("waiter")).expect(200);
      expect(r.body).toEqual({ requireConfirmation: false, bookingWindowDays: 60, minNoticeMinutes: 60, noShowGraceMinutes: 20, bufferMinutes: 0 });
      await api().patch(`${V}/tenant/settings/reservations`).set(as("manager")).send({ bufferMinutes: 10 }).expect(403);
      await api().patch(`${V}/tenant/settings/reservations`).set(as("admin")).send({ bufferMinutes: 500 }).expect(400);
    });
  });

  describe("disponibilités et réservations de la salle", () => {
    it("créneaux du jour avec la plus petite table suffisante, ou une combinaison", async () => {
      const av = await api().get(`${V}/tenant/reservations/availability?date=${D}&partySize=3`).set(as("kitchen")).expect(200);
      expect(av.body).toMatchObject({ date: D, timezone: "Africa/Lome", closed: false, durationMinutes: 90 });
      const s19 = av.body.slots.find((s: any) => s.startsAt === at("19:00"));
      expect(s19).toMatchObject({ available: true, endsAt: at("20:30"), tables: [{ label: "T4", capacity: 4 }] });
      expect(av.body.slots.at(-1).startsAt).toBe(at("21:30")); // 21:30 + 90 min = 23:00
      const big = await api().get(`${V}/tenant/reservations/availability?date=${D}&partySize=9`).set(as("waiter")).expect(200);
      expect(big.body.slots[0].tables.map((t: any) => t.label).sort()).toEqual(["T4", "T6"]);
      await api().get(`${V}/tenant/reservations/availability?date=demain&partySize=2`).set(as("waiter")).expect(400);
    });

    it("création par la salle : confirmée, table attribuée, email avec lien de gestion, temps réel limité au restaurant", async () => {
      const mine = await connect(tok.manager);
      const theirs = await connect(tok.otherAdmin);
      let leaked = false;
      theirs.on("reservation.created", () => { leaked = true; });
      const created = next(mine, "reservation.created");

      await book("kitchen", { partySize: 2, startsAt: at("19:00") }).expect(403);
      const invalid = await book("waiter", { guestName: "", partySize: 0, startsAt: at("19:00") });
      expect(invalid.status).toBe(400);
      expect(invalid.body.errors.map((e: any) => e.path).sort()).toEqual(["guestName", "partySize"]);

      const r = await book("waiter", { partySize: 2, startsAt: at("19:00"), guestEmail: "kossi@exemple.tg", specialRequests: "Anniversaire" });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ status: "CONFIRMED", source: "PHONE", partySize: 2, durationMinutes: 90, endsAt: at("20:30"), tables: [{ label: "T2" }] });
      expect(r.body.code).toMatch(/^[A-Z2-9]{5}$/);
      ids.r1 = r.body.id;
      expect((await created).id).toBe(ids.r1);
      await notif.flush();
      const mail = lastMail("kossi@exemple.tg")!;
      expect(mail.subject).toContain("Réservation confirmée");
      expect(mail.text).toContain(r.body.code);
      expect(mail.text).toMatch(/\/r\/baobab\/reservation\/[A-Za-z0-9_-]{20,}/);
      expect(notif.smsOutbox.length).toBe(0); // canal SMS désactivé par défaut
      await new Promise((ok) => setTimeout(ok, 100));
      expect(leaked).toBe(false);
    });

    it("isolation : un autre restaurant ne voit ni ne modifie la réservation", async () => {
      await api().get(`${V}/tenant/reservations/${ids.r1}`).set(as("otherAdmin")).expect(404);
      await action("otherAdmin", ids.r1, "cancel").expect(404);
      expect((await api().get(`${V}/tenant/reservations?date=${D}`).set(as("otherAdmin"))).body).toEqual([]);
      const av = await api().get(`${V}/tenant/reservations/availability?date=${D}&partySize=2`).set(as("otherAdmin")).expect(200);
      expect(av.body.slots).toEqual([]); // pas d'horaires chez le voisin
    });

    it("table choisie déjà prise → 409 ; capacité dépassée → 409, forçage réservé aux responsables avec motif", async () => {
      const clash = await book("waiter", { partySize: 2, startsAt: at("20:00"), tableIds: [ids.T2] });
      expect(clash.status).toBe(409);
      expect(clash.body.message).toBe("La table T2 est déjà réservée de 19:00 à 20:30");
      await book("waiter", { partySize: 5, startsAt: at("12:00"), tableIds: [ids.T4] }).expect(409);
      await book("waiter", { partySize: 5, startsAt: at("12:00"), tableIds: [ids.T4], force: true, overrideReason: "Chaise ajoutée" }).expect(403);
      await book("manager", { partySize: 5, startsAt: at("12:00"), tableIds: [ids.T4], force: true }).expect(400);
      const forced = await book("manager", { partySize: 5, startsAt: at("12:00"), tableIds: [ids.T4], force: true, overrideReason: "Chaise ajoutée" });
      expect(forced.status).toBe(201);
      expect(forced.body.overrideReason).toBe("Chaise ajoutée");
      const audit = await asPlatform(prisma, (tx) => tx.auditLog.findFirst({ where: { action: "reservation.force", entityId: forced.body.id } }));
      expect(audit).not.toBeNull();
      ids.forced = forced.body.id;
      // hors horaires sans forçage
      await book("waiter", { partySize: 2, startsAt: at("22:00") }).expect(409);
      await book("waiter", { partySize: 2, startsAt: at("08:00") }).expect(409);
      // taille maximale du groupe (réglage operations.maxPartySize = 20)
      expect((await book("waiter", { partySize: 30, startsAt: at("12:00") })).body.errors[0].path).toBe("partySize");
    });

    it("concurrence : 5 demandes simultanées sur la même table → une seule réussit, les autres 409", async () => {
      const res = await Promise.all(Array.from({ length: 5 }, (_, i) =>
        book("waiter", { guestName: `Client ${i}`, partySize: 4, startsAt: at("13:00"), tableIds: [ids.T6] })));
      expect(res.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
      for (const r of res.filter((x) => x.status === 409)) expect(r.body.message).toMatch(/T6 est déjà réservée|déjà réservée/);
    });

    it("concurrence : 6 attributions automatiques simultanées sur 3 tables → 3 réussissent, aucune table en double", async () => {
      const res = await Promise.all(Array.from({ length: 6 }, (_, i) =>
        book("waiter", { guestName: `Groupe ${i}`, partySize: 2, startsAt: at("16:00") })));
      const ok = res.filter((r) => r.status === 201);
      expect(ok).toHaveLength(3);
      expect(res.filter((r) => r.status === 409).every((r) => r.body.message === "Plus de table disponible sur ce créneau")).toBe(true);
      expect(new Set(ok.map((r) => r.body.tables[0].label)).size).toBe(3);
      const overlapping = await asPlatform(prisma, (tx) => tx.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM "ReservationTable" a JOIN "ReservationTable" b
          ON a."tableId" = b."tableId" AND a."reservationId" < b."reservationId"
         AND a.active AND b.active AND a."startsAt" < b."endsAt" AND b."startsAt" < a."endsAt"`);
      expect(Number(overlapping[0].n)).toBe(0);
    });

    it("la contrainte d'exclusion existe en base et refuse un chevauchement inséré directement", async () => {
      const def = await asPlatform(prisma, (tx) => tx.$queryRaw<{ def: string }[]>`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'ReservationTable_no_overlap'`);
      expect(def[0].def).toMatch(/EXCLUDE USING gist .*"tableId" WITH =.*tsrange.*WITH &&.*WHERE \(active\)/);
      const r1 = await asPlatform(prisma, (tx) => tx.reservationTable.findFirstOrThrow({ where: { reservationId: ids.r1 } }));
      const other = await asPlatform(prisma, (tx) => tx.reservation.create({
        data: { tenantId: ids.tenant, code: "ZZZZZ", guestName: "Direct", partySize: 2, startsAt: new Date(at("19:30")), endsAt: new Date(at("21:00")) },
      }));
      await expect(asPlatform(prisma, (tx) => tx.reservationTable.create({
        data: { tenantId: ids.tenant, reservationId: other.id, tableId: r1.tableId, startsAt: new Date(at("19:30")), endsAt: new Date(at("21:00")) },
      }))).rejects.toThrow(/ReservationTable_no_overlap|exclusion/);
      // inactive (annulée) : autorisée ; contiguë [) : autorisée
      await asPlatform(prisma, (tx) => tx.reservationTable.create({
        data: { tenantId: ids.tenant, reservationId: other.id, tableId: r1.tableId, startsAt: new Date(at("19:30")), endsAt: new Date(at("21:00")), active: false },
      }));
      await asPlatform(prisma, (tx) => tx.reservationTable.update({
        where: { reservationId_tableId: { reservationId: other.id, tableId: r1.tableId } }, data: { startsAt: new Date(at("20:30")), endsAt: new Date(at("21:30")), active: true },
      }));
      await asPlatform(prisma, (tx) => tx.reservation.delete({ where: { id: other.id } }));
    });

    it("modification : heure et taille réattribuent la table ; notification au client", async () => {
      notif.outbox.length = 0;
      const moved = await api().patch(`${V}/tenant/reservations/${ids.r1}`).set(as("waiter")).send({ partySize: 4, startsAt: at("19:30"), notes: "Client fidèle" });
      expect(moved.status).toBe(200);
      expect(moved.body).toMatchObject({ partySize: 4, startsAt: at("19:30"), endsAt: at("21:00"), notes: "Client fidèle", tables: [{ label: "T4" }] });
      await notif.flush();
      expect(lastMail("kossi@exemple.tg")!.subject).toContain("Réservation modifiée");
      // garde la table actuelle si elle convient encore
      const same = await api().patch(`${V}/tenant/reservations/${ids.r1}`).set(as("waiter")).send({ partySize: 3 });
      expect(same.body.tables).toEqual([expect.objectContaining({ label: "T4" })]);
      await api().patch(`${V}/tenant/reservations/${ids.r1}`).set(as("kitchen")).send({ partySize: 3 }).expect(403);
      // déplacement manuel sur une table libre
      const t6 = await api().patch(`${V}/tenant/reservations/${ids.r1}`).set(as("waiter")).send({ tableIds: [ids.T6] });
      expect(t6.body.tables).toEqual([expect.objectContaining({ label: "T6" })]);
    });

    it("liste du jour (filtres statut et recherche), fiche", async () => {
      const list = await api().get(`${V}/tenant/reservations?date=${D}`).set(as("kitchen")).expect(200);
      expect(list.body.length).toBeGreaterThanOrEqual(5);
      expect(list.body.map((r: any) => r.startsAt)).toEqual([...list.body.map((r: any) => r.startsAt)].sort());
      const code = list.body.find((r: any) => r.id === ids.r1).code;
      expect((await api().get(`${V}/tenant/reservations?date=${D}&search=${code.toLowerCase()}`).set(as("waiter"))).body.map((r: any) => r.id)).toEqual([ids.r1]);
      expect((await api().get(`${V}/tenant/reservations?date=${D}&search=kossi`).set(as("waiter"))).body.length).toBeGreaterThanOrEqual(1);
      expect((await api().get(`${V}/tenant/reservations?date=${D}&status=CANCELLED,NO_SHOW`).set(as("waiter"))).body).toEqual([]);
      await api().get(`${V}/tenant/reservations?status=INCONNU`).set(as("waiter")).expect(400);
      const one = await api().get(`${V}/tenant/reservations/${ids.r1}`).set(as("kitchen")).expect(200);
      expect(one.body).toMatchObject({ guestName: "Kossi Mensah", specialRequests: "Anniversaire", orderId: null });
    });
  });

  describe("installation, commande, fin, absence", () => {
    it("client sans réservation : installé, table occupée, commande ouverte depuis la réservation, fin du repas", async () => {
      const cat = await api().post(`${V}/tenant/menu/categories`).set(as("admin")).send({ name: "Plats" }).expect(201);
      const item = await api().post(`${V}/tenant/menu/items`).set(as("admin")).send({ categoryId: cat.body.id, name: "Fufu", price: 2500 }).expect(201);
      const sock = await connect(tok.waiter);

      const w = await book("waiter", { source: "WALK_IN", partySize: 2, tableIds: [ids.T2] });
      expect(w.status).toBe(201);
      expect(w.body.source).toBe("WALK_IN");
      const tableEvt = next(sock, "table.updated", (p: any) => p.id === ids.T2 && p.status === "OCCUPIED");
      const seated = await action("waiter", w.body.id, "seat").expect(200);
      expect(seated.body.status).toBe("SEATED");
      await tableEvt;
      await action("waiter", w.body.id, "seat").expect(409);
      await action("waiter", w.body.id, "cancel").expect(409);

      // commande liée : uniquement sur une table de la réservation installée
      await api().post(`${V}/tenant/orders`).set(as("waiter"))
        .send({ type: "DINE_IN", tableId: ids.T4, reservationId: w.body.id, items: [{ menuItemId: item.body.id, quantity: 1, optionIds: [] }] }).expect(409);
      await api().post(`${V}/tenant/orders`).set(as("waiter"))
        .send({ type: "DINE_IN", tableId: ids.T2, reservationId: ids.r1, items: [{ menuItemId: item.body.id, quantity: 1, optionIds: [] }] }).expect(409);
      const order = await api().post(`${V}/tenant/orders`).set(as("waiter"))
        .send({ type: "DINE_IN", tableId: ids.T2, reservationId: w.body.id, items: [{ menuItemId: item.body.id, quantity: 1, optionIds: [] }] });
      expect(order.status).toBe(201);
      expect(order.body.reservationId).toBe(w.body.id);
      expect((await api().get(`${V}/tenant/reservations/${w.body.id}`).set(as("waiter"))).body.orderId).toBe(order.body.id);

      // une autre réservation ne peut pas être installée sur une table encore occupée
      const done = await action("waiter", w.body.id, "complete").expect(200);
      expect(done.body.status).toBe("COMPLETED");
      const t2 = (await api().get(`${V}/tenant/tables`).set(as("waiter"))).body.find((t: any) => t.id === ids.T2);
      expect(t2.status).toBe("OCCUPIED"); // la commande est encore ouverte
      const w2 = await book("waiter", { source: "WALK_IN", partySize: 2, tableIds: [ids.T2] });
      expect(w2.status).toBe(201); // la réservation terminée a libéré le créneau
      const busy = await action("waiter", w2.body.id, "seat");
      expect(busy.status).toBe(409);
      expect(busy.body.message).toMatch(/T2 est encore occupée \(commande n° \d+\)/);
      await action("waiter", w2.body.id, "cancel", { reason: "Partis" }).expect(200);
    });

    it("installation trop tôt refusée ; absence possible seulement après l'heure, puis table libérée", async () => {
      await action("waiter", ids.forced, "seat").expect(409);
      await action("waiter", ids.forced, "no-show").expect(409);
      await action("kitchen", ids.forced, "no-show").expect(403);
      await asPlatform(prisma, (tx) => tx.reservation.update({ where: { id: ids.forced }, data: { startsAt: new Date(Date.now() - 30 * 60_000) } }));
      const ns = await action("waiter", ids.forced, "no-show").expect(200);
      expect(ns.body.status).toBe("NO_SHOW");
      const rt = await asPlatform(prisma, (tx) => tx.reservationTable.findMany({ where: { reservationId: ids.forced } }));
      expect(rt.every((x) => !x.active)).toBe(true);
    });

    it("tâche planifiée : absence proposée après le délai de grâce", async () => {
      const r = await book("waiter", { source: "WALK_IN", partySize: 2, tableIds: [ids.T4] });
      await asPlatform(prisma, (tx) => tx.reservation.update({ where: { id: r.body.id }, data: { startsAt: new Date(Date.now() - 10 * 60_000) } }));
      await tasks.suggestNoShows();
      expect((await api().get(`${V}/tenant/reservations/${r.body.id}`).set(as("waiter"))).body.noShowSuggested).toBe(false);
      const sock = await connect(tok.waiter);
      const evt = next(sock, "reservation.updated", (p: any) => p.id === r.body.id && p.noShowSuggested);
      expect(await tasks.suggestNoShows(new Date(Date.now() + 11 * 60_000))).toBe(1);
      await evt;
      expect(await tasks.suggestNoShows(new Date(Date.now() + 12 * 60_000))).toBe(0);
      await action("waiter", r.body.id, "cancel", { notifyGuest: false }).expect(200);
    });
  });

  describe("liste d'attente", () => {
    it("annulation → proposition à l'entrée compatible → message → conversion (une seule fois)", async () => {
      await api().post(`${V}/tenant/waitlist`).set(as("kitchen")).send({ guestName: "Afi", partySize: 2, desiredAt: at("19:30") }).expect(403);
      const sock = await connect(tok.manager);
      const evt = next(sock, "waitlist.updated", (p: any) => p.guestName === "Afi Lawson");
      const e = await api().post(`${V}/tenant/waitlist`).set(as("waiter"))
        .send({ guestName: "Afi Lawson", guestEmail: "afi@exemple.tg", partySize: 4, desiredAt: at("19:45") });
      expect(e.status).toBe(201);
      expect(e.body.status).toBe("WAITING");
      await evt;
      await api().post(`${V}/tenant/waitlist`).set(as("waiter")).send({ guestName: "Trop nombreux", partySize: 12, desiredAt: at("19:45") }).expect(201);
      expect((await api().get(`${V}/tenant/waitlist?date=${D}`).set(as("waiter"))).body).toHaveLength(2);
      expect((await api().get(`${V}/tenant/waitlist`).set(as("otherAdmin"))).body).toEqual([]);

      notif.outbox.length = 0;
      const cancelled = await action("waiter", ids.r1, "cancel", { reason: "Empêchement" });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe("CANCELLED");
      expect(cancelled.body.waitlistMatches.map((m: any) => m.guestName)).toEqual(["Afi Lawson"]);
      expect((await api().get(`${V}/tenant/reservations/${ids.r1}/waitlist-matches`).set(as("waiter"))).body).toHaveLength(1);
      await notif.flush();
      expect(lastMail("kossi@exemple.tg")!.subject).toContain("annulée");
      const audit = await asPlatform(prisma, (tx) => tx.auditLog.findFirst({ where: { action: "reservation.cancel", entityId: ids.r1 } }));
      expect(audit?.metadata).toMatchObject({ reason: "Empêchement" });

      const n = await api().post(`${V}/tenant/waitlist/${e.body.id}/notify`).set(as("waiter")).expect(200);
      expect(n.body).toMatchObject({ status: "NOTIFIED", notifications: ["queued"] });
      await notif.flush();
      expect(lastMail("afi@exemple.tg")!.subject).toContain("Une table s'est libérée");

      await api().post(`${V}/tenant/waitlist/${e.body.id}/convert`).set(as("otherAdmin")).send({}).expect(404);
      const conv = await api().post(`${V}/tenant/waitlist/${e.body.id}/convert`).set(as("waiter")).send({ startsAt: at("19:30") });
      expect(conv.status).toBe(201);
      expect(conv.body.entry).toMatchObject({ status: "CONVERTED", reservationId: conv.body.reservation.id });
      expect(conv.body.reservation).toMatchObject({ guestName: "Afi Lawson", partySize: 4, startsAt: at("19:30"), status: "CONFIRMED" });
      await api().post(`${V}/tenant/waitlist/${e.body.id}/convert`).set(as("waiter")).send({}).expect(409);
      const rm = await api().get(`${V}/tenant/waitlist`).set(as("waiter"));
      const other = rm.body.find((x: any) => x.guestName === "Trop nombreux");
      await api().post(`${V}/tenant/waitlist/${other.id}/remove`).set(as("waiter")).expect(200);
      expect((await api().get(`${V}/tenant/waitlist?status=REMOVED`).set(as("waiter"))).body).toHaveLength(1);
    });
  });

  describe("réservation en ligne sans compte", () => {
    let token: string;

    it("créneaux publics : seulement les disponibles, pas les tables", async () => {
      const av = await api().get(`${V}/public/tenants/baobab/availability?date=${D}&partySize=2`).expect(200);
      expect(av.body.slots.length).toBeGreaterThan(0);
      expect(av.body.slots[0]).toEqual({ startsAt: expect.any(String), endsAt: expect.any(String) });
      expect(av.body.slots.some((s: any) => s.startsAt === at("16:00"))).toBe(false); // T2, T4, T6 prises à 16:00
      await api().get(`${V}/public/tenants/inconnu/availability?date=${D}&partySize=2`).expect(404);
      expect((await api().get(`${V}/public/tenants/baobab/availability?date=${D}&partySize=40`)).status).toBe(400);
      const far = await api().get(`${V}/public/tenants/baobab/availability?date=${addDays(D, 90)}&partySize=2`).expect(200);
      expect(far.body.slots).toEqual([]);
    });

    it("réserver : code + lien de gestion, email de confirmation ; règles de créneau, délai et désactivation", async () => {
      const body = { guestName: "Yao Agbeko", guestPhone: "+228 90 00 00 01", guestEmail: "yao@exemple.tg", partySize: 2, startsAt: at("12:30"), specialRequests: "Près de la fenêtre" };
      await api().post(`${V}/public/tenants/baobab/reservations`).send({ ...body, startsAt: at("12:10") }).expect(409); // hors grille
      const soon = new Date(Date.now() + 10 * 60_000).toISOString();
      await api().post(`${V}/public/tenants/baobab/reservations`).send({ ...body, startsAt: soon }).expect(409);
      const bad = await api().post(`${V}/public/tenants/baobab/reservations`).send({ ...body, guestPhone: "" });
      expect(bad.status).toBe(400);

      notif.outbox.length = 0;
      const sock = await connect(tok.waiter);
      const evt = next(sock, "reservation.created", (p: any) => p.source === "ONLINE");
      const r = await api().post(`${V}/public/tenants/baobab/reservations`).send(body);
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ status: "CONFIRMED", code: expect.stringMatching(/^[A-Z2-9]{5}$/) });
      expect(r.body.manageUrl).toBe(`http://localhost:5173/r/baobab/reservation/${r.body.manageToken}`);
      expect(r.body.reservation).not.toHaveProperty("tables");
      expect(r.body.reservation).not.toHaveProperty("notes");
      token = r.body.manageToken;
      expect((await evt).guestName).toBe("Yao Agbeko");
      await notif.flush();
      expect(lastMail("yao@exemple.tg")!.text).toContain(r.body.manageUrl);
      const row = await asPlatform(prisma, (tx) => tx.reservation.findFirstOrThrow({ where: { code: r.body.code, tenantId: ids.tenant } }));
      expect(row.manageTokenHash).not.toBe(token); // seul le hachage est conservé
      const log = await asPlatform(prisma, (tx) => tx.notificationLog.findFirstOrThrow({ where: { to: "yao@exemple.tg", template: "reservation.confirmed" } }));
      expect(log.data).toBeNull(); // lien de gestion : variables non conservées

      await api().patch(`${V}/tenant/settings/operations`).set(as("admin")).send({ onlineReservations: false }).expect(200);
      const off = await api().post(`${V}/public/tenants/baobab/reservations`).send({ ...body, startsAt: at("13:30") });
      expect(off.status).toBe(403);
      expect(off.body.code).toBe("RESERVATIONS_DISABLED");
      expect((await api().get(`${V}/public/tenants/baobab/availability?date=${D}&partySize=2`)).body.code).toBe("RESERVATIONS_DISABLED");
      await api().patch(`${V}/tenant/settings/operations`).set(as("admin")).send({ onlineReservations: true }).expect(200);
    });

    it("lien de gestion : consulter, modifier, annuler ; jeton inconnu → 404", async () => {
      const g = await api().get(`${V}/public/reservations/${token}`).expect(200);
      expect(g.body).toMatchObject({ guestName: "Yao Agbeko", status: "CONFIRMED", canModify: true, canCancel: true, restaurant: { name: "baobab", slug: "baobab" } });
      await api().get(`${V}/public/reservations/${"x".repeat(32)}`).expect(404);
      await api().get(`${V}/public/reservations/court`).expect(404);
      const u = await api().patch(`${V}/public/reservations/${token}`).send({ startsAt: at("14:00"), partySize: 3 });
      expect(u.status).toBe(200);
      expect(u.body).toMatchObject({ startsAt: at("14:00"), partySize: 3 });
      await api().patch(`${V}/public/reservations/${token}`).send({ startsAt: at("14:10") }).expect(409);
      await api().patch(`${V}/public/reservations/${token}`).send({}).expect(400);
      notif.outbox.length = 0;
      const d = await api().delete(`${V}/public/reservations/${token}`).expect(200);
      expect(d.body).toMatchObject({ status: "CANCELLED", canCancel: false, canModify: false });
      await notif.flush();
      expect(lastMail("yao@exemple.tg")!.subject).toContain("annulée");
      await api().delete(`${V}/public/reservations/${token}`).expect(409);
    });

    it("confirmation manuelle (réglage) : en attente, puis confirmée par la salle avec message au client", async () => {
      await api().patch(`${V}/tenant/settings/reservations`).set(as("admin")).send({ requireConfirmation: true }).expect(200);
      notif.outbox.length = 0;
      const r = await api().post(`${V}/public/tenants/baobab/reservations`)
        .send({ guestName: "Esi Dossou", guestPhone: "90000002", guestEmail: "esi@exemple.tg", partySize: 2, startsAt: at("11:00") });
      expect(r.status).toBe(201);
      expect(r.body.status).toBe("PENDING");
      await notif.flush();
      expect(lastMail("esi@exemple.tg")!.subject).toContain("Demande de réservation reçue");
      const id = (await asPlatform(prisma, (tx) => tx.reservation.findFirstOrThrow({ where: { code: r.body.code, tenantId: ids.tenant } }))).id;
      await action("kitchen", id, "confirm").expect(403);
      const c = await action("waiter", id, "confirm").expect(200);
      expect(c.body.status).toBe("CONFIRMED");
      await action("waiter", id, "confirm").expect(409);
      await notif.flush();
      expect(lastMail("esi@exemple.tg")!.subject).toContain("Réservation confirmée");
      await api().patch(`${V}/tenant/settings/reservations`).set(as("admin")).send({ requireConfirmation: false }).expect(200);
    });

    it("limitation de débit : 10 réservations par heure et par IP", async () => {
      delete process.env.DISABLE_THROTTLE;
      try {
        const codes: number[] = [];
        for (let i = 0; i < 11; i++) codes.push((await api().post(`${V}/public/tenants/baobab/reservations`).send({})).status);
        expect(codes.slice(0, 10).every((c) => c === 400)).toBe(true);
        expect(codes[10]).toBe(429);
      } finally {
        process.env.DISABLE_THROTTLE = "1";
      }
    });
  });

  describe("rappel la veille", () => {
    it("envoyé une seule fois à 18 h locale la veille (journal X1)", async () => {
      const r = await book("waiter", { partySize: 2, startsAt: at("20:00"), guestEmail: "rappel@exemple.tg" });
      expect(r.status).toBe(201);
      const due = reminderInstant(new Date(r.body.startsAt), "Africa/Lome")!;
      expect(due.toISOString()).toBe(at("18:00", addDays(D, -1)));
      expect(await tasks.sendReminders(new Date(due.getTime() - 60_000))).toBe(0);
      const first = await tasks.run(new Date(due.getTime() + 60_000));
      expect(first.reminders).toBeGreaterThanOrEqual(1);
      await tasks.run(new Date(due.getTime() + 10 * 60_000));
      await notif.flush();
      const logs = await asPlatform(prisma, (tx) => tx.notificationLog.findMany({ where: { template: "reservation.reminder", to: "rappel@exemple.tg" } }));
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe("SENT");
      expect(lastMail("rappel@exemple.tg")!.subject).toContain("Rappel");
      expect((await api().get(`${V}/tenant/reservations/${r.body.id}`).set(as("waiter"))).body.reminderSentAt).not.toBeNull();
      // déplacée : nouveau rappel possible pour la nouvelle date
      await api().patch(`${V}/tenant/reservations/${r.body.id}`).set(as("waiter")).send({ startsAt: at("20:00", addDays(D, 1)) }).expect(200);
      expect((await api().get(`${V}/tenant/reservations/${r.body.id}`).set(as("waiter"))).body.reminderSentAt).toBeNull();
    });
  });
});
