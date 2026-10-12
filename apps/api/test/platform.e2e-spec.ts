import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { asPlatform, createApp, login, resetDb, seedPlatform } from "./helpers";

const DAY = 86_400_000;

describe("Plateforme SaaS (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let seed: Awaited<ReturnType<typeof seedPlatform>>;
  let tok: string;
  let supportTok: string;
  const api = () => request(app.getHttpServer());
  const auth = (t = tok) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    prisma = new PrismaClient();
    await resetDb(prisma);
    seed = await seedPlatform(prisma);
    app = await createApp();
    tok = (await login(app, "root@test.local")).body.accessToken;
    supportTok = (await login(app, "support@test.local")).body.accessToken;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe("authentification", () => {
    it("refuse un mauvais mot de passe et les routes sans jeton", async () => {
      expect((await login(app, "root@test.local", "mauvais")).status).toBe(401);
      expect((await api().get("/api/v1/platform/tenants")).status).toBe(401);
      expect((await api().get("/api/v1/platform/tenants").set(auth("n.importe.quoi"))).status).toBe(401);
    });
    it("renouvelle la session avec rotation du refresh token", async () => {
      const first = (await login(app, "root@test.local")).body;
      const second = await api().post("/api/v1/platform/auth/refresh").send({ refreshToken: first.refreshToken });
      expect(second.status).toBe(200);
      const replay = await api().post("/api/v1/platform/auth/refresh").send({ refreshToken: first.refreshToken });
      expect(replay.status).toBe(401);
      const me = await api().get("/api/v1/platform/auth/me").set(auth(second.body.accessToken));
      expect(me.body.role).toBe("SUPER_ADMIN");
    });
    it("limite le rôle SUPPORT en lecture seule", async () => {
      expect((await api().get("/api/v1/platform/plans").set(auth(supportTok))).status).toBe(200);
      const res = await api().post("/api/v1/platform/payments").set(auth(supportTok)).send({});
      expect(res.status).toBe(403);
    });
  });

  describe("inscription d'un restaurant", () => {
    let regId: string;
    const body = {
      restaurantName: "Chez Kofi", slug: "chez-kofi", ownerFirstName: "Kofi", ownerLastName: "Mensah",
      email: "Kofi@Example.com", password: "MotDePasse1", phone: "90000000",
    };
    it("expose les plans actifs publiquement", async () => {
      const res = await api().get("/api/v1/public/plans");
      expect(res.status).toBe(200);
      expect(res.body.map((p: { code: string }) => p.code)).toEqual(expect.arrayContaining(["STARTER", "PRO"]));
    });
    it("enregistre la demande sans créer de tenant", async () => {
      const res = await api().post("/api/v1/public/registrations").send({ ...body, planId: seed.starter.id });
      expect(res.status).toBe(201);
      regId = res.body.id;
      expect(await prisma.tenant.count()).toBe(0);
      expect((await api().post("/api/v1/public/registrations").send(body)).status).toBe(409);
      expect((await api().post("/api/v1/public/registrations").send({ ...body, slug: "Mauvais Slug" })).status).toBe(400);
    });
    it("n'expose pas le hash du mot de passe dans la liste", async () => {
      const res = await api().get("/api/v1/platform/registrations?status=PENDING").set(auth());
      expect(res.body).toHaveLength(1);
      expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    });
    it("la validation crée le tenant, son admin et un essai de 14 jours", async () => {
      const res = await api().post(`/api/v1/platform/registrations/${regId}/approve`).set(auth()).send({});
      expect(res.status).toBe(200);
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: "chez-kofi" }, include: { subscriptions: true } });
      expect(tenant.status).toBe("TRIAL");
      const sub = tenant.subscriptions[0];
      expect(sub.status).toBe("TRIALING");
      expect(Math.round((sub.currentPeriodEnd.getTime() - Date.now()) / DAY)).toBe(14);
      const admin = await asPlatform(prisma, (tx) => tx.user.findFirstOrThrow({ where: { tenantId: tenant.id } }));
      expect(admin.role).toBe("ADMIN");
      expect(admin.email).toBe("kofi@example.com");
      expect((await api().post(`/api/v1/platform/registrations/${regId}/approve`).set(auth()).send({})).status).toBe(409);
    });
    it("refuse un sous-domaine réservé et annule toute la validation", async () => {
      const r = await api().post("/api/v1/public/registrations").send({ ...body, slug: "admin", email: "x@example.com" });
      const res = await api().post(`/api/v1/platform/registrations/${r.body.id}/approve`).set(auth()).send({});
      expect(res.status).toBe(409);
      expect((await prisma.tenantRegistration.findUniqueOrThrow({ where: { id: r.body.id } })).status).toBe("PENDING");
      const rej = await api().post(`/api/v1/platform/registrations/${r.body.id}/reject`).set(auth()).send({ reason: "Sous-domaine réservé" });
      expect(rej.status).toBe(200);
    });
  });

  describe("création directe par le SuperAdmin", () => {
    it("crée un tenant et refuse un doublon de slug", async () => {
      const payload = {
        name: "Le Palmier", slug: "le-palmier", email: "contact@palmier.tg", planId: seed.pro.id,
        admin: { firstName: "Ama", lastName: "Dossou", email: "ama@palmier.tg", password: "MotDePasse1" },
      };
      const res = await api().post("/api/v1/platform/tenants").set(auth()).send(payload);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("TRIAL");
      expect(res.body.usersCount).toBe(1);
      expect((await api().post("/api/v1/platform/tenants").set(auth()).send(payload)).status).toBe(409);
    });
    it("un plan sans essai crée un tenant suspendu jusqu'au premier paiement", async () => {
      const res = await api().post("/api/v1/platform/tenants").set(auth()).send({
        name: "Sans Essai", slug: "sans-essai", email: "a@b.tg", planId: seed.noTrial.id,
        admin: { firstName: "A", lastName: "B", email: "a@b.tg", password: "MotDePasse1" },
      });
      expect(res.body.status).toBe("SUSPENDED");
      expect(res.body.subscription.status).toBe("EXPIRED");
    });
  });

  describe("paiements de licence manuels", () => {
    let tenantId: string;
    let trialEnd: Date;
    beforeAll(async () => {
      const t = await prisma.tenant.findUniqueOrThrow({ where: { slug: "chez-kofi" }, include: { subscriptions: true } });
      tenantId = t.id;
      trialEnd = t.subscriptions[0].currentPeriodEnd;
    });
    const pay = (extra: object) =>
      api().post("/api/v1/platform/payments").set(auth()).send({ tenantId, billingCycle: "MONTHLY", ...extra });

    it("exige une référence pour Flooz / TMoney / carte mais pas pour les espèces", async () => {
      for (const method of ["FLOOZ", "TMONEY", "CARD"]) {
        const res = await pay({ method });
        expect(res.status).toBe(400);
      }
      expect((await pay({ method: "BITCOIN" })).status).toBe(400);
    });
    it("un paiement espèces active la licence à partir de la fin de l'essai", async () => {
      const res = await pay({ method: "CASH" });
      expect(res.status).toBe(201);
      expect(res.body.amount).toBe(15000);
      expect(res.body.receiptNumber).toBe(`REC-${new Date().getUTCFullYear()}-000001`);
      expect(new Date(res.body.periodStart).getTime()).toBe(trialEnd.getTime());
      const end = new Date(res.body.periodEnd);
      expect(end.getTime()).toBeGreaterThan(trialEnd.getTime() + 27 * DAY);
      expect(res.body.subscription.status).toBe("ACTIVE");
      expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).status).toBe("ACTIVE");
    });
    it("enregistre Flooz avec référence, plusieurs périodes et un montant négocié", async () => {
      const res = await pay({ method: "FLOOZ", reference: "FL-778899", periods: 3, amount: 40000 });
      expect(res.status).toBe(201);
      expect(res.body.amount).toBe(40000);
      expect(res.body.receiptNumber).toMatch(/-000002$/);
    });
    it("annule uniquement le dernier paiement et restitue la période", async () => {
      const list = await api().get(`/api/v1/platform/payments?tenantId=${tenantId}`).set(auth());
      expect(list.body.total).toBe(2);
      expect(list.body.totalAmount).toBe(55000);
      const [last, first] = list.body.items;
      expect((await api().post(`/api/v1/platform/payments/${first.id}/void`).set(auth()).send({ reason: "Erreur de saisie" })).status).toBe(409);
      const before = (await prisma.subscription.findUniqueOrThrow({ where: { id: last.subscriptionId } })).currentPeriodEnd;
      const ok = await api().post(`/api/v1/platform/payments/${last.id}/void`).set(auth()).send({ reason: "Erreur de saisie" });
      expect(ok.status).toBe(200);
      const after = (await prisma.subscription.findUniqueOrThrow({ where: { id: last.subscriptionId } })).currentPeriodEnd;
      expect(after.getTime()).toBe(new Date(last.periodStart).getTime());
      expect(after.getTime()).toBeLessThan(before.getTime());
      expect((await api().post(`/api/v1/platform/payments/${last.id}/void`).set(auth()).send({ reason: "Encore" })).status).toBe(409);
      const total = await api().get(`/api/v1/platform/payments?tenantId=${tenantId}`).set(auth());
      expect(total.body.totalAmount).toBe(15000);
    });
    it("numérote les reçus sans trou, y compris après annulation", async () => {
      const res = await pay({ method: "TMONEY", reference: "TM-1234" });
      expect(res.body.receiptNumber).toMatch(/-000003$/);
    });
  });

  describe("expiration, grâce et réactivation", () => {
    let tenantId: string;
    beforeAll(async () => {
      tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: "le-palmier" } })).id;
    });
    const setEnd = (daysAgo: number) =>
      prisma.subscription.updateMany({
        where: { tenantId, status: { in: ["TRIALING", "ACTIVE", "GRACE"] } },
        data: { currentPeriodEnd: new Date(Date.now() - daysAgo * DAY), graceEndsAt: null },
      });
    const state = async () => ({
      tenant: (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).status,
      sub: (await prisma.subscription.findFirstOrThrow({ where: { tenantId }, orderBy: { createdAt: "desc" } })).status,
    });

    it("ne touche pas une licence en cours", async () => {
      const res = await api().post("/api/v1/platform/licensing/sweep").set(auth());
      expect(res.status).toBe(200);
      expect(await state()).toEqual({ tenant: "TRIAL", sub: "TRIALING" });
    });
    it("passe en période de grâce sans couper l'accès", async () => {
      await setEnd(2);
      await api().post("/api/v1/platform/licensing/sweep").set(auth());
      expect((await state()).sub).toBe("GRACE");
      expect((await state()).tenant).toBe("TRIAL");
    });
    it("expire et suspend le restaurant après la grâce", async () => {
      await setEnd(10);
      await prisma.subscription.updateMany({ where: { tenantId, status: "GRACE" }, data: { graceEndsAt: new Date(Date.now() - 3 * DAY) } });
      const res = await api().post("/api/v1/platform/licensing/sweep").set(auth());
      expect(res.body.changed).toBe(1);
      expect(await state()).toEqual({ tenant: "SUSPENDED", sub: "EXPIRED" });
      expect((await api().post(`/api/v1/platform/tenants/${tenantId}/reactivate`).set(auth())).status).toBe(409);
    });
    it("un paiement réactive le restaurant avec une nouvelle licence qui démarre aujourd'hui", async () => {
      const res = await api().post("/api/v1/platform/payments").set(auth()).send({
        tenantId, method: "CARD", reference: "CB-0001", billingCycle: "YEARLY",
      });
      expect(res.status).toBe(201);
      expect(res.body.amount).toBe(350000);
      expect(await state()).toEqual({ tenant: "ACTIVE", sub: "ACTIVE" });
      expect(await prisma.subscription.count({ where: { tenantId } })).toBe(2);
      expect(Math.round((new Date(res.body.periodEnd).getTime() - Date.now()) / DAY)).toBeGreaterThanOrEqual(364);
    });
    it("une suspension manuelle n'est pas levée par un paiement mais l'est par l'admin", async () => {
      expect((await api().post(`/api/v1/platform/tenants/${tenantId}/suspend`).set(auth())).status).toBe(200);
      const res = await api().post("/api/v1/platform/payments").set(auth()).send({ tenantId, method: "CASH", billingCycle: "MONTHLY" });
      expect(res.body.tenantStatus).toBe("SUSPENDED");
      expect((await state()).tenant).toBe("SUSPENDED");
      expect((await api().post(`/api/v1/platform/tenants/${tenantId}/reactivate`).set(auth())).status).toBe(200);
      expect((await state()).tenant).toBe("ACTIVE");
    });
    it("alimente le tableau de bord et l'audit", async () => {
      const dash = await api().get("/api/v1/platform/dashboard").set(auth());
      expect(dash.status).toBe(200);
      expect(dash.body.revenueThisMonth.total).toBeGreaterThan(0);
      expect(dash.body.revenueThisMonth.byMethod.map((m: { method: string }) => m.method)).toEqual(expect.arrayContaining(["CASH", "CARD"]));
      expect(await prisma.platformAuditLog.count({ where: { action: "payment.record" } })).toBeGreaterThanOrEqual(4);
    });
  });
});
