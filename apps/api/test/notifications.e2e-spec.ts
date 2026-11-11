import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { NotificationsService } from "../src/notifications/notifications.service";
import { LicenseRemindersService } from "../src/notifications/license-reminders.service";
import type { EmailDriver, EmailMessage } from "../src/notifications/drivers/types";
import { asPlatform, createApp, login, resetDb, seedPlatform } from "./helpers";

const PW = "Cigale-Bleue74";
const V = "/api/v1";
const DAY = 86_400_000;

describe("Notifications : email, SMS, file, relances, journal (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let seed: Awaited<ReturnType<typeof seedPlatform>>;
  let notif: NotificationsService;
  let reminders: LicenseRemindersService;
  let root: string;
  let support: string;
  const tenants: Record<string, string> = {};
  const tok: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  const makeTenant = async (slug: string, phone?: string) => {
    const res = await api().post(`${V}/platform/tenants`).set(bearer(root)).send({
      name: `Chez ${slug}`, slug, email: `contact@${slug}.tg`, phone, planId: seed.starter.id,
      admin: { firstName: "Ama", lastName: "Koffi", email: `admin@${slug}.tg`, password: PW },
    });
    expect(res.status).toBe(201);
    await asPlatform(prisma, (tx) => tx.user.updateMany({ where: { tenantId: res.body.id }, data: { mustChangePassword: false } }));
    tenants[slug] = res.body.id;
    tok[slug] = (await api().post(`${V}/tenant/auth/login`).send({ tenantSlug: slug, email: `admin@${slug}.tg`, password: PW })).body.accessToken;
  };
  const journal = (slug: string, query = "") => api().get(`${V}/tenant/notifications${query}`).set(bearer(tok[slug]));

  beforeAll(async () => {
    prisma = new PrismaClient();
    await resetDb(prisma);
    seed = await seedPlatform(prisma);
    app = await createApp();
    notif = app.get(NotificationsService);
    reminders = app.get(LicenseRemindersService);
    root = (await login(app, "root@test.local")).body.accessToken;
    support = (await login(app, "support@test.local")).body.accessToken;
    await makeTenant("kofi", "90 12 34 56");
    await makeTenant("ama");
  });
  afterAll(async () => {
    await notif.flush();
    await app.close();
    await prisma.$disconnect();
  });

  describe("relances de licence", () => {
    const NOW = new Date("2026-11-11T12:00:00Z"); // midi à Lomé (UTC) : les paliers ne dépendent pas de l'heure d'exécution du test
    const at = (days: number, hours = 0) => new Date(NOW.getTime() + days * DAY + hours * 3_600_000);
    const endAt = (slug: string, date: Date) =>
      asPlatform(prisma, (tx) => tx.subscription.updateMany({ where: { tenantId: tenants[slug] }, data: { status: "ACTIVE", currentPeriodEnd: date, cancelledAt: null } }));
    const sweep = async (now: Date) => { const r = await reminders.run(now); await notif.flush(); return r; };

    beforeAll(async () => {
      await endAt("kofi", at(90));
      await endAt("ama", at(90));
    });

    it("envoie J-7, J-1 puis J0 aux administrateurs, une seule fois par palier, avec la marque du restaurant", async () => {
      notif.outbox.length = 0;
      await endAt("ama", at(20));
      expect((await sweep(NOW)).sent).toBe(0); // trop tôt

      await endAt("ama", at(6));
      expect((await sweep(NOW)).sent).toBe(1); // email à l'administrateur (canal SMS désactivé par défaut)
      expect((await sweep(at(0, 2))).sent).toBe(0); // même palier : une seule fois
      expect(notif.outbox).toHaveLength(1);
      expect(notif.outbox[0].to).toBe("admin@ama.tg");
      expect(notif.outbox[0].subject).toBe("Votre licence Chez ama expire dans 7 jours");
      expect(notif.outbox[0].html).toContain("Chez ama");
      expect(notif.outbox[0].text).toContain("/r/ama/licence");

      expect((await sweep(at(5))).sent).toBe(1); // la veille : J-1
      expect((await sweep(at(5, 3))).sent).toBe(0);
      expect((await sweep(at(6, 1))).sent).toBe(1); // jour d'expiration : J0
      expect((await sweep(at(6, 2))).sent).toBe(0);
      expect((await sweep(at(9))).sent).toBe(0); // trop tard pour relancer
    });

    it("trace chaque palier dans le journal (une ligne par palier) et date la dernière relance", async () => {
      const rows = (await journal("ama", "?template=license.reminder")).body;
      expect(rows.total).toBe(3);
      expect(rows.items.map((r: { subject: string }) => r.subject).sort()).toEqual([
        "Votre licence Chez ama expire aujourd'hui",
        "Votre licence Chez ama expire dans 7 jours",
        "Votre licence Chez ama expire demain",
      ]);
      expect(rows.items.every((r: { status: string; to: string }) => r.status === "SENT" && r.to === "a••••@ama.tg")).toBe(true);
      expect((await prisma.subscription.findFirstOrThrow({ where: { tenantId: tenants.ama } })).reminderSentAt).not.toBeNull();
      expect((await journal("kofi", "?template=license.reminder")).body.total).toBe(0);
    });

    it("respecte les préférences par événement et par canal ; envoie aussi un SMS de 160 caractères au plus si le canal est actif", async () => {
      await endAt("kofi", at(5));
      await api().patch(`${V}/tenant/settings/notifications`).set(bearer(tok.kofi)).send({ events: { licenseReminders: false } }).expect(200);
      notif.outbox.length = 0;
      expect((await sweep(NOW)).sent).toBe(0);
      expect(notif.outbox).toHaveLength(0);

      await api().patch(`${V}/tenant/settings/notifications`).set(bearer(tok.kofi)).send({ events: { licenseReminders: true }, channels: { sms: true } }).expect(200);
      notif.smsOutbox.length = 0;
      expect((await sweep(NOW)).sent).toBe(2); // email + SMS au numéro du restaurant
      expect(notif.smsOutbox).toHaveLength(1);
      expect(notif.smsOutbox[0].to).toBe("+22890123456");
      expect(notif.smsOutbox[0].text.length).toBeLessThanOrEqual(160);
      const sms = (await journal("kofi", "?channel=SMS")).body;
      expect(sms.items).toHaveLength(1);
      expect(sms.items[0].to).toBe("+228 •• •• 34 56");

      await endAt("kofi", at(4)); // nouvelle échéance : nouveau palier
      await api().patch(`${V}/tenant/settings/notifications`).set(bearer(tok.kofi)).send({ channels: { email: false, sms: false } }).expect(200);
      notif.outbox.length = 0;
      notif.smsOutbox.length = 0;
      expect((await sweep(NOW)).sent).toBe(0);
      expect(notif.outbox).toHaveLength(0);
      expect(notif.smsOutbox).toHaveLength(0);
    });
  });

  describe("mot de passe oublié et inscriptions", () => {
    it("migre « mot de passe oublié » : lien par email, variables confidentielles jamais conservées, renvoi refusé", async () => {
      await api().patch(`${V}/tenant/settings/notifications`).set(bearer(tok.kofi)).send({ channels: { email: false } }).expect(200); // un message transactionnel part quand même
      notif.outbox.length = 0;
      const res = await api().post(`${V}/tenant/auth/forgot-password`).send({ email: "admin@kofi.tg", tenantSlug: "kofi" });
      expect(res.status).toBe(202);
      expect(notif.outbox).toHaveLength(1);
      expect(notif.outbox[0].text).toMatch(/reset-password\?token=[\w-]+/);
      expect(notif.outbox[0].html).toContain("Chez kofi");

      const row = (await journal("kofi", "?template=auth.password-reset")).body.items[0];
      expect(row).toMatchObject({ status: "SENT", channel: "EMAIL", to: "a••••@kofi.tg", canResend: false });
      const stored = await asPlatform(prisma, (tx) => tx.notificationLog.findUniqueOrThrow({ where: { id: row.id } }));
      expect(stored.data).toBeNull();
      expect(JSON.stringify(stored)).not.toContain("token=");
      expect((await api().post(`${V}/tenant/notifications/${row.id}/resend`).set(bearer(tok.kofi))).status).toBe(409);
    });

    it("ne bloque ni ne fait échouer la requête quand le pilote est en panne", async () => {
      const real = notif.drivers.email;
      notif.drivers.email = { name: "panne", send: async () => { throw new Error("SMTP indisponible"); } };
      try {
        const res = await api().post(`${V}/tenant/auth/forgot-password`).send({ email: "admin@ama.tg", tenantSlug: "ama" });
        expect(res.status).toBe(202);
        await notif.flush();
      } finally {
        notif.drivers.email = real;
      }
      const row = (await journal("ama", "?template=auth.password-reset")).body.items[0];
      expect(row.status).toBe("FAILED");
      expect(row.attempts).toBe(5);
      expect(row.error).toContain("SMTP indisponible");
    });

    it("confirme l'inscription d'un restaurant : demande reçue, validée, rejetée (messages de la plateforme)", async () => {
      notif.outbox.length = 0;
      const body = (slug: string) => ({
        restaurantName: `Resto ${slug}`, slug, ownerFirstName: "Yao", ownerLastName: "Dosseh", email: `yao@${slug}.tg`, password: "Cigale-Bleue74", planId: seed.starter.id,
      });
      const a = await api().post(`${V}/public/registrations`).send(body("nouveau"));
      const b = await api().post(`${V}/public/registrations`).send(body("refuse"));
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(notif.outbox.map((m) => m.subject)).toEqual(["Votre demande d'inscription a bien été reçue", "Votre demande d'inscription a bien été reçue"]);

      await api().post(`${V}/platform/registrations/${a.body.id}/approve`).set(bearer(root)).send({}).expect(200);
      await api().post(`${V}/platform/registrations/${b.body.id}/reject`).set(bearer(root)).send({ reason: "Dossier incomplet" }).expect(200);
      const approved = notif.outbox.find((m) => m.subject === "Votre restaurant est activé")!;
      expect(approved.to).toBe("yao@nouveau.tg");
      expect(approved.text).toContain("/r/nouveau/login");
      const rejected = notif.outbox.find((m) => m.subject.includes("pas été retenue"))!;
      expect(rejected.text).toContain("Dossier incomplet");

      // Côté plateforme : visibles avec le filtre « sans restaurant » ; côté restaurant : jamais.
      const platformOnly = (await api().get(`${V}/platform/notifications?tenantId=none&pageSize=100`).set(bearer(root))).body;
      expect(platformOnly.items.map((i: { template: string }) => i.template).sort()).toEqual([
        "registration.received", "registration.received", "registration.rejected",
      ]);
      expect((await journal("kofi", "?template=registration.received")).body.total).toBe(0);
    });
  });

  describe("reprises après échec du pilote", () => {
    const flaky = (failures: number): EmailDriver & { calls: number } => {
      const d = { name: "instable", calls: 0, async send(_m: EmailMessage) { if (++d.calls <= failures) throw new Error(`panne ${d.calls}`); } };
      return d;
    };
    const sendReminder = (key: string) =>
      notif.send({ channel: "EMAIL", to: "admin@ama.tg", template: "license.reminder", tenantId: tenants.ama, dedupeKey: key, data: { firstName: "Ama", tier: "J7", endDate: "1 janvier 2027", planName: "Starter", licenseUrl: "http://app/r/ama/licence" } });

    it("réessaie puis réussit : tentatives comptées, erreur effacée", async () => {
      const real = notif.drivers.email;
      const driver = flaky(2);
      notif.drivers.email = driver;
      try {
        const r = await sendReminder("test:retry-ok");
        expect(r.status).toBe("queued");
        await notif.flush();
      } finally { notif.drivers.email = real; }
      expect(driver.calls).toBe(3);
      const row = await asPlatform(prisma, (tx) => tx.notificationLog.findUniqueOrThrow({ where: { dedupeKey: "test:retry-ok" } }));
      expect(row).toMatchObject({ status: "SENT", attempts: 3, error: null });
      expect(row.sentAt).not.toBeNull();
    });

    it("abandonne après 5 tentatives (FAILED), puis le renvoi manuel crée un nouvel envoi", async () => {
      const real = notif.drivers.email;
      const driver = flaky(5);
      notif.drivers.email = driver;
      try {
        await sendReminder("test:retry-ko");
        await notif.flush();
      } finally { notif.drivers.email = real; }
      expect(driver.calls).toBe(5);
      const failed = (await journal("ama", "?status=FAILED&template=license.reminder")).body.items[0];
      expect(failed).toMatchObject({ status: "FAILED", attempts: 5, canResend: true });
      expect(failed.error).toContain("panne 5");

      const res = await api().post(`${V}/tenant/notifications/${failed.id}/resend`).set(bearer(tok.ama));
      expect(res.status).toBe(200);
      await notif.flush();
      const all = (await journal("ama", "?template=license.reminder&pageSize=100")).body.items;
      const again = all.find((r: { id: string }) => r.id === res.body.id);
      expect(again).toMatchObject({ status: "SENT", resendOfId: failed.id });
    });

    it("ignore une clé de déduplication déjà utilisée et un destinataire invalide", async () => {
      expect((await sendReminder("test:retry-ok")).status).toBe("skipped");
      const bad = await notif.send({ channel: "SMS", to: "12345", template: "license.reminder", tenantId: tenants.ama, data: { firstName: "", tier: "J7", endDate: "x", planName: "x", licenseUrl: "x" } });
      expect(bad).toEqual({ status: "skipped", reason: "invalid_recipient" });
    });
  });

  describe("journal : accès et isolation", () => {
    it("réserve le journal restaurant à l'administrateur", async () => {
      for (const [who, role] of [["manager", "MANAGER"], ["waiter", "WAITER"]] as const) {
        const staff = await api().post(`${V}/tenant/staff`).set(bearer(tok.kofi)).send({ email: `${who}@kofi.tg`, firstName: who, lastName: "Test", role });
        expect(staff.status).toBe(201);
        await asPlatform(prisma, (tx) => tx.user.updateMany({ where: { email: `${who}@kofi.tg` }, data: { mustChangePassword: false } }));
        const token = (await api().post(`${V}/tenant/auth/login`).send({ tenantSlug: "kofi", email: `${who}@kofi.tg`, password: staff.body.temporaryPassword })).body.accessToken as string;
        expect(token).toBeTruthy();
        expect((await api().get(`${V}/tenant/notifications`).set(bearer(token))).status).toBe(403);
        expect((await api().post(`${V}/tenant/notifications/${randomUUID()}/resend`).set(bearer(token))).status).toBe(403);
      }
      expect((await api().get(`${V}/tenant/notifications`)).status).toBe(401);
      expect((await journal("kofi")).status).toBe(200);
    });

    it("n'expose jamais le journal d'un autre restaurant (liste, renvoi)", async () => {
      const kofi = (await journal("kofi", "?pageSize=100")).body;
      const ama = (await journal("ama", "?pageSize=100")).body;
      expect(kofi.total).toBeGreaterThan(0);
      expect(ama.total).toBeGreaterThan(0);
      const kofiIds = new Set(kofi.items.map((i: { id: string }) => i.id));
      expect(ama.items.some((i: { id: string }) => kofiIds.has(i.id))).toBe(false);
      expect(kofi.items.every((i: { tenantId: string }) => i.tenantId === tenants.kofi)).toBe(true);
      const amaResendable = ama.items.find((i: { canResend: boolean }) => i.canResend);
      expect((await api().post(`${V}/tenant/notifications/${amaResendable.id}/resend`).set(bearer(tok.kofi))).status).toBe(404);
      expect((await api().get(`${V}/tenant/notifications?channel=FAX`).set(bearer(tok.kofi))).status).toBe(400);
    });

    it("plateforme : vue globale filtrable, SUPPORT en lecture seule, renvoi réservé au SuperAdmin", async () => {
      const all = (await api().get(`${V}/platform/notifications?pageSize=100`).set(bearer(support))).body;
      const owners = new Set<string | null>(all.items.map((i: { tenantId: string | null }) => i.tenantId));
      expect([tenants.kofi, tenants.ama, null].every((t) => owners.has(t))).toBe(true);
      expect(all.items.find((i: { tenantId: string }) => i.tenantId === tenants.kofi).tenant).toMatchObject({ slug: "kofi" });
      expect(all.items.every((i: { to: string }) => !i.to.includes("admin@") && !i.to.includes("90123456"))).toBe(true);
      const only = (await api().get(`${V}/platform/notifications?tenantId=${tenants.ama}&pageSize=100`).set(bearer(root))).body;
      expect(only.items.length).toBeGreaterThan(0);
      expect(only.items.every((i: { tenantId: string }) => i.tenantId === tenants.ama)).toBe(true);

      const target = only.items.find((i: { canResend: boolean }) => i.canResend);
      expect((await api().post(`${V}/platform/notifications/${target.id}/resend`).set(bearer(support))).status).toBe(403);
      expect((await api().post(`${V}/platform/notifications/${target.id}/resend`).set(bearer(root))).status).toBe(200);
      await notif.flush();
      expect((await api().get(`${V}/platform/notifications`).set(bearer(tok.kofi))).status).toBe(401);
    });
  });
});
