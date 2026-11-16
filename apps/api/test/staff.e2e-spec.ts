import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { AddressInfo } from "node:net";
import { io, Socket } from "socket.io-client";
import request from "supertest";
import { NotificationsService } from "../src/notifications/notifications.service";
import { asPlatform, createApp, login, resetDb, seedPlatform } from "./helpers";

const PW = "Cigale-Bleue74";

describe("P4 Personnel : fiches, planning, pointage, absences, performances, paie, messagerie (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let seed: Awaited<ReturnType<typeof seedPlatform>>;
  let root: string;
  let port: number;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const sockets: Socket[] = [];
  const V = "/api/v1";
  const S = `${V}/tenant/staff`;
  const M = `${V}/tenant/messaging`;
  const api = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  const notif = () => app.get(NotificationsService);

  const tenantLogin = async (slug: string, email: string, password = PW) =>
    (await api().post(`${V}/tenant/auth/login`).send({ tenantSlug: slug, email, password })).body.accessToken as string;
  const makeTenant = async (slug: string, planId: string) => {
    const res = await api().post(`${V}/platform/tenants`).set({ Authorization: `Bearer ${root}` }).send({
      name: slug, slug, email: `contact@${slug}.tg`, planId,
      admin: { firstName: "Ama", lastName: "Koffi", email: `admin@${slug}.tg`, password: PW },
    });
    expect(res.status).toBe(201);
    await asPlatform(prisma, (tx) => tx.user.updateMany({ where: { tenantId: res.body.id }, data: { mustChangePassword: false } }));
    return res.body.id as string;
  };
  const addStaff = async (slug: string, who: string, role: string, adminTok = "admin") => {
    const res = await api().post(`${V}/tenant/staff`).set(as(adminTok)).send({ email: `${who}@${slug}.tg`, firstName: who, lastName: "Test", role });
    expect(res.status).toBe(201);
    ids[who] = res.body.id;
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
  const profile = (who: string, who2 = "manager", body: object = {}) =>
    api().put(`${S}/profiles/${ids[who]}`).set(as(who2)).send({ position: "Serveur", contractType: "CDI", hiredAt: "2026-01-05", ...body });
  const at = (iso: string) => new Date(iso).toISOString();
  const shift = (staffKey: string, a: string, b: string, who = "manager") =>
    api().post(`${S}/shifts`).set(as(who)).send({ staffId: ids[`staff_${staffKey}`], startsAt: at(a), endsAt: at(b) });

  beforeAll(async () => {
    prisma = new PrismaClient();
    await resetDb(prisma);
    seed = await seedPlatform(prisma);
    await prisma.plan.update({ where: { id: seed.pro.id }, data: { features: { staff: true } } });
    await prisma.plan.update({ where: { id: seed.starter.id }, data: { features: { staff: false } } });
    app = await createApp();
    await app.listen(0, "127.0.0.1");
    port = (app.getHttpServer().address() as AddressInfo).port;
    root = (await login(app, "root@test.local")).body.accessToken;
    ids.tenant = await makeTenant("brasserie", seed.pro.id);
    await makeTenant("voisin", seed.pro.id);
    await makeTenant("petit", seed.starter.id);
    tok.admin = await tenantLogin("brasserie", "admin@brasserie.tg");
    tok.manager = await addStaff("brasserie", "manager", "MANAGER");
    tok.waiter = await addStaff("brasserie", "waiter", "WAITER");
    tok.waiter2 = await addStaff("brasserie", "waiter2", "WAITER");
    tok.kitchen = await addStaff("brasserie", "kitchen", "KITCHEN");
    tok.other = await tenantLogin("voisin", "admin@voisin.tg");
    tok.otherAdmin = tok.other;
    tok.starter = await tenantLogin("petit", "admin@petit.tg");
    tok.starterManager = await addStaff("petit", "chef", "MANAGER", "starter");
  });
  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await app.close();
    await prisma.$disconnect();
  });

  describe("plan et droits", () => {
    it("refuse le module au plan Starter (403 PLAN_FEATURE) sauf la messagerie", async () => {
      for (const path of ["profiles", "planning", "planning/mine", "attendance", "absences", "kiosk", "me/attendance"]) {
        const res = await api().get(`${S}/${path}${path === "attendance" ? "?from=2026-11-01&to=2026-11-02" : ""}`).set(as("starter"));
        expect([path, res.status, res.body.code]).toEqual([path, 403, "PLAN_FEATURE"]);
      }
      const ch = await api().get(`${M}/channels`).set(as("starter"));
      expect(ch.status).toBe(200);
      expect(ch.body.map((c: { kind: string }) => c.kind)).toEqual(["ALL", "FLOOR", "KITCHEN"]);
    });

    it("réserve les écrans aux bons rôles", async () => {
      for (const path of ["profiles", "planning", "absences/balance"]) {
        const waiter = await api().get(`${S}/${path}`).set(as("waiter"));
        expect([path, waiter.status]).toEqual([path, path === "absences/balance" ? 404 : 403]);
      }
      expect((await api().get(`${S}/payroll?from=2026-11-01&to=2026-11-07`).set(as("manager"))).status).toBe(403);
      expect((await api().get(`${S}/performance?from=2026-11-01&to=2026-11-07`).set(as("waiter"))).status).toBe(403);
      expect((await api().get(`${S}/profiles`).set({})).status).toBe(401);
    });
  });

  describe("fiches", () => {
    it("crée les fiches (responsable) ; le taux horaire est réservé à l'administrateur", async () => {
      const bad = await api().put(`${S}/profiles/${ids.waiter}`).set(as("manager")).send({ position: "", hiredAt: "n'importe quoi" });
      expect(bad.status).toBe(400);
      expect(bad.body.errors.map((e: { path: string }) => e.path)).toEqual(expect.arrayContaining(["position", "hiredAt"]));
      expect((await profile("waiter", "manager", { hourlyRate: 2000 })).status).toBe(403);
      expect((await profile("waiter", "waiter")).status).toBe(403);
      for (const [who, rate] of [["waiter", 1000], ["waiter2", 1500], ["kitchen", 1200], ["manager", 2000]] as const) {
        const res = await profile(who, "admin", { hourlyRate: rate, overtimeMultiplier: 1.25, emergencyContact: "Kossi 90 00 00 00" });
        expect(res.status).toBe(200);
        ids[`staff_${who}`] = res.body.profile.id;
        expect(res.body.profile.hourlyRate).toBe(rate);
      }
      const seen = await api().get(`${S}/profiles/${ids.waiter}`).set(as("manager"));
      expect(seen.body.profile).toMatchObject({ position: "Serveur", hiredAt: "2026-01-05", hourlyRate: null, kioskCodeSet: false });
      const mine = await api().get(`${S}/me`).set(as("waiter"));
      expect(mine.body.profile.hourlyRate).toBe(1000);
      expect(JSON.stringify(mine.body)).not.toMatch(/kioskPinHash/);
      // changer un champ sans toucher au taux (responsable) conserve le taux
      expect((await profile("waiter", "manager", { position: "Chef de rang" })).status).toBe(200);
      expect((await api().get(`${S}/profiles/${ids.waiter}`).set(as("admin"))).body.profile).toMatchObject({ position: "Chef de rang", hourlyRate: 1000 });
      await profile("waiter", "manager", { position: "Serveur" });
    });

    it("la liste signale les membres sans fiche ; un autre restaurant ne voit rien", async () => {
      const list = await api().get(`${S}/profiles`).set(as("manager"));
      expect(list.body.find((p: { userId: string }) => p.userId === ids.waiter).profile).not.toBeNull();
      expect(list.body.find((p: { email: string }) => p.email === "admin@brasserie.tg").profile).toBeNull();
      expect((await api().get(`${S}/profiles/${ids.waiter}`).set(as("other"))).status).toBe(404);
      expect((await profile("waiter", "other")).status).toBe(404);
      expect((await api().get(`${S}/profiles`).set(as("other"))).body.map((p: { email: string }) => p.email)).toEqual(["admin@voisin.tg"]);
    });
  });

  describe("planning", () => {
    const FUTURE = "2027-03-01"; // lundi
    it("crée un créneau ; refuse chevauchements, durée excessive, et rôle non responsable", async () => {
      expect((await shift("waiter", "2027-03-01T10:00:00Z", "2027-03-01T18:00:00Z", "waiter")).status).toBe(403);
      expect((await shift("waiter", "2027-03-01T18:00:00Z", "2027-03-01T10:00:00Z")).status).toBe(400);
      expect((await shift("waiter", "2027-03-01T00:00:00Z", "2027-03-01T18:00:01Z")).status).toBe(400);
      const ok = await shift("waiter", "2027-03-01T10:00:00Z", "2027-03-01T18:00:00Z");
      expect(ok.status).toBe(201);
      ids.shift1 = ok.body.id;
      expect(ok.body).toMatchObject({ staffName: "waiter Test", position: "Serveur", publishedAt: null });
      const clash = await shift("waiter", "2027-03-01T17:00:00Z", "2027-03-01T22:00:00Z");
      expect([clash.status, clash.body.code]).toEqual([409, "SHIFT_OVERLAP"]);
      expect(clash.body.message).toContain("10:00–18:00");
      expect((await shift("waiter", "2027-03-01T18:00:00Z", "2027-03-01T22:00:00Z")).status).toBe(201); // bout à bout
      expect((await shift("waiter2", "2027-03-01T17:00:00Z", "2027-03-01T22:00:00Z")).status).toBe(201); // autre personne
    });

    it("deux créneaux simultanés pour la même personne : un seul passe", async () => {
      const send = () => shift("kitchen", "2027-03-02T10:00:00Z", "2027-03-02T14:00:00Z");
      const res = await Promise.all([send(), send(), send()]);
      expect(res.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    });

    it("déplace un créneau (glisser) en conservant l'absence de chevauchement", async () => {
      const moved = await api().patch(`${S}/shifts/${ids.shift1}`).set(as("manager")).send({ staffId: ids.staff_waiter2 });
      expect([moved.status, moved.body.code]).toEqual([409, "SHIFT_OVERLAP"]); // waiter2 a déjà 17:00–22:00
      const ok = await api().patch(`${S}/shifts/${ids.shift1}`).set(as("manager")).send({ startsAt: at("2027-03-02T10:00:00Z"), endsAt: at("2027-03-02T18:00:00Z") });
      expect(ok.status).toBe(200);
      expect(ok.body.startsAt).toBe("2027-03-02T10:00:00.000Z");
    });

    it("refuse un créneau pendant une absence validée", async () => {
      const abs = await api().post(`${S}/absences`).set(as("manager")).send({ staffId: ids.staff_waiter2, type: "SICK", from: "2027-03-03", to: "2027-03-04" });
      expect([abs.status, abs.body.status]).toEqual([201, "APPROVED"]);
      const res = await shift("waiter2", "2027-03-04T10:00:00Z", "2027-03-04T14:00:00Z");
      expect([res.status, res.body.code]).toEqual([409, "ABSENCE_CONFLICT"]);
      const week = await api().get(`${S}/planning?week=2027-03-03`).set(as("manager"));
      expect(week.body).toMatchObject({ weekStart: "2027-03-01", weekEnd: "2027-03-07" });
      expect(week.body.absences).toHaveLength(1);
      expect(week.body.draftCount).toBe(week.body.shifts.length);
    });

    it("copie une semaine en brouillon et ignore ce qui se heurte", async () => {
      const res = await api().post(`${S}/planning/copy`).set(as("manager")).send({ fromWeek: FUTURE, toWeek: "2027-03-08" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ copied: 4, skipped: 0, week: "2027-03-08" });
      const week = await api().get(`${S}/planning?week=2027-03-08`).set(as("manager"));
      expect(week.body.shifts).toHaveLength(4);
      expect(week.body.shifts.every((s: { publishedAt: unknown }) => s.publishedAt === null)).toBe(true);
      const again = await api().post(`${S}/planning/copy`).set(as("manager")).send({ fromWeek: FUTURE, toWeek: "2027-03-10" });
      expect(again.body).toMatchObject({ copied: 0, skipped: 4 });
      expect((await api().post(`${S}/planning/copy`).set(as("manager")).send({ fromWeek: FUTURE, toWeek: FUTURE })).status).toBe(400);
    });

    it("publie : e-mail aux seules personnes concernées, événement privé, brouillons invisibles avant", async () => {
      expect((await api().get(`${S}/planning/mine?week=${FUTURE}`).set(as("waiter"))).body.shifts).toHaveLength(0);
      const sw = await connect(tok.waiter), sk = await connect(tok.kitchen), sm = await connect(tok.manager);
      const kitchenEvents: unknown[] = [], managerEvents: unknown[] = [];
      sk.on("planning.published", (p) => kitchenEvents.push(p));
      sm.on("planning.published", (p) => managerEvents.push(p));
      const got = next(sw, "planning.published");
      notif().outbox.length = 0;
      expect((await api().post(`${S}/planning/publish`).set(as("waiter")).send({ week: FUTURE })).status).toBe(403);
      const res = await api().post(`${S}/planning/publish`).set(as("manager")).send({ week: "2027-03-03" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ published: 4, people: 3, week: FUTURE });
      expect(await got).toEqual({ week: FUTURE });
      await notif().flush();
      const to = notif().outbox.map((m) => m.to).sort();
      expect(to).toEqual(["kitchen@brasserie.tg", "waiter2@brasserie.tg", "waiter@brasserie.tg"]);
      const mail = notif().outbox.find((m) => m.to === "waiter@brasserie.tg")!;
      expect(mail.subject).toContain("Votre planning du lundi 1 mars");
      expect(mail.text).toContain("10:00–18:00");
      expect(mail.text).not.toContain("17:00"); // pas le créneau de waiter2
      await new Promise((r) => setTimeout(r, 150));
      expect(kitchenEvents).toHaveLength(1);
      expect(managerEvents).toHaveLength(0); // le responsable n'a aucun créneau
      const mine = await api().get(`${S}/planning/mine?week=${FUTURE}`).set(as("waiter"));
      expect(mine.body.shifts.map((s: { staffName: string }) => s.staffName)).toEqual(["waiter Test", "waiter Test"]);
      expect((await api().post(`${S}/planning/publish`).set(as("manager")).send({ week: FUTURE })).body).toMatchObject({ published: 0 });
    });

    it("isolation : un autre restaurant ne voit ni ne modifie les créneaux", async () => {
      expect((await api().patch(`${S}/shifts/${ids.shift1}`).set(as("other")).send({ notes: "x" })).status).toBe(404);
      expect((await api().delete(`${S}/shifts/${ids.shift1}`).set(as("other"))).status).toBe(404);
      expect((await api().get(`${S}/planning?week=${FUTURE}`).set(as("other"))).body.shifts).toEqual([]);
      expect((await shift("waiter", "2027-03-20T10:00:00Z", "2027-03-20T12:00:00Z", "other")).status).toBe(404);
    });
  });

  describe("pointage", () => {
    const nowShift = async () => {
      const now = Date.now();
      const startsAt = new Date(now - 30 * 60_000), endsAt = new Date(now + 4 * 3_600_000);
      const res = await api().post(`${S}/shifts`).set(as("manager")).send({ staffId: ids.staff_waiter, startsAt, endsAt });
      expect(res.status).toBe(201);
      ids.nowShift = res.body.id;
      const day = startsAt.toISOString().slice(0, 10);
      await api().post(`${S}/planning/publish`).set(as("manager")).send({ week: day });
    };

    it("arrivée rattachée au créneau publié, pause, départ ; états et refus", async () => {
      expect((await api().post(`${S}/me/punch`).set(as("admin")).send({ action: "IN" })).status).toBe(409); // pas de fiche
      expect((await api().post(`${S}/me/punch`).set(as("waiter")).send({ action: "OUT" })).status).toBe(409);
      await nowShift();
      const inn = await api().post(`${S}/me/punch`).set(as("waiter")).send({ action: "IN" });
      expect(inn.status).toBe(200);
      expect(inn.body).toMatchObject({ state: "CLOCKED_IN", shiftId: ids.nowShift, source: "SELF" });
      expect((await api().post(`${S}/me/punch`).set(as("waiter")).send({ action: "IN" })).status).toBe(409);
      expect((await api().post(`${S}/me/punch`).set(as("waiter")).send({ action: "BREAK_END" })).status).toBe(409);
      expect((await api().post(`${S}/me/punch`).set(as("waiter")).send({ action: "BREAK_START" })).body.state).toBe("ON_BREAK");
      expect((await api().post(`${S}/me/punch`).set(as("waiter")).send({ action: "BREAK_START" })).status).toBe(409);
      expect((await api().post(`${S}/me/punch`).set(as("waiter")).send({ action: "BREAK_END" })).body.state).toBe("CLOCKED_IN");
      expect((await api().get(`${S}/me/attendance`).set(as("waiter"))).body).toMatchObject({ state: "CLOCKED_IN", shift: { id: ids.nowShift } });
      expect((await api().get(`${S}/attendance/present`).set(as("manager"))).body.map((a: { staffName: string }) => a.staffName)).toEqual(["waiter Test"]);
      const out = await api().post(`${S}/me/punch`).set(as("waiter")).send({ action: "OUT" });
      expect([out.body.state, out.body.clockOut === null]).toEqual(["OFF", false]);
      ids.att1 = out.body.id;
      expect((await api().post(`${S}/me/punch`).set(as("waiter")).send({ action: "TELEPORT" })).status).toBe(400);
    });

    it("deux arrivées simultanées : un seul pointage ouvert", async () => {
      const send = () => api().post(`${S}/me/punch`).set(as("waiter2")).send({ action: "IN" });
      const res = await Promise.all([send(), send(), send()]);
      expect(res.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      const rows = await asPlatform(prisma, (tx) => tx.attendance.count({ where: { staffId: ids.staff_waiter2, clockOut: null } }));
      expect(rows).toBe(1);
      await api().post(`${S}/me/punch`).set(as("waiter2")).send({ action: "OUT" });
    });

    it("tablette : code haché, essais limités, verrouillage et déverrouillage", async () => {
      expect((await api().put(`${S}/profiles/${ids.kitchen}/kiosk-code`).set(as("manager")).send({ code: "1234" })).status).toBe(400); // trop simple
      expect((await api().put(`${S}/profiles/${ids.kitchen}/kiosk-code`).set(as("waiter")).send({ code: "4821" })).status).toBe(403);
      expect((await api().put(`${S}/profiles/${ids.kitchen}/kiosk-code`).set(as("manager")).send({ code: "4821" })).status).toBe(200);
      expect((await api().put(`${S}/profiles/${ids.waiter}/kiosk-code`).set(as("manager")).send({ code: "90417" })).status).toBe(200);
      const hash = await asPlatform(prisma, (tx) => tx.staffProfile.findUniqueOrThrow({ where: { id: ids.staff_kitchen } }));
      expect(hash.kioskPinHash).toMatch(/^\$argon2/);
      expect(hash.kioskPinHash).not.toContain("4821");
      expect((await api().get(`${S}/profiles/${ids.kitchen}`).set(as("manager"))).body.profile.kioskCodeSet).toBe(true);

      const people = await api().get(`${S}/kiosk`).set(as("waiter2"));
      expect(people.body.map((p: { name: string }) => p.name).sort()).toEqual(["kitchen Test", "waiter Test"]);
      expect(JSON.stringify(people.body)).not.toMatch(/Hash|hash|code/);

      const punch = (code: string, action = "IN", staffId = ids.staff_kitchen) => api().post(`${S}/kiosk/punch`).set(as("waiter2")).send({ staffId, code, action });
      const w1 = await punch("0000");
      expect([w1.status, w1.body.code]).toEqual([400, "KIOSK_CODE_INVALID"]);
      expect(w1.body.message).toContain("4 essais restants");
      for (let i = 0; i < 3; i++) expect((await punch("0000")).status).toBe(400);
      const locked = await punch("0000");
      expect([locked.status, locked.body.code]).toEqual([423, "KIOSK_LOCKED"]);
      const stillLocked = await punch("4821"); // même le bon code est refusé pendant le verrouillage
      expect([stillLocked.status, stillLocked.body.code]).toEqual([423, "KIOSK_LOCKED"]);
      // un autre membre n'est pas verrouillé
      expect((await punch("90417", "IN", ids.staff_waiter)).body).toMatchObject({ state: "CLOCKED_IN", source: "KIOSK", name: "waiter Test" });
      expect((await api().post(`${S}/profiles/${ids.kitchen}/kiosk-unlock`).set(as("waiter")).send()).status).toBe(403);
      expect((await api().post(`${S}/profiles/${ids.kitchen}/kiosk-unlock`).set(as("manager")).send()).status).toBe(200);
      const ok = await punch("4821");
      expect([ok.status, ok.body.state, ok.body.source]).toEqual([200, "CLOCKED_IN", "KIOSK"]);
      expect((await punch("4821", "OUT")).body.state).toBe("OFF");
      await punch("90417", "OUT", ids.staff_waiter);
      expect((await punch("4821", "IN", "00000000-0000-4000-8000-000000000000")).status).toBe(404);
      const audit = await asPlatform(prisma, (tx) => tx.auditLog.findMany({ where: { action: { startsWith: "staff.kiosk" } } }));
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["staff.kiosk.code-set", "staff.kiosk.locked", "staff.kiosk.unlock"]));
    });

    it("le pointage de tablette se rattache au bon créneau", async () => {
      const row = await asPlatform(prisma, (tx) => tx.attendance.findMany({ where: { staffId: ids.staff_waiter, source: "KIOSK" } }));
      // le créneau du moment est déjà pris par le pointage du compte : pas de double rattachement
      expect(row[0].shiftId).toBeNull();
    });

    it("correction par un responsable : motif obligatoire, audit avant/après, chevauchement refusé", async () => {
      const day = new Date().toISOString().slice(0, 10);
      expect((await api().patch(`${S}/attendance/${ids.att1}`).set(as("waiter")).send({ breakMinutes: 5, note: "ok ok" })).status).toBe(403);
      expect((await api().patch(`${S}/attendance/${ids.att1}`).set(as("manager")).send({ breakMinutes: 5 })).status).toBe(400);
      const ok = await api().patch(`${S}/attendance/${ids.att1}`).set(as("manager")).send({ breakMinutes: 20, note: "Pause oubliée" });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ breakMinutes: 20, note: "Pause oubliée" });
      expect(ok.body.correctedAt).not.toBeNull();
      const log = await asPlatform(prisma, (tx) => tx.auditLog.findFirstOrThrow({ where: { action: "staff.attendance.correct" } }));
      expect(log.metadata).toMatchObject({ note: "Pause oubliée", after: { breakMinutes: 20 } });
      const list = await api().get(`${S}/attendance?from=${day}&to=${day}`).set(as("manager"));
      expect(list.body.length).toBeGreaterThanOrEqual(2);
      expect((await api().get(`${S}/attendance?from=${day}&to=${day}`).set(as("waiter"))).status).toBe(403);
      expect((await api().patch(`${S}/attendance/${ids.att1}`).set(as("other")).send({ breakMinutes: 1, note: "intrus" })).status).toBe(404);
    });
  });

  describe("absences et congés", () => {
    it("demande de congés, solde, validation par un responsable (jamais par soi-même)", async () => {
      const bal = await api().get(`${S}/absences/balance?year=2027`).set(as("waiter"));
      expect(bal.body).toMatchObject({ allowance: 24, taken: 0, pending: 0, remaining: 24 });
      expect((await api().post(`${S}/absences`).set(as("waiter")).send({ type: "PAID_LEAVE", from: "2027-05-10", to: "2027-05-05" })).status).toBe(400);
      expect((await api().post(`${S}/absences`).set(as("waiter")).send({ type: "PAID_LEAVE", staffId: ids.staff_waiter2, from: "2027-05-10", to: "2027-05-11" })).status).toBe(403);
      const req = await api().post(`${S}/absences`).set(as("waiter")).send({ type: "PAID_LEAVE", from: "2027-05-10", to: "2027-05-14", reason: "Mariage" });
      expect([req.status, req.body.status, req.body.days]).toEqual([201, "PENDING", 5]);
      ids.abs1 = req.body.id;
      expect((await api().post(`${S}/absences`).set(as("waiter")).send({ type: "SICK", from: "2027-05-12", to: "2027-05-12" })).status).toBe(409); // chevauche
      const tooMany = await api().post(`${S}/absences`).set(as("waiter")).send({ type: "PAID_LEAVE", from: "2027-06-01", to: "2027-06-30" });
      expect(tooMany.status).toBe(409);
      expect(tooMany.body.message).toContain("Solde de congés insuffisant");
      expect((await api().get(`${S}/absences/balance?year=2027`).set(as("waiter"))).body).toMatchObject({ year: 2027, pending: 5, remaining: 19 });
      expect((await api().get(`${S}/absences`).set(as("waiter2"))).body.map((a: { id: string }) => a.id)).not.toContain(ids.abs1); // chacun ne voit que les siennes
      expect((await api().get(`${S}/absences`).set(as("manager"))).body.map((a: { id: string }) => a.id)).toContain(ids.abs1);
      expect((await api().post(`${S}/absences/${ids.abs1}/decision`).set(as("waiter")).send({ decision: "APPROVED" })).status).toBe(403);
      expect((await api().post(`${S}/absences/${ids.abs1}/decision`).set(as("other")).send({ decision: "APPROVED" })).status).toBe(404);
      const ok = await api().post(`${S}/absences/${ids.abs1}/decision`).set(as("manager")).send({ decision: "APPROVED", note: "Bonne fête" });
      expect([ok.status, ok.body.status]).toEqual([200, "APPROVED"]);
      expect((await api().post(`${S}/absences/${ids.abs1}/decision`).set(as("manager")).send({ decision: "REJECTED" })).status).toBe(409);
      expect((await api().get(`${S}/absences/balance?year=2027`).set(as("waiter"))).body).toMatchObject({ taken: 5, pending: 0, remaining: 19 });
      expect((await api().delete(`${S}/absences/${ids.abs1}`).set(as("waiter"))).status).toBe(409); // validée : plus retirable par la personne
    });

    it("un responsable ne valide pas sa propre demande ; une demande en attente se retire", async () => {
      await profile("manager", "admin", { hourlyRate: 2000 });
      const mine = await api().post(`${S}/absences`).set(as("manager")).send({ type: "OTHER", from: "2027-07-01", to: "2027-07-01" });
      expect(mine.status).toBe(201);
      expect((await api().post(`${S}/absences/${mine.body.id}/decision`).set(as("manager")).send({ decision: "APPROVED" })).status).toBe(403);
      expect((await api().post(`${S}/absences/${mine.body.id}/decision`).set(as("admin")).send({ decision: "REJECTED", note: "Non" })).body.status).toBe("REJECTED");
      const w = await api().post(`${S}/absences`).set(as("waiter2")).send({ type: "UNPAID", from: "2027-08-01", to: "2027-08-02" });
      expect((await api().delete(`${S}/absences/${w.body.id}`).set(as("waiter"))).status).toBe(404); // pas la sienne
      expect((await api().delete(`${S}/absences/${w.body.id}`).set(as("waiter2"))).status).toBe(200);
    });
  });

  describe("performances", () => {
    it("cohérentes avec les commandes et paiements (et le tableau de bord)", async () => {
      const cat = (await api().post(`${V}/tenant/menu/categories`).set(as("manager")).send({ name: "Plats" })).body.id;
      const item = (await api().post(`${V}/tenant/menu/items`).set(as("manager")).send({ categoryId: cat, name: "Riz", price: 3000, vatRate: 18 })).body.id;
      expect((await api().post(`${V}/tenant/register/open`).set(as("manager")).send({ opening: 0 })).status).toBe(201);
      const order = async (who: string, qty: number, tip = 0) => {
        const o = await api().post(`${V}/tenant/orders`).set(as(who)).send({ type: "TAKEAWAY", customerName: "Kodjo", items: [{ menuItemId: item, quantity: qty, optionIds: [] }] });
        expect(o.status).toBe(201);
        const p = await api().post(`${V}/tenant/orders/${o.body.id}/payments`).set(as(who)).send({ method: "CARD", amount: o.body.total, tip });
        expect(p.status).toBe(201);
        return o.body;
      };
      await order("waiter", 1, 200);
      const o2 = await order("waiter", 2, 300);
      await order("waiter2", 1);
      const cancelled = await api().post(`${V}/tenant/orders`).set(as("waiter2")).send({ type: "TAKEAWAY", customerName: "X", items: [{ menuItemId: item, quantity: 1, optionIds: [] }] });
      await api().post(`${V}/tenant/orders/${cancelled.body.id}/cancel`).set(as("manager")).send({ reason: "Client parti" });
      const day = new Date().toISOString().slice(0, 10);
      const res = await api().get(`${S}/performance?from=${day}&to=${day}`).set(as("manager"));
      expect(res.status).toBe(200);
      const byName = Object.fromEntries(res.body.rows.map((r: { name: string }) => [r.name, r]));
      expect(byName["waiter Test"]).toMatchObject({ rank: 1, orders: 2, revenue: o2.total + 3000, tips: 500, cancellations: 0, averageTicket: Math.round((3000 + o2.total) / 2) });
      expect(byName["waiter2 Test"]).toMatchObject({ rank: 2, orders: 1, revenue: 3000, tips: 0, cancellations: 1 });
      const dash = await api().get(`${V}/tenant/dashboard?date=${day}`).set(as("manager"));
      expect(res.body.totals).toMatchObject({ orders: dash.body.ordersCount, revenue: dash.body.revenue, tips: dash.body.tips, averageTicket: dash.body.averageTicket });
      expect((await api().get(`${S}/performance?from=${day}&to=${day}`).set(as("other"))).body.totals.orders).toBe(0);
      expect((await api().get(`${S}/performance?from=2027-01-10&to=2027-01-01`).set(as("manager"))).status).toBe(400);
    });
  });

  describe("paie", () => {
    it("heures normales / supplémentaires sur une semaine à cheval, brut estimé et export CSV", async () => {
      // semaine du 2027-04-05 (lundi) : 5 × 8 h + dimanche 22:00 → lundi suivant 06:00 (2 h cette semaine + 6 h la suivante)
      const add = (a: string, b: string, brk = 0) =>
        api().post(`${S}/attendance`).set(as("manager")).send({ staffId: ids.staff_waiter2, clockIn: at(a), clockOut: at(b), breakMinutes: brk, note: "Saisie du registre papier" });
      for (const n of ["05", "06", "07", "08", "09"]) expect((await add(`2027-04-${n}T08:00:00Z`, `2027-04-${n}T16:30:00Z`, 30)).status).toBe(201);
      expect((await add("2027-04-11T22:00:00Z", "2027-04-12T06:00:00Z")).status).toBe(201);
      expect((await add("2027-04-09T12:00:00Z", "2027-04-09T13:00:00Z")).status).toBe(409); // chevauche
      const res = await api().get(`${S}/payroll?from=2027-04-05&to=2027-04-18`).set(as("admin"));
      expect(res.status).toBe(200);
      const row = res.body.rows.find((r: { name: string }) => r.name === "waiter2 Test");
      expect(row).toMatchObject({ normalMinutes: 40 * 60 + 6 * 60, overtimeMinutes: 2 * 60, hourlyRate: 1500, gross: 46 * 1500 + 2 * 1500 * 1.25 });
      expect(res.body.thresholdHours).toBe(40);
      // période d'une seule semaine : le surplus du dimanche soir reste en heures sup. de la semaine du 5
      const week2 = await api().get(`${S}/payroll?from=2027-04-12&to=2027-04-18`).set(as("admin"));
      expect(week2.body.rows.find((r: { name: string }) => r.name === "waiter2 Test")).toMatchObject({ normalMinutes: 6 * 60, overtimeMinutes: 0 });
      const csv = await api().get(`${S}/payroll/export?from=2027-04-05&to=2027-04-18`).set(as("admin"));
      expect(csv.status).toBe(200);
      expect(csv.headers["content-type"]).toContain("text/csv");
      expect(csv.text.charCodeAt(0)).toBe(0xfeff);
      expect(csv.text).toContain("waiter2 Test;Serveur;46,00;2,00;48,00;1500;1,25;72750");
      expect((await api().get(`${S}/payroll/export?from=2027-04-05&to=2027-04-18`).set(as("manager"))).status).toBe(403);
    });

    it("le seuil hebdomadaire est réglable", async () => {
      expect((await api().patch(`${V}/tenant/settings/staff`).set(as("manager")).send({ overtimeThresholdHours: 35 })).status).toBe(403);
      expect((await api().patch(`${V}/tenant/settings/staff`).set(as("admin")).send({ overtimeThresholdHours: 35 })).status).toBe(200);
      const res = await api().get(`${S}/payroll?from=2027-04-05&to=2027-04-11`).set(as("admin"));
      expect(res.body.rows.find((r: { name: string }) => r.name === "waiter2 Test")).toMatchObject({ normalMinutes: 35 * 60, overtimeMinutes: 7 * 60 });
      expect((await api().get(`${V}/tenant/settings/staff`).set(as("waiter"))).status).toBe(403);
      await api().patch(`${V}/tenant/settings/staff`).set(as("admin")).send({ overtimeThresholdHours: 40 });
    });
  });

  describe("messagerie", () => {
    const channelsOf = async (who: string) => (await api().get(`${M}/channels`).set(as(who))).body as { id: string; kind: string; name: string; unread: number; unreadMentions: number; members: { id: string }[] }[];
    const kind = (list: { kind: string; id: string }[], k: string) => list.find((c) => c.kind === k)!;

    it("chacun ne voit que ses canaux (selon le rôle) ; un canal étranger est introuvable", async () => {
      expect((await channelsOf("waiter")).map((c) => c.name)).toEqual(["Tous", "Salle"]);
      expect((await channelsOf("kitchen")).map((c) => c.name)).toEqual(["Tous", "Cuisine"]);
      expect((await channelsOf("manager")).map((c) => c.name)).toEqual(["Tous", "Salle", "Cuisine"]);
      ids.chAll = kind(await channelsOf("waiter"), "ALL").id;
      ids.chFloor = kind(await channelsOf("waiter"), "FLOOR").id;
      ids.chKitchen = kind(await channelsOf("kitchen"), "KITCHEN").id;
      expect((await api().get(`${M}/channels/${ids.chKitchen}/messages`).set(as("waiter"))).status).toBe(404);
      expect((await api().post(`${M}/channels/${ids.chKitchen}/messages`).set(as("waiter")).send({ body: "intrus" })).status).toBe(404);
      expect((await api().post(`${M}/channels/${ids.chKitchen}/read`).set(as("waiter")).send()).status).toBe(404);
      expect((await api().get(`${M}/channels/${ids.chAll}/messages`).set(as("other"))).status).toBe(404);
      expect((await channelsOf("other")).map((c) => c.id)).not.toContain(ids.chAll);
      expect((await api().get(`${M}/channels`).set({})).status).toBe(401);
      // deux restaurants, canaux distincts
      expect(new Set([...(await channelsOf("other")).map((c) => c.id), ...(await channelsOf("admin")).map((c) => c.id)]).size).toBe(6);
    });

    it("message en direct : seuls les membres du canal reçoivent `message.created`", async () => {
      const sw = await connect(tok.waiter), sk = await connect(tok.kitchen), sm = await connect(tok.manager), so = await connect(tok.other);
      const leaked: unknown[] = [];
      sk.on("message.created", (m) => leaked.push(m));
      so.on("message.created", (m) => leaked.push(m));
      const gotMgr = next(sm, "message.created"), gotWaiter = next(sw, "message.created");
      const send = await api().post(`${M}/channels/${ids.chFloor}/messages`).set(as("waiter")).send({ body: "  Table 4 prête @manager Test  ", mentions: [ids.manager, ids.kitchen, ids.waiter] });
      expect(send.status).toBe(201);
      expect(send.body).toMatchObject({ body: "Table 4 prête @manager Test", senderName: "waiter Test", mentions: [ids.manager] }); // seuls les membres cités, jamais soi-même
      // l'envoi inscrit tout le personnel concerné, même celui qui n'a pas encore ouvert la messagerie (waiter2)
      const members = (await channelsOf("manager")).find((c) => c.id === ids.chFloor)!.members;
      expect(members.map((m) => m.id)).toEqual(expect.arrayContaining([ids.manager, ids.waiter, ids.waiter2]));
      expect(members.map((m) => m.id)).not.toContain(ids.kitchen);
      expect(await gotMgr).toMatchObject({ id: send.body.id, channelId: ids.chFloor });
      expect(await gotWaiter).toMatchObject({ id: send.body.id });
      await new Promise((r) => setTimeout(r, 150));
      expect(leaked).toEqual([]);
      expect((await api().post(`${M}/channels/${ids.chFloor}/messages`).set(as("waiter")).send({ body: "   " })).status).toBe(400);
      expect((await api().post(`${M}/channels/${ids.chFloor}/messages`).set(as("waiter")).send({ body: "x".repeat(2001) })).status).toBe(400);
    });

    it("non-lus, mentions et lecture", async () => {
      const mgr = (await channelsOf("manager")).find((c) => c.id === ids.chFloor)!;
      expect([mgr.unread, mgr.unreadMentions]).toEqual([1, 1]);
      const w2 = (await channelsOf("waiter2")).find((c) => c.id === ids.chFloor)!;
      expect([w2.unread, w2.unreadMentions]).toEqual([1, 0]);
      expect((await channelsOf("waiter")).find((c) => c.id === ids.chFloor)!.unread).toBe(0); // l'auteur a tout lu
      expect((await api().get(`${M}/unread`).set(as("manager"))).body).toEqual({ unread: 1, mentions: 1 });
      expect((await api().post(`${M}/channels/${ids.chFloor}/read`).set(as("manager")).send()).status).toBe(200);
      expect((await api().get(`${M}/unread`).set(as("manager"))).body).toEqual({ unread: 0, mentions: 0 });
      const list = await api().get(`${M}/channels/${ids.chFloor}/messages`).set(as("manager"));
      expect(list.body).toMatchObject({ hasMore: false, messages: [{ body: "Table 4 prête @manager Test" }] });
    });

    it("messages directs : privés, sans doublon, jamais entre restaurants", async () => {
      expect((await api().post(`${M}/direct`).set(as("waiter")).send({ userId: ids.waiter })).status).toBe(400);
      expect((await api().post(`${M}/direct`).set(as("waiter")).send({ userId: "00000000-0000-4000-8000-000000000000" })).status).toBe(404);
      const other = await asPlatform(prisma, (tx) => tx.user.findFirstOrThrow({ where: { email: "admin@voisin.tg" } }));
      expect((await api().post(`${M}/direct`).set(as("waiter")).send({ userId: other.id })).status).toBe(404);
      const [a, b] = await Promise.all([1, 2].map(() => api().post(`${M}/direct`).set(as("waiter")).send({ userId: ids.kitchen })));
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(a.body.id).toBe(b.body.id);
      expect(a.body).toMatchObject({ kind: "DIRECT", name: "kitchen Test" });
      expect((await channelsOf("kitchen")).filter((c) => c.kind === "DIRECT")).toEqual([]); // vide : pas encore visible chez l'autre
      const sk = await connect(tok.kitchen);
      const got = next(sk, "message.created");
      expect((await api().post(`${M}/channels/${a.body.id}/messages`).set(as("waiter")).send({ body: "Tu peux sortir les entrées ?" })).status).toBe(201);
      expect((await got).channelId).toBe(a.body.id);
      const dm = (await channelsOf("kitchen")).find((c) => c.kind === "DIRECT")!;
      expect([dm.name, dm.unread]).toEqual(["waiter Test", 1]);
      expect((await api().get(`${M}/channels/${a.body.id}/messages`).set(as("manager"))).status).toBe(404); // même un responsable
      expect((await api().get(`${M}/channels/${a.body.id}/messages`).set(as("other"))).status).toBe(404);
      const reply = await api().post(`${M}/direct`).set(as("kitchen")).send({ userId: ids.waiter });
      expect(reply.body.id).toBe(a.body.id);
    });

    it("pagination de l'historique", async () => {
      for (let i = 1; i <= 5; i++) await api().post(`${M}/channels/${ids.chAll}/messages`).set(as("admin")).send({ body: `Annonce ${i}` });
      const page = await api().get(`${M}/channels/${ids.chAll}/messages?limit=3`).set(as("waiter"));
      expect(page.body.messages.map((m: { body: string }) => m.body)).toEqual(["Annonce 3", "Annonce 4", "Annonce 5"]);
      expect(page.body.hasMore).toBe(true);
      const older = await api().get(`${M}/channels/${ids.chAll}/messages?limit=3&before=${encodeURIComponent(page.body.messages[0].createdAt)}`).set(as("waiter"));
      expect(older.body.messages.map((m: { body: string }) => m.body)).toEqual(["Annonce 1", "Annonce 2"]);
      expect(older.body.hasMore).toBe(false);
    });

    it("un changement de rôle met à jour les canaux", async () => {
      await asPlatform(prisma, (tx) => tx.user.update({ where: { id: ids.kitchen }, data: { role: "WAITER" } }));
      expect((await channelsOf("kitchen")).filter((c) => !c.kind.startsWith("DIRECT")).map((c) => c.name)).toEqual(["Tous", "Salle"]);
      await asPlatform(prisma, (tx) => tx.user.update({ where: { id: ids.kitchen }, data: { role: "KITCHEN" } }));
    });
  });
});
