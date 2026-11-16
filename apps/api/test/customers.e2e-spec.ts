import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { addDays, reminderInstant, zonedDay } from "@restaurant/utils";
import { createHash } from "node:crypto";
import request from "supertest";
import { ReservationsTasks } from "../src/reservations/reservations.tasks";
import { NotificationsService } from "../src/notifications/notifications.service";
import { buildApiDocument } from "../src/setup";
import { asPlatform, createApp, login, resetDb, seedPlatform } from "./helpers";

const PW = "Cigale-Bleue74";
const CPW = "Mangue-Verte-58";
const ZERO = "00000000-0000-0000-0000-000000000000";

describe("P2C Espace client : comptes, réservations rattachées, suivi de commande, avis, RGPD (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let notif: NotificationsService;
  let root: string;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const V = "/api/v1";
  const api = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  const D = addDays(zonedDay(new Date(), "Africa/Lome"), 3);
  const at = (hhmm: string, day = D) => `${day}T${hhmm}:00.000Z`;
  const sha = (v: string) => createHash("sha256").update(v).digest("hex");

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
  const addStaff = async (slug: string, who: string, role: string) => {
    const res = await api().post(`${V}/tenant/staff`).set(as("admin")).send({ email: `${who}@${slug}.tg`, firstName: who, lastName: "Test", role });
    expect(res.status).toBe(201);
    const l = await api().post(`${V}/tenant/auth/login`).send({ tenantSlug: slug, email: `${who}@${slug}.tg`, password: res.body.temporaryPassword });
    await asPlatform(prisma, (tx) => tx.user.updateMany({ where: { email: `${who}@${slug}.tg` }, data: { mustChangePassword: false } }));
    return l.body.accessToken as string;
  };
  const signup = (slug: string, email: string, extra: Record<string, unknown> = {}) =>
    api().post(`${V}/public/tenants/${slug}/customers`).send({ firstName: "Awa", lastName: "Mensah", email, password: CPW, consent: true, ...extra });
  const lastCode = (to: string) => {
    const m = [...notif.outbox].reverse().find((x) => x.to === to && /vérification/i.test(x.subject));
    return m?.text.match(/\b(\d{6})\b/)?.[1];
  };
  /** Inscrit, vérifie l'email et renvoie le jeton d'accès. */
  const newCustomer = async (who: string, slug = "baobab", extra: Record<string, unknown> = {}) => {
    const email = `${who}@client.tg`;
    expect((await signup(slug, email, { firstName: who, ...extra })).status).toBe(201);
    tok[who] = await tenantLogin(slug, email, CPW);
    expect(tok[who]).toBeTruthy();
    return email;
  };
  const verify = async (who: string) => {
    const code = lastCode(`${who}@client.tg`)!;
    return api().post(`${V}/tenant/customer/verify-email`).set(as(who)).send({ code });
  };
  const reserveOnline = (email: string | undefined, startsAt = at("19:00"), partySize = 2) =>
    api().post(`${V}/public/tenants/baobab/reservations`).send({ guestName: "Awa Mensah", guestPhone: "90 11 22 33", ...(email ? { guestEmail: email } : {}), partySize, startsAt });

  /** Commande à emporter servie et payée (donc clôturée). */
  const closedOrder = async (extra: Record<string, unknown> = {}) => {
    const o = await api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "TAKEAWAY", items: [{ menuItemId: ids.bissap, quantity: 2 }], ...extra });
    expect(o.status).toBe(201);
    for (const [who, status] of [["kitchen", "IN_PROGRESS"], ["kitchen", "READY"], ["waiter", "SERVED"]]) await api().post(`${V}/tenant/orders/${o.body.id}/advance`).set(as(who)).send({ status }).expect(200);
    await api().post(`${V}/tenant/orders/${o.body.id}/payments`).set(as("waiter")).send({ method: "CASH", amount: o.body.total, tendered: o.body.total }).expect(201);
    const link = await api().get(`${V}/tenant/orders/${o.body.id}/tracking-link`).set(as("waiter")).expect(200);
    return { id: o.body.id as string, number: o.body.number as number, token: link.body.token as string };
  };

  beforeAll(async () => {
    prisma = new PrismaClient();
    await resetDb(prisma);
    const seed = await seedPlatform(prisma);
    app = await createApp();
    notif = app.get(NotificationsService);
    root = (await login(app, "root@test.local")).body.accessToken;
    ids.tenant = await makeTenant("baobab", seed.pro.id);
    ids.other = await makeTenant("voisin", seed.pro.id);
    tok.admin = await tenantLogin("baobab", "admin@baobab.tg");
    tok.manager = await addStaff("baobab", "manager", "MANAGER");
    tok.waiter = await addStaff("baobab", "waiter", "WAITER");
    tok.kitchen = await addStaff("baobab", "kitchen", "KITCHEN");
    tok.otherAdmin = await tenantLogin("voisin", "admin@voisin.tg");
    const week = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "11:00", closesAt: "23:00", slotMinutes: 30 }));
    await api().put(`${V}/tenant/opening-hours`).set(as("manager")).send({ ranges: week }).expect(200);
    for (const [label, capacity] of [["T2", 2], ["T4", 4], ["T6", 6]] as const) await api().post(`${V}/tenant/tables`).set(as("admin")).send({ label, capacity }).expect(201);
    await api().patch(`${V}/tenant/settings/reservations`).set(as("admin")).send({ requireConfirmation: false }).expect(200);
    const cat = await api().post(`${V}/tenant/menu/categories`).set(as("manager")).send({ name: "Boissons" });
    const item = await api().post(`${V}/tenant/menu/items`).set(as("manager")).send({ categoryId: cat.body.id, name: "Bissap", price: 500, vatRate: 10 });
    ids.bissap = item.body.id;
    await api().patch(`${V}/tenant/settings/notifications`).set(as("admin")).send({ channels: { sms: true } }).expect(200);   // désactivé par défaut
    await api().post(`${V}/tenant/register/open`).set(as("manager")).send({ opening: 10000 }).expect(201);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe("inscription et connexion", () => {
    it("valide le corps (consentement, mot de passe selon la politique) en français", async () => {
      const noConsent = await signup("baobab", "x@client.tg", { consent: false });
      expect(noConsent.status).toBe(400);
      expect(noConsent.body.errors.some((e: { path: string; message: string }) => e.path === "consent" && /données/.test(e.message))).toBe(true);
      const weak = await signup("baobab", "x@client.tg", { password: "abcdefgh" });
      expect(weak.status).toBe(400);
      expect((await signup("baobab", "pas-un-email")).status).toBe(400);
      expect((await signup("baobab", "x@client.tg", { phone: "abc" })).status).toBe(400);
      expect((await signup("inconnu", "x@client.tg")).status).toBe(404);
    });

    it("crée un compte CUSTOMER, envoie le code par email, refuse un doublon (même restaurant seulement)", async () => {
      notif.outbox.length = 0;
      const res = await signup("baobab", "awa@client.tg", { phone: "90 11 22 33" });
      expect(res.status).toBe(201);
      expect(res.body.passwordHash).toBeUndefined();
      expect(lastCode("awa@client.tg")).toMatch(/^\d{6}$/);
      const dup = await signup("baobab", "AWA@client.tg");
      expect(dup.status).toBe(409);
      expect((await signup("voisin", "awa@client.tg")).status).toBe(201);
      const row = await asPlatform(prisma, (tx) => tx.user.findFirstOrThrow({ where: { tenantId: ids.tenant, email: "awa@client.tg" } }));
      expect(row.role).toBe("CUSTOMER");
      expect(row.consentAt).toBeTruthy();
      expect(row.passwordHash).not.toContain(CPW);
      expect(row.emailVerifiedAt).toBeNull();
      expect(row.phone).toBe("+22890112233");
    });

    it("se connecte par /tenant/auth/login, profil et préférences", async () => {
      tok.awa = await tenantLogin("baobab", "awa@client.tg", CPW);
      const me = await api().get(`${V}/tenant/account/me`).set(as("awa")).expect(200);
      expect(me.body.role).toBe("CUSTOMER");
      const p = await api().get(`${V}/tenant/customer/profile`).set(as("awa")).expect(200);
      expect(p.body).toMatchObject({ email: "awa@client.tg", emailVerified: false, notificationPrefs: { reservationReminders: true, orderReadySms: true } });
      const up = await api().patch(`${V}/tenant/customer/profile`).set(as("awa")).send({ firstName: "Awa", phone: "91 00 00 01" }).expect(200);
      expect(up.body.phone).toBe("+22891000001");
      expect((await api().patch(`${V}/tenant/customer/profile`).set(as("awa")).send({})).status).toBe(400);
      const prefs = await api().put(`${V}/tenant/customer/notification-prefs`).set(as("awa")).send({ reservationReminders: false, orderReadySms: true }).expect(200);
      expect(prefs.body.notificationPrefs.reservationReminders).toBe(false);
      await api().put(`${V}/tenant/customer/notification-prefs`).set(as("awa")).send({ reservationReminders: true, orderReadySms: true }).expect(200);
    });

    it("vérifie l'email : mauvais code refusé, bon code accepté, tentatives limitées", async () => {
      const bad = await api().post(`${V}/tenant/customer/verify-email`).set(as("awa")).send({ code: "000000" });
      expect(bad.status).toBe(400);
      expect((await api().post(`${V}/tenant/customer/verify-email`).set(as("awa")).send({ code: "12" })).status).toBe(400);
      // une fois 5 mauvais codes essayés, même le bon code est refusé
      for (let i = 0; i < 5; i++) await api().post(`${V}/tenant/customer/verify-email`).set(as("awa")).send({ code: "000000" });
      expect((await verify("awa")).status).toBe(400);
      notif.outbox.length = 0;
      await api().post(`${V}/tenant/customer/verify-email/send`).set(as("awa")).expect(200);
      expect(lastCode("awa@client.tg")).toBeTruthy();
      // les codes ne sont jamais conservés en clair (journal de notification sans variables)
      const logs = await asPlatform(prisma, (tx) => tx.notificationLog.findMany({ where: { template: "customer.verify-email" } }));
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.every((l) => l.data === null)).toBe(true);
    });
  });

  describe("sécurité : un client n'a accès à rien du personnel", () => {
    it("toutes les routes /tenant/* du personnel répondent 403 à un jeton client (aucune route sans @TenantRoles)", async () => {
      const doc = buildApiDocument(app);
      const allowed = (path: string) => /^\/api\/v1\/tenant\/(auth|account|customer)(\/|$)/.test(path);
      const calls: { method: string; path: string }[] = [];
      for (const [path, ops] of Object.entries(doc.paths as Record<string, Record<string, unknown>>)) {
        if (!path.startsWith("/api/v1/tenant/") || allowed(path)) continue;
        for (const method of Object.keys(ops)) if (["get", "post", "put", "patch", "delete"].includes(method)) calls.push({ method, path: path.replace(/\{[^}]+\}/g, ZERO) });
      }
      expect(calls.length).toBeGreaterThan(100);
      const leaks: string[] = [];
      for (const c of calls) {
        const res = await (api() as any)[c.method](c.path).set(as("awa")).send(c.method === "get" || c.method === "delete" ? undefined : {});
        if (res.status !== 403) leaks.push(`${c.method.toUpperCase()} ${c.path} → ${res.status}`);
      }
      expect(leaks).toEqual([]);
    });

    it("le personnel n'accède pas aux routes client ; sans jeton 401 ; jeton d'un autre restaurant refusé", async () => {
      for (const who of ["admin", "manager", "waiter", "kitchen"]) {
        expect((await api().get(`${V}/tenant/customer/profile`).set(as(who))).status).toBe(403);
        expect((await api().get(`${V}/tenant/customer/reservations`).set(as(who))).status).toBe(403);
        expect((await api().get(`${V}/tenant/customer/export`).set(as(who))).status).toBe(403);
      }
      expect((await api().get(`${V}/tenant/customer/profile`)).status).toBe(401);
      tok.voisinAwa = await tenantLogin("voisin", "awa@client.tg", CPW);
      // même email, autre restaurant : un compte distinct, sans les données de baobab
      const p = await api().get(`${V}/tenant/customer/profile`).set(as("voisinAwa")).expect(200);
      expect(p.body.id).not.toBe((await api().get(`${V}/tenant/customer/profile`).set(as("awa"))).body.id);
      expect((await api().get(`${V}/tenant/customer/reservations`).set(as("voisinAwa"))).body).toEqual([]);
    });

    it("le client ne peut pas non plus utiliser les routes plateforme", async () => {
      expect((await api().get(`${V}/platform/tenants`).set(as("awa"))).status).toBe(401);
    });
  });

  describe("réservations rattachées au compte", () => {
    it("une réservation faite avant la vérification est rattachée quand l'email est vérifié", async () => {
      const before = await reserveOnline("awa@client.tg", at("19:00"));
      expect(before.status).toBe(201);
      ids.resa1 = (await asPlatform(prisma, (tx) => tx.reservation.findFirstOrThrow({ where: { code: before.body.code, tenantId: ids.tenant } }))).id;
      // sans email vérifié : pas de rattachement
      expect((await api().get(`${V}/tenant/customer/reservations`).set(as("awa"))).body).toEqual([]);
      const stranger = await reserveOnline("autre@client.tg", at("20:00"), 2);
      expect(stranger.status).toBe(201);
      const ok = await verify("awa");
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ verified: true, reservationsLinked: 1 });
      const list = await api().get(`${V}/tenant/customer/reservations`).set(as("awa")).expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({ id: ids.resa1, code: before.body.code, status: "CONFIRMED", partySize: 2, canModify: true, canCancel: true });
      expect(list.body[0].notes).toBeUndefined();
      expect(list.body[0].tables).toBeUndefined();
      expect((await api().get(`${V}/tenant/customer/profile`).set(as("awa"))).body.emailVerified).toBe(true);
    });

    it("une réservation faite ensuite avec l'email vérifié est rattachée d'office", async () => {
      const r = await reserveOnline("awa@client.tg", at("21:00"), 4);
      expect(r.status).toBe(201);
      const list = await api().get(`${V}/tenant/customer/reservations`).set(as("awa")).expect(200);
      expect(list.body).toHaveLength(2);
      ids.resa2 = list.body.find((x: { code: string }) => x.code === r.body.code).id;
    });

    it("modifier et annuler depuis le compte, avec les mêmes règles que le lien de gestion", async () => {
      const slots = await api().get(`${V}/tenant/customer/reservations/${ids.resa1}/availability`).query({ date: D, partySize: 3 }).set(as("awa")).expect(200);
      expect(slots.body.slots.length).toBeGreaterThan(0);
      const mod = await api().patch(`${V}/tenant/customer/reservations/${ids.resa1}`).set(as("awa")).send({ partySize: 3, startsAt: at("19:30"), specialRequests: "Chaise bébé" }).expect(200);
      expect(mod.body).toMatchObject({ id: ids.resa1, partySize: 3, specialRequests: "Chaise bébé", status: "CONFIRMED" });
      expect((await api().patch(`${V}/tenant/customer/reservations/${ids.resa1}`).set(as("awa")).send({})).status).toBe(400);
      const cancel = await api().post(`${V}/tenant/customer/reservations/${ids.resa2}/cancel`).set(as("awa")).expect(200);
      expect(cancel.body.status).toBe("CANCELLED");
      expect((await api().post(`${V}/tenant/customer/reservations/${ids.resa2}/cancel`).set(as("awa"))).status).toBe(409);
      // le personnel voit les changements
      const staff = await api().get(`${V}/tenant/reservations/${ids.resa1}`).set(as("waiter")).expect(200);
      expect(staff.body).toMatchObject({ partySize: 3, status: "CONFIRMED" });
    });

    it("un autre client (même restaurant) ne voit ni ne touche la réservation : 404", async () => {
      await newCustomer("kofi");
      for (const [m, p, b] of [["patch", `reservations/${ids.resa1}`, { partySize: 2 }], ["post", `reservations/${ids.resa1}/cancel`, {}]] as const) {
        expect((await (api() as any)[m](`${V}/tenant/customer/${p}`).set(as("kofi")).send(b)).status).toBe(404);
      }
      expect((await api().get(`${V}/tenant/customer/reservations/${ids.resa1}/availability`).query({ date: D, partySize: 2 }).set(as("kofi"))).status).toBe(404);
      expect((await api().get(`${V}/tenant/customer/reservations`).set(as("kofi"))).body).toEqual([]);
    });
  });

  describe("préférences de notification", () => {
    it("le rappel de la veille n'est pas envoyé au client qui l'a désactivé (et l'est sinon)", async () => {
      const tasks = app.get(ReservationsTasks);
      const startsAt = at("19:00", addDays(D, 1));
      await api().post(`${V}/tenant/customer/verify-email/send`).set(as("kofi")).expect(200);
      expect((await verify("kofi")).status).toBe(200);
      const mine = await reserveOnline("kofi@client.tg", startsAt, 2);
      const other = await reserveOnline("temoin@client.tg", startsAt, 2);
      expect([mine.status, other.status]).toEqual([201, 201]);
      expect((await api().get(`${V}/tenant/customer/reservations`).set(as("kofi"))).body).toHaveLength(1);
      await api().put(`${V}/tenant/customer/notification-prefs`).set(as("kofi")).send({ reservationReminders: false, orderReadySms: true }).expect(200);
      notif.outbox.length = 0;
      const now = new Date(reminderInstant(new Date(startsAt), "Africa/Lome", 18)!.getTime() + 60_000);
      await tasks.sendReminders(now);
      await notif.flush();
      expect(notif.outbox.some((m) => m.to === "temoin@client.tg" && /rappel/i.test(m.subject))).toBe(true);
      expect(notif.outbox.some((m) => m.to === "kofi@client.tg" && /rappel/i.test(m.subject))).toBe(false);
      await api().put(`${V}/tenant/customer/notification-prefs`).set(as("kofi")).send({ reservationReminders: true, orderReadySms: true }).expect(200);
    });
  });

  describe("suivi de commande par le lien du ticket", () => {
    it("le lien est créé par la salle (stable), stocké haché, indevinable", async () => {
      const o = await api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "TAKEAWAY", customerName: "Awa", customerPhone: "90 55 44 33", items: [{ menuItemId: ids.bissap, quantity: 1 }] }).expect(201);
      ids.track1 = o.body.id;
      expect((await api().get(`${V}/tenant/orders/${ids.track1}/tracking-link`).set(as("kitchen"))).status).toBe(403);
      expect((await api().get(`${V}/tenant/orders/${ids.track1}/tracking-link`).set(as("awa"))).status).toBe(403);
      expect((await api().get(`${V}/tenant/orders/${ZERO}/tracking-link`).set(as("waiter"))).status).toBe(404);
      expect((await api().get(`${V}/tenant/orders/${ids.track1}/tracking-link`).set(as("otherAdmin"))).status).toBe(404);
      const a = await api().get(`${V}/tenant/orders/${ids.track1}/tracking-link`).set(as("waiter")).expect(200);
      const b = await api().get(`${V}/tenant/orders/${ids.track1}/tracking-link`).set(as("manager")).expect(200);
      expect(a.body.token).toBe(b.body.token);
      expect(a.body.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect(a.body.url).toMatch(new RegExp(`/r/baobab/suivi/${a.body.token}$`));
      ids.tt1 = a.body.token;
      const row = await asPlatform(prisma, (tx) => tx.order.findUniqueOrThrow({ where: { id: ids.track1 } }));
      expect(row.trackTokenHash).toBe(sha(ids.tt1));
      expect(row.trackTokenHash).not.toContain(ids.tt1);
    });

    it("statut en direct sans compte : reçue → en préparation → prête ; SMS une seule fois", async () => {
      const get = () => api().get(`${V}/public/tracking/${ids.tt1}`);
      const v1 = await get().expect(200);
      expect(v1.body).toMatchObject({ number: expect.any(Number), stage: "received", canReview: false, items: [{ name: "Bissap", quantity: 1 }], restaurant: { name: "baobab", slug: "baobab" } });
      expect(JSON.stringify(v1.body)).not.toMatch(/Awa|9055|customerPhone|total/);
      notif.smsOutbox.length = 0;
      await api().post(`${V}/tenant/orders/${ids.track1}/advance`).set(as("kitchen")).send({ status: "IN_PROGRESS" }).expect(200);
      expect((await get()).body.stage).toBe("preparing");
      expect(notif.smsOutbox).toHaveLength(0);
      await api().post(`${V}/tenant/orders/${ids.track1}/advance`).set(as("kitchen")).send({ status: "READY" }).expect(200);
      expect((await get()).body.stage).toBe("ready");
      await notif.flush();
      expect(notif.smsOutbox).toHaveLength(1);
      expect(notif.smsOutbox[0].to).toBe("+22890554433");
      expect(notif.smsOutbox[0].text).toMatch(/n°\d+.*prête/);
      expect(notif.smsOutbox[0].text).not.toMatch(/http/);
      await api().post(`${V}/tenant/orders/${ids.track1}/advance`).set(as("waiter")).send({ status: "SERVED" }).expect(200);
      await notif.flush();
      expect(notif.smsOutbox).toHaveLength(1);
    });

    it("jeton inconnu ou mal formé : 404 ; avis impossible avant la clôture : 409", async () => {
      expect((await api().get(`${V}/public/tracking/${"a".repeat(43)}`)).status).toBe(404);
      expect((await api().get(`${V}/public/tracking/court`)).status).toBe(404);
      expect((await api().get(`${V}/public/tracking/${ids.tt1}x`)).status).toBe(404);
      const early = await api().post(`${V}/public/tracking/${ids.tt1}/review`).send({ rating: 5 });
      expect(early.status).toBe(409);
      expect((await api().get(`${V}/public/tracking/${ids.tt1}`)).body.stage).toBe("done");
    });

    it("pas de SMS si le réglage du restaurant ou la préférence du client le refuse, ni sans téléphone", async () => {
      const ready = async (extra: Record<string, unknown>) => {
        const o = await api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "TAKEAWAY", items: [{ menuItemId: ids.bissap, quantity: 1 }], ...extra }).expect(201);
        await api().post(`${V}/tenant/orders/${o.body.id}/advance`).set(as("kitchen")).send({ status: "READY" }).expect(200);
        await notif.flush();
        return o.body.id as string;
      };
      notif.smsOutbox.length = 0;
      await ready({});
      expect(notif.smsOutbox).toHaveLength(0);
      await api().patch(`${V}/tenant/settings/notifications`).set(as("admin")).send({ channels: { sms: false } }).expect(200);
      await ready({ customerPhone: "90 12 12 12" });
      expect(notif.smsOutbox).toHaveLength(0);
      await api().patch(`${V}/tenant/settings/notifications`).set(as("admin")).send({ channels: { sms: true }, events: { orderReady: false } }).expect(200);
      await ready({ customerPhone: "90 12 12 12" });
      expect(notif.smsOutbox).toHaveLength(0);
      await api().patch(`${V}/tenant/settings/notifications`).set(as("admin")).send({ events: { orderReady: true } }).expect(200);
      await ready({ customerPhone: "90 12 12 12" });
      expect(notif.smsOutbox).toHaveLength(1);
      // un client connecté qui a désactivé le SMS « commande prête »
      const me = (await api().get(`${V}/tenant/customer/profile`).set(as("kofi"))).body.id as string;
      await api().put(`${V}/tenant/customer/notification-prefs`).set(as("kofi")).send({ reservationReminders: true, orderReadySms: false }).expect(200);
      await asPlatform(prisma, (tx) => tx.user.update({ where: { id: me }, data: { phone: "+22890777777" } }));
      notif.smsOutbox.length = 0;
      const o = await api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "TAKEAWAY", items: [{ menuItemId: ids.bissap, quantity: 1 }] }).expect(201);
      await asPlatform(prisma, (tx) => tx.order.update({ where: { id: o.body.id }, data: { customerId: me } }));
      await api().post(`${V}/tenant/orders/${o.body.id}/advance`).set(as("kitchen")).send({ status: "READY" }).expect(200);
      await notif.flush();
      expect(notif.smsOutbox).toHaveLength(0);
      await api().put(`${V}/tenant/customer/notification-prefs`).set(as("kofi")).send({ reservationReminders: true, orderReadySms: true }).expect(200);
    });

    it("le lien expire 24 h après la clôture (410)", async () => {
      const c = await closedOrder();
      expect((await api().get(`${V}/public/tracking/${c.token}`)).status).toBe(200);
      await asPlatform(prisma, (tx) => tx.order.update({ where: { id: c.id }, data: { closedAt: new Date(Date.now() - 23 * 3_600_000) } }));
      expect((await api().get(`${V}/public/tracking/${c.token}`)).status).toBe(200);
      await asPlatform(prisma, (tx) => tx.order.update({ where: { id: c.id }, data: { closedAt: new Date(Date.now() - 25 * 3_600_000) } }));
      const gone = await api().get(`${V}/public/tracking/${c.token}`);
      expect(gone.status).toBe(410);
      expect(gone.body.code).toBe("TRACKING_EXPIRED");
      expect((await api().post(`${V}/public/tracking/${c.token}/review`).send({ rating: 5 })).status).toBe(410);
    });
  });

  describe("avis : dépôt, unicité, modération, réponse, statistiques", () => {
    const rated: { id: string; token: string }[] = [];

    it("un avis par commande clôturée, par le lien du ticket", async () => {
      for (const rating of [5, 4, 2]) {
        const c = await closedOrder();
        const r = await api().post(`${V}/public/tracking/${c.token}/review`).send({ rating, comment: `Note ${rating}`, authorName: rating === 5 ? "Yao" : undefined });
        expect(r.status).toBe(201);
        expect(r.body).toMatchObject({ canReview: false, review: { rating, comment: `Note ${rating}`, reply: null } });
        expect((await api().post(`${V}/public/tracking/${c.token}/review`).send({ rating: 1 })).status).toBe(409);
        rated.push(c);
      }
      const bad = await api().post(`${V}/public/tracking/${rated[0].token}/review`).send({ rating: 6 });
      expect(bad.status).toBe(400);
      expect(bad.body.errors[0].path).toBe("rating");
      expect((await api().post(`${V}/public/tracking/${rated[0].token}/review`).send({ rating: 0 })).status).toBe(400);
      expect((await api().post(`${V}/public/tracking/${rated[0].token}/review`).send({ rating: 4.5 })).status).toBe(400);
    });

    it("deux avis simultanés sur la même commande : un seul est enregistré", async () => {
      const c = await closedOrder();
      const [a, b] = await Promise.all([1, 2].map((rating) => api().post(`${V}/public/tracking/${c.token}/review`).send({ rating })));
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const n = await asPlatform(prisma, (tx) => tx.feedback.count({ where: { orderId: c.id } }));
      expect(n).toBe(1);
      await asPlatform(prisma, (tx) => tx.feedback.deleteMany({ where: { orderId: c.id } }));
    });

    it("réservé aux responsables ; liste, filtres et statistiques justes", async () => {
      for (const who of ["waiter", "kitchen", "awa"]) {
        expect((await api().get(`${V}/tenant/reviews`).set(as(who))).status).toBe(403);
        expect((await api().get(`${V}/tenant/reviews/stats`).set(as(who))).status).toBe(403);
      }
      const list = await api().get(`${V}/tenant/reviews`).set(as("manager")).expect(200);
      expect(list.body.total).toBe(3);
      expect(list.body.items.map((i: { rating: number }) => i.rating)).toEqual([2, 4, 5]);
      expect(list.body.items[2]).toMatchObject({ author: "Yao", hasAccount: false, hidden: false, comment: "Note 5" });
      ids.f2 = list.body.items[0].id; ids.f4 = list.body.items[1].id; ids.f5 = list.body.items[2].id;
      expect((await api().get(`${V}/tenant/reviews`).query({ rating: 4 }).set(as("admin"))).body.items).toHaveLength(1);
      const stats = await api().get(`${V}/tenant/reviews/stats`).set(as("manager")).expect(200);
      expect(stats.body).toMatchObject({ count: 3, average: 3.7, distribution: { 1: 0, 2: 1, 3: 0, 4: 1, 5: 1 }, hiddenCount: 0, unanswered: 3 });
      expect(stats.body.visible).toMatchObject({ count: 3, average: 3.7 });
      expect((await api().get(`${V}/tenant/reviews`).query({ rating: 9 }).set(as("manager"))).status).toBe(400);
    });

    it("modération : masquer retire l'avis du public et des moyennes publiques, pas de celles du restaurant", async () => {
      await api().patch(`${V}/tenant/settings/operations`).set(as("admin")).send({ publicReviews: true }).expect(200);
      const before = await api().get(`${V}/public/tenants/baobab/reviews`).expect(200);
      expect(before.body).toMatchObject({ enabled: true, summary: { count: 3, average: 3.7 } });
      expect((await api().post(`${V}/tenant/reviews/${ids.f2}/hide`).set(as("waiter"))).status).toBe(403);
      const hide = await api().post(`${V}/tenant/reviews/${ids.f2}/hide`).set(as("manager")).expect(200);
      expect(hide.body).toMatchObject({ hidden: true, rating: 2 });
      const pub = await api().get(`${V}/public/tenants/baobab/reviews`).expect(200);
      expect(pub.body.items.map((i: { rating: number }) => i.rating)).toEqual([4, 5]);
      expect(pub.body.summary).toMatchObject({ count: 2, average: 4.5, distribution: { 2: 0, 4: 1, 5: 1 } });
      expect(pub.body.items[0].order).toBeUndefined();
      const stats = await api().get(`${V}/tenant/reviews/stats`).set(as("manager")).expect(200);
      expect(stats.body).toMatchObject({ count: 3, average: 3.7, hiddenCount: 1, visible: { count: 2, average: 4.5 } });
      expect((await api().get(`${V}/tenant/reviews`).query({ status: "hidden" }).set(as("manager"))).body.items).toHaveLength(1);
      // le client qui a laissé l'avis masqué ne voit pas de réponse publique
      const un = await api().post(`${V}/tenant/reviews/${ids.f2}/unhide`).set(as("manager")).expect(200);
      expect(un.body.hidden).toBe(false);
      expect((await api().get(`${V}/public/tenants/baobab/reviews`)).body.summary.count).toBe(3);
      await api().post(`${V}/tenant/reviews/${ids.f2}/hide`).set(as("manager")).expect(200);
    });

    it("réponse publique du restaurant : créer, modifier, supprimer ; visible sur la page de suivi et publiquement", async () => {
      expect((await api().put(`${V}/tenant/reviews/${ids.f4}/reply`).set(as("waiter")).send({ text: "Merci !" })).status).toBe(403);
      expect((await api().put(`${V}/tenant/reviews/${ids.f4}/reply`).set(as("manager")).send({ text: " " })).status).toBe(400);
      const r = await api().put(`${V}/tenant/reviews/${ids.f4}/reply`).set(as("manager")).send({ text: "Merci pour votre retour !" }).expect(200);
      expect(r.body).toMatchObject({ reply: "Merci pour votre retour !" });
      expect(r.body.repliedAt).toBeTruthy();
      const pub = (await api().get(`${V}/public/tenants/baobab/reviews`)).body.items.find((i: { rating: number }) => i.rating === 4);
      expect(pub.reply).toBe("Merci pour votre retour !");
      const track = await api().get(`${V}/public/tracking/${rated[1].token}`).expect(200);
      expect(track.body.review.reply).toBe("Merci pour votre retour !");
      expect((await api().get(`${V}/tenant/reviews/stats`).set(as("manager"))).body.unanswered).toBe(1);   // le 5 ; le 2 masqué n'est pas à traiter
      await api().put(`${V}/tenant/reviews/${ids.f4}/reply`).set(as("manager")).send({ text: "Au plaisir de vous revoir." }).expect(200);
      expect((await api().delete(`${V}/tenant/reviews/${ids.f4}/reply`).set(as("manager"))).body.reply).toBeNull();
      const audit = await asPlatform(prisma, (tx) => tx.auditLog.findMany({ where: { tenantId: ids.tenant, action: { startsWith: "review." } } }));
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["review.hide", "review.reply", "review.reply_delete", "review.unhide"]));
    });

    it("isolation : un autre restaurant ne voit rien et ne peut rien modérer", async () => {
      expect((await api().get(`${V}/tenant/reviews`).set(as("otherAdmin"))).body.total).toBe(0);
      expect((await api().get(`${V}/tenant/reviews/stats`).set(as("otherAdmin"))).body).toMatchObject({ count: 0, average: null });
      expect((await api().post(`${V}/tenant/reviews/${ids.f4}/hide`).set(as("otherAdmin"))).status).toBe(404);
      expect((await api().put(`${V}/tenant/reviews/${ids.f4}/reply`).set(as("otherAdmin")).send({ text: "Intrus" })).status).toBe(404);
      expect((await api().get(`${V}/public/tenants/voisin/reviews`)).body).toMatchObject({ enabled: false, items: [] });
    });

    it("affichage public facultatif : désactivé, rien ; activé, moyenne sur la carte publique", async () => {
      await api().patch(`${V}/tenant/settings/operations`).set(as("admin")).send({ publicReviews: false }).expect(200);
      const off = await api().get(`${V}/public/tenants/baobab/reviews`).expect(200);
      expect(off.body).toEqual({ enabled: false, summary: null, items: [], total: 0, page: 1, pageSize: 10 });
      expect((await api().get(`${V}/public/tenants/baobab/menu`)).body.reviews).toBeNull();
      await api().patch(`${V}/tenant/settings/operations`).set(as("admin")).send({ publicReviews: true }).expect(200);
      const menu = await api().get(`${V}/public/tenants/baobab/menu`).expect(200);
      expect(menu.body.reviews).toMatchObject({ count: 2, average: 4.5 });
      expect((await api().get(`${V}/public/tenants/inconnu/reviews`)).status).toBe(404);
    });

    it("depuis l'espace client : rattacher une commande par son lien, puis donner un avis (une fois)", async () => {
      const c = await closedOrder();
      expect((await api().get(`${V}/tenant/customer/orders`).set(as("awa"))).body).toEqual([]);
      expect((await api().post(`${V}/tenant/customer/orders/claim`).set(as("awa")).send({ token: "x" })).status).toBe(400);
      expect((await api().post(`${V}/tenant/customer/orders/claim`).set(as("awa")).send({ token: "b".repeat(43) })).status).toBe(404);
      await api().post(`${V}/tenant/customer/orders/claim`).set(as("awa")).send({ token: c.token }).expect(200);
      // déjà rattachée à Awa : un autre client ne peut pas la prendre
      expect((await api().post(`${V}/tenant/customer/orders/claim`).set(as("kofi")).send({ token: c.token })).status).toBe(409);
      const orders = await api().get(`${V}/tenant/customer/orders`).set(as("awa")).expect(200);
      expect(orders.body).toHaveLength(1);
      expect(orders.body[0]).toMatchObject({ id: c.id, canReview: true, review: null, items: [{ name: "Bissap", quantity: 2 }] });
      // l'avis d'un autre client sur cette commande : 404
      expect((await api().post(`${V}/tenant/customer/orders/${c.id}/review`).set(as("kofi")).send({ rating: 1 })).status).toBe(404);
      const r = await api().post(`${V}/tenant/customer/orders/${c.id}/review`).set(as("awa")).send({ rating: 5, comment: "Parfait" }).expect(201);
      expect(r.body).toMatchObject({ id: c.id, canReview: false, review: { rating: 5, comment: "Parfait" } });
      expect((await api().post(`${V}/tenant/customer/orders/${c.id}/review`).set(as("awa")).send({ rating: 3 })).status).toBe(409);
      // l'avis est rattaché au compte et affiché avec son prénom
      const mine = (await api().get(`${V}/tenant/reviews`).query({ rating: 5 }).set(as("manager"))).body.items.find((i: { comment: string }) => i.comment === "Parfait");
      expect(mine).toMatchObject({ author: "Awa", hasAccount: true });
      ids.awaOrder = c.id;
    });

    it("une commande non clôturée ne peut pas être notée depuis le compte", async () => {
      const o = await api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "TAKEAWAY", items: [{ menuItemId: ids.bissap, quantity: 1 }] }).expect(201);
      const link = await api().get(`${V}/tenant/orders/${o.body.id}/tracking-link`).set(as("waiter")).expect(200);
      await api().post(`${V}/tenant/customer/orders/claim`).set(as("awa")).send({ token: link.body.token }).expect(200);
      expect((await api().post(`${V}/tenant/customer/orders/${o.body.id}/review`).set(as("awa")).send({ rating: 4 })).status).toBe(409);
      await api().post(`${V}/tenant/orders/${o.body.id}/cancel`).set(as("manager")).send({ reason: "Test annulation" }).expect(200);
    });
  });

  describe("RGPD : export et suppression du compte", () => {
    it("exporte toutes les données du client en JSON", async () => {
      const res = await api().get(`${V}/tenant/customer/export`).set(as("awa")).expect(200);
      expect(res.body.profile).toMatchObject({ email: "awa@client.tg", firstName: "Awa" });
      expect(res.body.reservations.length).toBe(2);
      expect(res.body.orders.length).toBeGreaterThanOrEqual(1);
      expect(res.body.reviews).toEqual(expect.arrayContaining([expect.objectContaining({ rating: 5, comment: "Parfait" })]));
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2|Hash/);
      expect(JSON.stringify(res.body)).not.toContain("kofi@client.tg");
    });

    it("refuse la suppression sans le bon mot de passe", async () => {
      expect((await api().post(`${V}/tenant/customer/delete`).set(as("awa")).send({ password: "Mauvais-Mot2Passe" })).status).toBe(401);
      expect((await api().post(`${V}/tenant/customer/delete`).set(as("awa")).send({})).status).toBe(400);
    });

    it("supprime : réservations à venir annulées, historique et avis conservés mais anonymisés, connexion impossible", async () => {
      const upcoming = await reserveOnline("awa@client.tg", at("20:30"), 2);
      expect(upcoming.status).toBe(201);
      const del = await api().post(`${V}/tenant/customer/delete`).set(as("awa")).send({ password: CPW }).expect(200);
      expect(del.body).toEqual({ deleted: true });
      // plus de session, plus de connexion
      expect((await api().get(`${V}/tenant/customer/profile`).set(as("awa"))).status).toBe(401);
      expect((await api().post(`${V}/tenant/auth/login`).send({ tenantSlug: "baobab", email: "awa@client.tg", password: CPW })).status).toBe(401);
      await asPlatform(prisma, async (tx) => {
        const u = await tx.user.findFirstOrThrow({ where: { tenantId: ids.tenant, anonymizedAt: { not: null } } });
        expect(u).toMatchObject({ firstName: "Client", lastName: "supprimé", phone: null, isActive: false, consentAt: null });
        expect(u.email).toMatch(/@anonyme\.invalid$/);
        const resas = await tx.reservation.findMany({ where: { tenantId: ids.tenant, guestName: "Client supprimé" } });
        expect(resas.length).toBe(3);
        expect(resas.every((r) => r.guestEmail === null && r.guestPhone === null && r.customerId === null && r.manageTokenHash === null)).toBe(true);
        expect(resas.find((r) => r.code === upcoming.body.code)?.status).toBe("CANCELLED");
        expect(resas.every((r) => r.status === "CANCELLED")).toBe(true);   // celles à venir ont été annulées
        const stranger = await tx.reservation.findFirstOrThrow({ where: { tenantId: ids.tenant, guestEmail: "autre@client.tg" } });
        expect(stranger).toMatchObject({ guestName: "Awa Mensah", status: "CONFIRMED" });   // la réservation d'un autre invité est intacte
        const fb = await tx.feedback.findFirstOrThrow({ where: { comment: "Parfait" } });
        expect(fb).toMatchObject({ rating: 5, customerId: null, authorName: null });
        const o = await tx.order.findUniqueOrThrow({ where: { id: ids.awaOrder } });
        expect(o.customerId).toBeNull();
        expect(await tx.notificationLog.count({ where: { tenantId: ids.tenant, to: "awa@client.tg" } })).toBe(0);
        expect(await tx.emailVerification.count({ where: { userId: u.id } })).toBe(0);
        expect(await tx.auditLog.count({ where: { action: "customer.delete" } })).toBe(1);
      });
      // l'avis reste visible pour le restaurant, sous « Client »
      const mine = (await api().get(`${V}/tenant/reviews`).query({ rating: 5 }).set(as("manager"))).body.items.find((i: { comment: string }) => i.comment === "Parfait");
      expect(mine).toMatchObject({ author: "Client", hasAccount: false });
      // les autres comptes (même email, autre restaurant) ne sont pas touchés
      expect((await api().get(`${V}/tenant/customer/profile`).set(as("voisinAwa"))).body.email).toBe("awa@client.tg");
    });

    it("l'adresse peut servir à créer un nouveau compte après suppression", async () => {
      expect((await signup("baobab", "awa@client.tg")).status).toBe(201);
    });
  });
});
