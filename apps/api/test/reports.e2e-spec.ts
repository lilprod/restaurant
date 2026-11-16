import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { dishMargin } from "@restaurant/utils";
import pdf from "pdf-parse";
import request from "supertest";
import { NotificationsService } from "../src/notifications/notifications.service";
import { DailyReportService } from "../src/reports/daily-report.service";
import { asPlatform, createApp, login, resetDb, seedPlatform } from "./helpers";

const PW = "Cigale-Bleue74";
const D0 = "2026-10-11", D1 = "2026-10-12", D2 = "2026-10-13"; // lundi, mardi (fuseau du restaurant : Asia/Kolkata, UTC+5:30)
const TZ_OFFSET_MS = 5.5 * 3_600_000;
/** Instant UTC d'une heure locale (Kolkata) : `at("2026-10-13", 0, 30)` = 12 octobre 19:00 UTC. */
const at = (day: string, h: number, m = 0) => new Date(Date.parse(`${day}T00:00:00Z`) + (h * 60 + m) * 60_000 - TZ_OFFSET_MS);
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const binary = (res: request.Response, cb: (e: Error | null, b: Buffer) => void) => { const c: Buffer[] = []; res.on("data", (x: Buffer) => c.push(x)); res.on("end", () => cb(null, Buffer.concat(c))); };

describe("P5 Rapports : ventes, TVA, caisse, marges, exports, factures, plateforme (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let seed: Awaited<ReturnType<typeof seedPlatform>>;
  let root: string;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const V = "/api/v1";
  const api = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  const q = (from: string, to = from) => `from=${from}&to=${to}`;
  const get = (path: string, who = "manager") => api().get(`${V}/tenant/reports/${path}`).set(as(who));
  const getBin = (path: string, who = "manager") => api().get(path).set(as(who)).buffer(true).parse(binary);
  const pdfText = async (buf: Buffer) => nbsp((await pdf(buf)).text);

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
  const addStaff = async (slug: string, who: string, role: string) => {
    const res = await api().post(`${V}/tenant/staff`).set(as("admin")).send({ email: `${who}@${slug}.tg`, firstName: who, lastName: "Test", role });
    expect(res.status).toBe(201);
    const l = await api().post(`${V}/tenant/auth/login`).send({ tenantSlug: slug, email: `${who}@${slug}.tg`, password: res.body.temporaryPassword });
    await asPlatform(prisma, (tx) => tx.user.updateMany({ where: { email: `${who}@${slug}.tg` }, data: { mustChangePassword: false } }));
    return l.body.accessToken as string;
  };

  /** Crée une commande à emporter, l'encaisse en totalité si `pay`, puis la date (commande, lignes, paiements). */
  const order = async (items: { menuItemId: string; quantity: number }[], when: Date, pay?: { method: string; tip?: number }, who = "waiter") => {
    const res = await api().post(`${V}/tenant/orders`).set(as(who)).send({ type: "TAKEAWAY", customerName: "Kodjo", items: items.map((i) => ({ optionIds: [], ...i })) });
    expect(res.status).toBe(201);
    const o = res.body as { id: string; total: number; number: number; items: { id: string }[] };
    if (pay) {
      const p = await api().post(`${V}/tenant/orders/${o.id}/payments`).set(as(who)).send({
        method: pay.method, amount: o.total, tip: pay.tip ?? 0, ...(pay.method === "CASH" ? { tendered: o.total + (pay.tip ?? 0) } : {}), ...(["FLOOZ", "TMONEY"].includes(pay.method) ? { reference: `REF-${o.number}` } : {}),
      });
      expect(p.status).toBe(201);
    }
    await redate(o.id, when);
    return o;
  };
  const redate = (orderId: string, when: Date) => asPlatform(prisma, async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { createdAt: when } });
    await tx.orderItem.updateMany({ where: { orderId }, data: { createdAt: when } });
    await tx.payment.updateMany({ where: { orderId }, data: { paidAt: when, createdAt: when } });
  });

  beforeAll(async () => {
    prisma = new PrismaClient();
    await resetDb(prisma);
    seed = await seedPlatform(prisma);
    await prisma.plan.update({ where: { id: seed.pro.id }, data: { features: { reports: true, inventory: true, staff: true } } });
    await prisma.plan.update({ where: { id: seed.starter.id }, data: { features: { reports: false } } });
    app = await createApp();
    await app.listen(0, "127.0.0.1");
    root = (await login(app, "root@test.local")).body.accessToken;
    ids.carte = await makeTenant("carte", seed.pro.id);
    ids.voisin = await makeTenant("voisin", seed.pro.id);
    ids.petit = await makeTenant("petit", seed.starter.id);
    tok.admin = await tenantLogin("carte", "admin@carte.tg");
    tok.manager = await addStaff("carte", "manager", "MANAGER");
    tok.waiter = await addStaff("carte", "waiter", "WAITER");
    tok.kitchen = await addStaff("carte", "kitchen", "KITCHEN");
    tok.other = await tenantLogin("voisin", "admin@voisin.tg");
    tok.starter = await tenantLogin("petit", "admin@petit.tg");

    // Fuseau non entier (UTC+5:30), service de 10 %, TVA par défaut 18 %.
    await api().patch(`${V}/tenant/settings/localization`).set(as("admin")).send({ locale: "fr", timezone: "Asia/Kolkata", dateFormat: "DD/MM/YYYY", firstDayOfWeek: 1 }).expect(200);
    await api().patch(`${V}/tenant/settings/operations`).set(as("admin")).send({ serviceChargePercent: 10 }).expect(200);

    const plats = (await api().post(`${V}/tenant/menu/categories`).set(as("manager")).send({ name: "Plats" })).body.id;
    const boissons = (await api().post(`${V}/tenant/menu/categories`).set(as("manager")).send({ name: "Boissons" })).body.id;
    const item = async (categoryId: string, name: string, price: number, vatRate: number) =>
      (await api().post(`${V}/tenant/menu/items`).set(as("manager")).send({ categoryId, name, price, vatRate })).body.id as string;
    ids.riz = await item(plats, "Riz sauce arachide", 3500, 10);
    ids.poulet = await item(plats, "Poulet braisé", 5000, 10);
    ids.jus = await item(boissons, "Jus de bissap", 1000, 18);
    ids.inj = await item(boissons, '=HYPERLINK("http://x.tg";"Cliquez")', 1000, 18);

    // Fiches techniques (P3) : riz = 0,2 kg à 800 F/kg ; poulet = 1 pièce à 2 000 F ; le jus n'a pas de fiche.
    const ing = async (body: object) => (await api().post(`${V}/tenant/inventory/ingredients`).set(as("manager")).send(body)).body.id as string;
    ids.rizIng = await ing({ name: "Riz parfumé", unit: "kg", avgCost: 800, initialQuantity: 50 });
    ids.pouletIng = await ing({ name: "Poulet", unit: "piece", avgCost: 2000, initialQuantity: 50 });
    await api().put(`${V}/tenant/menu/items/${ids.riz}/recipe`).set(as("manager")).send({ lines: [{ ingredientId: ids.rizIng, quantity: 0.2 }] }).expect(200);
    await api().put(`${V}/tenant/menu/items/${ids.poulet}/recipe`).set(as("manager")).send({ lines: [{ ingredientId: ids.pouletIng, quantity: 1 }] }).expect(200);

    // Caisse ouverte : les paiements y sont rattachés.
    await api().post(`${V}/tenant/register/open`).set(as("manager")).send({ opening: 10000 }).expect(201);

    // Veille de la période (comparaison) : 1 poulet en espèces.
    await order([{ menuItemId: ids.poulet, quantity: 1 }], at(D0, 12), { method: "CASH" });
    // Jour 1 (lundi)
    ids.A = (await order([{ menuItemId: ids.riz, quantity: 2 }, { menuItemId: ids.jus, quantity: 1 }], at(D1, 12, 10), { method: "CASH", tip: 500 })).id;
    ids.B = (await order([{ menuItemId: ids.poulet, quantity: 1 }, { menuItemId: ids.jus, quantity: 2 }], at(D1, 13, 5), { method: "FLOOZ" })).id;
    ids.C = (await order([{ menuItemId: ids.jus, quantity: 3 }], at(D1, 21, 45))).id; // non payée
    // Jour 2 (mardi), dont une commande à 00:30 locale (= 19:00 UTC la veille)
    ids.D = (await order([{ menuItemId: ids.riz, quantity: 1 }], at(D2, 0, 30), { method: "TMONEY" })).id;
    const e = await order([{ menuItemId: ids.riz, quantity: 1 }, { menuItemId: ids.poulet, quantity: 1 }], at(D2, 12), undefined);
    ids.E = e.id;
    await api().post(`${V}/tenant/orders/${e.id}/items/${e.items[0].id}/cancel`).set(as("manager")).send({ reason: "Plus de riz" }).expect(200);
    const pe = await api().post(`${V}/tenant/orders/${e.id}/payments`).set(as("waiter")).send({ method: "CARD", amount: 5500 });
    expect(pe.status).toBe(201);
    await redate(e.id, at(D2, 12));
    const f = await order([{ menuItemId: ids.riz, quantity: 1 }], at(D2, 15));
    await api().post(`${V}/tenant/orders/${f.id}/cancel`).set(as("manager")).send({ reason: "Client parti" }).expect(200);
    ids.F = f.id;
    await asPlatform(prisma, (tx) => tx.order.update({ where: { id: f.id }, data: { cancelledAt: at(D2, 15, 10) } }));
    const h = await order([{ menuItemId: ids.inj, quantity: 1 }], at(D2, 16, 20), { method: "CASH" });
    ids.H = h.id;
    const refund = await api().get(`${V}/tenant/orders/${h.id}`).set(as("manager"));
    await api().post(`${V}/tenant/orders/${h.id}/payments/${refund.body.payments[0].id}/refund`).set(as("manager")).send({ reason: "Erreur de caisse" }).expect(200);
    await asPlatform(prisma, (tx) => tx.payment.updateMany({ where: { orderId: h.id }, data: { refundedAt: at(D2, 16, 30) } }));

    // Clôture de caisse avec un écart de -100, datée du jour 1.
    const closed = await api().post(`${V}/tenant/register/close`).set(as("manager")).send({ counted: 0 });
    expect(closed.status).toBe(200);
    await asPlatform(prisma, (tx) => tx.registerSession.updateMany({ data: { openedAt: at(D1, 9), closedAt: at(D1, 23) } }));

    // Pertes (P3), datées du jour 1 ; avis (P2C).
    await api().post(`${V}/tenant/inventory/waste`).set(as("kitchen")).send({ ingredientId: ids.rizIng, quantity: 1, reason: "Brûlé" }).expect(201);
    await api().post(`${V}/tenant/inventory/waste`).set(as("kitchen")).send({ ingredientId: ids.pouletIng, quantity: 2, reason: "Périmé" }).expect(201);
    await asPlatform(prisma, (tx) => tx.wasteRecord.updateMany({ data: { createdAt: at(D1, 18) } }));
    const fb = (orderId: string, rating: number, extra: object = {}) => asPlatform(prisma, (tx) =>
      tx.feedback.create({ data: { tenantId: ids.carte, orderId, rating, createdAt: at(rating === 1 ? D2 : D1, 20), ...extra } }));
    await fb(ids.A, 5); await fb(ids.B, 3, { comment: "Bon mais long" }); await fb(ids.D, 1, { comment: "Trop lent", hiddenAt: new Date() });
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe("plan, rôles, validation", () => {
    it("refuse le module au plan sans `reports` (403 PLAN_FEATURE) et aux non-responsables", async () => {
      for (const p of ["sales", "vat", "register", "margins", "waste", "staff", "reviews", "peak-hours", "export/sales"]) {
        const res = await get(`${p}?${q(D1)}`, "starter");
        expect([res.status, res.body.code]).toEqual([403, "PLAN_FEATURE"]);
        for (const who of ["waiter", "kitchen"]) expect((await get(`${p}?${q(D1)}`, who)).status).toBe(403);
      }
      expect((await api().get(`${V}/tenant/reports/sales?${q(D1)}`)).status).toBe(401);
    });

    it("valide la période (400 en français) et le type d'export", async () => {
      const bad = await get("sales?from=2026-10-12&to=2026-10-01");
      expect(bad.status).toBe(400);
      expect(bad.body.errors[0].message).toBe("La fin précède le début");
      expect((await get("sales?from=2025-01-01&to=2026-10-01")).body.errors[0].message).toBe("Période de 366 jours au plus");
      expect((await get("sales?from=hier&to=2026-10-01")).status).toBe(400);
      expect((await get(`export/inconnu?${q(D1)}`)).status).toBe(400);
      expect((await get(`export/sales?${q(D1)}&format=xls`)).status).toBe(400);
    });
  });

  describe("cohérence avec le tableau de bord et les commandes", () => {
    it.each([[D1], [D2]])("le jour %s : mêmes chiffres que le tableau de bord", async (day) => {
      const [dash, rep] = await Promise.all([
        api().get(`${V}/tenant/dashboard?date=${day}`).set(as("manager")),
        get(`sales?${q(day)}`),
      ]);
      expect(rep.status).toBe(200);
      const s = rep.body.summary;
      expect([s.revenue, s.tips, s.ordersCount, s.averageTicket]).toEqual([dash.body.revenue, dash.body.tips, dash.body.ordersCount, dash.body.averageTicket]);
      const type = (t: string) => rep.body.byType.find((x: { type: string }) => x.type === t)?.orders ?? 0;
      expect([type("DINE_IN"), type("TAKEAWAY")]).toEqual([dash.body.byType.DINE_IN, dash.body.byType.TAKEAWAY]);
      const sort = <T extends { method?: string; name?: string }>(a: T[]) => [...a].sort((x, y) => (x.method ?? x.name!).localeCompare(y.method ?? y.name!));
      expect(sort(rep.body.byMethod.map((m: { method: string; amount: number }) => ({ method: m.method, amount: m.amount })))).toEqual(sort(dash.body.byMethod));
      expect(rep.body.byHour.map((h: { orders: number }) => h.orders)).toEqual(dash.body.byHour.map((h: { orders: number }) => h.orders));
      expect(sort(dash.body.topItems.map((i: { name: string; quantity: number; revenue: number }) => ({ name: i.name, quantity: i.quantity, revenue: i.revenue }))))
        .toEqual(sort(rep.body.byItem.slice(0, dash.body.topItems.length).map((i: { name: string; quantity: number; amount: number }) => ({ name: i.name, quantity: i.quantity, revenue: i.amount }))));
    });

    it("valeurs connues sur le jour 1 (fuseau UTC+5:30) et comparaison à la période précédente", async () => {
      const r = (await get(`sales?${q(D1)}`)).body;
      expect(r.summary).toMatchObject({
        revenue: 16500, tips: 500, ordersCount: 3, ordersTotal: 19800, averageTicket: 6600, subtotal: 18000, serviceCharge: 1800,
        cancelledOrders: { count: 0, amount: 0 }, refunds: { count: 0, amount: 0 },
      });
      expect(r.previous).toMatchObject({ from: D0, to: D0, summary: { revenue: 5500, ordersCount: 1 } });
      expect(r.byMethod.map((m: { method: string; amount: number }) => [m.method, m.amount])).toEqual([["CASH", 8800], ["FLOOZ", 7700]]);
      expect(r.byCategory.map((c: { name: string; amount: number }) => [c.name, c.amount])).toEqual([["Plats", 12000], ["Boissons", 6000]]);
      expect(r.byHour.filter((h: { orders: number }) => h.orders).map((h: { hour: number }) => h.hour)).toEqual([12, 13, 21]);
      expect(r.byWeekday.map((d: { orders: number }) => d.orders)).toEqual([3, 0, 0, 0, 0, 0, 0]);
      expect(r.byWaiter).toEqual([expect.objectContaining({ name: "waiter Test", orders: 3, total: 19800 })]);
    });

    it("jour 2 : annulations, remboursements, commande de 00:30 locale rattachée au bon jour", async () => {
      const r = (await get(`sales?${q(D2)}`)).body;
      expect(r.summary).toMatchObject({
        revenue: 9350, ordersCount: 3, ordersTotal: 10450, averageTicket: 3483,
        cancelledOrders: { count: 1, amount: 3500 }, cancelledItems: { count: 1, amount: 3500 }, refunds: { count: 1, amount: 1100 },
      });
      expect(r.byHour[0].orders).toBe(1);
      expect(r.byWeekday[1].orders).toBe(3);
    });

    it("période libre : somme des jours = total, égale à la somme des commandes et paiements en base", async () => {
      const r = (await get(`sales?${q(D1, D2)}`)).body;
      expect(r.byDay.map((d: { day: string }) => d.day)).toEqual([D1, D2]);
      expect(r.summary.revenue).toBe(r.byDay.reduce((n: number, d: { revenue: number }) => n + d.revenue, 0));
      expect(r.summary.ordersCount).toBe(r.byDay.reduce((n: number, d: { orders: number }) => n + d.orders, 0));
      const start = at(D1, 0), end = at("2026-10-14", 0);
      const [orders, pays] = await asPlatform(prisma, (tx) => Promise.all([
        tx.order.aggregate({ where: { tenantId: ids.carte, cancelledAt: null, createdAt: { gte: start, lt: end } }, _sum: { total: true, subtotal: true, vat: true }, _count: { _all: true } }),
        tx.payment.aggregate({ where: { tenantId: ids.carte, status: "PAID", paidAt: { gte: start, lt: end } }, _sum: { amount: true, tip: true } }),
      ]));
      expect([r.summary.ordersTotal, r.summary.subtotal, r.summary.vat, r.summary.ordersCount]).toEqual([orders._sum.total, orders._sum.subtotal, orders._sum.vat, orders._count._all]);
      expect([r.summary.revenue, r.summary.tips]).toEqual([pays._sum.amount, pays._sum.tip]);
      expect(r.byCategory.reduce((n: number, c: { amount: number }) => n + c.amount, 0)).toBe(orders._sum.subtotal);
    });

    it("un autre restaurant ne voit rien", async () => {
      const r = (await get(`sales?${q(D1, D2)}`, "other")).body;
      expect(r.summary).toMatchObject({ revenue: 0, ordersCount: 0, ordersTotal: 0 });
      expect(r.byItem).toEqual([]);
    });
  });

  describe("TVA, caisse, marges, pertes, personnel, avis, heures de pointe", () => {
    it("TVA par taux : le total égale la somme des TVA des commandes", async () => {
      const r = (await get(`vat?${q(D1, D2)}`)).body;
      expect(r.rows.map((x: { rate: number; ttc: number }) => [x.rate, x.ttc])).toEqual([[10, 20500], [18, 9750]]);
      const orders = await asPlatform(prisma, (tx) => tx.order.aggregate({ where: { tenantId: ids.carte, cancelledAt: null, createdAt: { gte: at(D1, 0), lt: at("2026-10-14", 0) } }, _sum: { vat: true, total: true } }));
      expect([r.totals.vat, r.totals.ttc]).toEqual([orders._sum.vat, orders._sum.total]);
      expect(r.totals.base + r.totals.vat).toBe(r.totals.ttc);
    });

    it("caisse : session, encaissements et écart", async () => {
      const r = (await get(`register?${q(D1, D2)}`)).body;
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]).toMatchObject({ opening: 10000, closing: 0, openedBy: "manager Test" });
      expect(r.rows[0].difference).toBe(-r.rows[0].expectedCash);
      expect(r.totals).toMatchObject({ sessions: 1, open: 0, withGap: 1, difference: r.rows[0].difference });
      expect((await get(`register?${q("2026-09-01", "2026-09-30")}`)).body.rows).toEqual([]);
    });

    it("marges : coût matière P3 × quantités vendues (dishMargin), ventes sans fiche signalées", async () => {
      const r = (await get(`margins?${q(D1, D2)}`)).body;
      const riz = r.rows.find((x: { name: string }) => x.name === "Riz sauce arachide");
      const m = dishMargin(10500, 10, 3 * 160);
      expect(riz).toMatchObject({ quantity: 3, amount: 10500, unitCost: 160, cost: 480, revenueNet: m.net, margin: m.margin, marginRate: m.marginRate });
      expect(r.rows.find((x: { name: string }) => x.name === "Poulet braisé")).toMatchObject({ quantity: 2, cost: 4000 });
      expect(r.uncosted.revenue).toBe(7000); // jus et plat à formule injection : sans fiche technique
      expect(r.totals.cost).toBe(4480);
      const dc = (await api().get(`${V}/tenant/inventory/dish-costs`).set(as("manager"))).body.find((x: { name: string }) => x.name === "Riz sauce arachide");
      expect(dc.cost).toBe(160);
    });

    it("pertes valorisées", async () => {
      const r = (await get(`waste?${q(D1)}`)).body;
      expect(r.totals).toEqual({ cost: 800 + 4000, count: 2 });
      expect(r.ingredients[0]).toMatchObject({ name: "Poulet", cost: 4000, quantity: 2 });
      expect(r.reasons.map((x: { reason: string }) => x.reason).sort()).toEqual(["Brûlé", "Périmé"]);
      expect((await get(`waste?${q(D2)}`)).body.totals.cost).toBe(0);
    });

    it("performances du personnel : identiques à la route du personnel (P4)", async () => {
      const [rep, p4] = await Promise.all([get(`staff?${q(D1, D2)}`), api().get(`${V}/tenant/staff/performance?${q(D1, D2)}`).set(as("manager"))]);
      expect(rep.status).toBe(200);
      expect(rep.body).toEqual(p4.body);
      expect(rep.body.totals.revenue).toBe((await get(`sales?${q(D1, D2)}`)).body.summary.revenue);
    });

    it("avis : moyenne, répartition, comparaison", async () => {
      const r = (await get(`reviews?${q(D1, D2)}`)).body;
      expect(r.summary).toMatchObject({ count: 3, average: 3, distribution: { 1: 1, 3: 1, 5: 1 } });
      expect(r.hidden).toBe(1);
      expect(r.recent[0]).toMatchObject({ rating: 1, comment: "Trop lent", hidden: true });
      expect((await get(`reviews?${q(D1)}`)).body.summary).toMatchObject({ count: 2, average: 4 });
    });

    it("heures de pointe : carte jour × heure dans le fuseau du restaurant", async () => {
      const r = (await get(`peak-hours?${q(D1, D2)}`)).body;
      const cell = (weekday: number, hour: number) => r.cells.find((c: { weekday: number; hour: number }) => c.weekday === weekday && c.hour === hour)?.orders;
      expect([cell(1, 12), cell(1, 13), cell(1, 21), cell(2, 0), cell(2, 12), cell(2, 16)]).toEqual([1, 1, 1, 1, 1, 1]);
      expect(r.totalOrders).toBe(6);
      expect(r.max).toBe(1);
    });
  });

  describe("exports", () => {
    it("CSV des ventes : BOM, en-têtes, totaux, aucune formule exécutable", async () => {
      const res = await get(`export/sales?${q(D1, D2)}&format=csv`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toContain(`rapport-sales-${D1}_${D2}.csv`);
      const text = res.text;
      expect(text.charCodeAt(0)).toBe(0xfeff);
      expect(text).toContain("Rapport des ventes");
      expect(text).toContain("Catégorie;Quantité;Ventes TTC (FCFA)");
      expect(text).toContain("Total;");
      const lines = text.split("\r\n");
      const total = lines.find((l) => l.startsWith("Chiffre d'affaires encaissé (FCFA);"))!;
      expect(total.split(";")[1]).toBe("25850");
      // Le plat « =HYPERLINK(…) » est neutralisé : texte précédé d'une apostrophe, jamais une cellule commençant par « = ».
      expect(lines.some((l) => /(^|;)"?=/.test(l))).toBe(false);
      expect(text).toContain(`"'=HYPERLINK(""http://x.tg"";""Cliquez"")"`);
    });

    it("PDF des ventes : document valide avec en-têtes et totaux lisibles", async () => {
      const res = await getBin(`${V}/tenant/reports/export/sales?${q(D1, D2)}&format=pdf`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/pdf");
      const buf = res.body as Buffer;
      expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(buf.includes(Buffer.from("/FontFile"))).toBe(true); // polices embarquées
      const text = await pdfText(buf);
      expect(text).toContain("Rapport des ventes");
      expect(text).toContain("Du 12/10/2026 au 13/10/2026");
      expect(text).toContain("25 850 FCFA");
      expect(text).toContain("Par catégorie");
      expect(text).toContain("Riz sauce arachide");
    });

    it("chaque rapport s'exporte en CSV et en PDF", async () => {
      for (const kind of ["vat", "register", "margins", "waste", "staff", "reviews", "peak-hours"]) {
        const csv = await get(`export/${kind}?${q(D1, D2)}&format=csv`);
        expect([kind, csv.status]).toEqual([kind, 200]);
        expect(csv.text.length).toBeGreaterThan(40);
        const p = await getBin(`${V}/tenant/reports/export/${kind}?${q(D1, D2)}&format=pdf`);
        expect([kind, p.status, (p.body as Buffer).subarray(0, 4).toString()]).toEqual([kind, 200, "%PDF"]);
      }
      const vat = (await get(`export/vat?${q(D1, D2)}&format=csv`)).text;
      expect(vat).toContain("Taux (%);Base HT (FCFA);TVA (FCFA);Total TTC (FCFA)");
    });

    it("l'export est journalisé (audit)", async () => {
      const rows = await asPlatform(prisma, (tx) => tx.auditLog.findMany({ where: { tenantId: ids.carte, action: "report.export" } }));
      expect(rows.length).toBeGreaterThan(3);
      expect(rows[0].metadata).toMatchObject({ from: expect.any(String), to: expect.any(String) });
    });

    it("CSV des commandes en flux : toutes les lignes, au-delà d'un lot de 1 000", async () => {
      const res = await get(`export/orders?${q(D1, D2)}`);
      const lines = res.text.split("\r\n").filter(Boolean);
      expect(lines[0]).toContain("N°;Date;Type;Statut");
      expect(lines).toHaveLength(1 + 7); // A, B, C, D, E, F (annulée), H
      expect(lines.find((l) => l.includes("Client parti"))).toContain("Annulée");
      // 2 300 commandes dans un autre restaurant : le curseur traverse plusieurs lots sans doublon ni trou.
      const base = Date.parse("2026-10-12T05:00:00Z");
      await asPlatform(prisma, (tx) => tx.order.createMany({
        data: Array.from({ length: 2300 }, (_, i) => ({ tenantId: ids.voisin, number: i + 1, type: "TAKEAWAY" as const, total: 1000, subtotal: 1000, createdAt: new Date(base + Math.floor(i / 3) * 1000) })),
      }));
      const big = await get(`export/orders?${q(D1)}`, "other");
      const rows = big.text.split("\r\n").filter(Boolean).slice(1).map((l) => Number(l.split(";")[0]));
      expect(rows).toHaveLength(2300);
      expect(new Set(rows).size).toBe(2300);
    });
  });

  describe("facture et reçus PDF", () => {
    it("facture d'une commande : numéro, lignes, TVA par taux, total, paiement", async () => {
      const o = (await api().get(`${V}/tenant/orders/${ids.A}`).set(as("waiter"))).body;
      const res = await getBin(`${V}/tenant/orders/${ids.A}/invoice.pdf`, "waiter");
      expect(res.status).toBe(200);
      expect(res.headers["content-disposition"]).toContain(`facture-F-${String(o.number).padStart(6, "0")}.pdf`);
      const text = await pdfText(res.body as Buffer);
      expect(text).toContain("FACTURE");
      expect(text).toContain(`F-${String(o.number).padStart(6, "0")}`);
      expect(text).toContain("Riz sauce arachide");
      expect(text).toContain("TOTAL TTC");
      expect(text).toContain("8 800 FCFA");
      expect(text).toContain("Dont TVA 10");
      expect(text).toContain("Espèces");
      expect(text).toContain("Facture acquittée");
    });

    it("refuse une commande annulée (409), une commande d'un autre restaurant (404), la cuisine (403)", async () => {
      expect((await getBin(`${V}/tenant/orders/${ids.F}/invoice.pdf`, "manager")).status).toBe(409);
      expect((await getBin(`${V}/tenant/orders/${ids.A}/invoice.pdf`, "other")).status).toBe(404);
      expect((await getBin(`${V}/tenant/orders/${ids.A}/invoice.pdf`, "kitchen")).status).toBe(403);
      const unpaid = await getBin(`${V}/tenant/orders/${ids.C}/invoice.pdf`, "waiter");
      expect(await pdfText(unpaid.body as Buffer)).toContain("Reste à payer");
    });

    it("reçu d'un paiement de licence : plateforme, administrateur du restaurant, isolation", async () => {
      const pay = await api().post(`${V}/platform/payments`).set({ Authorization: `Bearer ${root}` })
        .send({ tenantId: ids.carte, method: "FLOOZ", billingCycle: "MONTHLY", periods: 1, reference: "FL-2026-1", paidAt: "2026-09-10T10:00:00Z" });
      expect(pay.status).toBe(201);
      const url = `${V}/platform/payments/${pay.body.id}/receipt.pdf`;
      const res = await api().get(url).set({ Authorization: `Bearer ${root}` }).buffer(true).parse(binary);
      expect(res.status).toBe(200);
      const text = await pdfText(res.body as Buffer);
      expect(text).toContain(pay.body.receiptNumber);
      expect(text).toContain("REÇU");
      expect(text).toContain("carte");
      expect(text).toContain("FL-2026-1");
      expect(text).toContain("35 000 FCFA");
      const mine = await getBin(`${V}/tenant/license/payments/${pay.body.id}/receipt.pdf`, "admin");
      expect(mine.status).toBe(200);
      expect(await pdfText(mine.body as Buffer)).toContain(pay.body.receiptNumber);
      expect((await getBin(`${V}/tenant/license/payments/${pay.body.id}/receipt.pdf`, "other")).status).toBe(404);
      expect((await getBin(`${V}/tenant/license/payments/${pay.body.id}/receipt.pdf`, "manager")).status).toBe(403);
    });
  });

  describe("plateforme", () => {
    it("revenus de licences par mois et par moyen, renouvellements, résiliations ; export", async () => {
      const R = { Authorization: `Bearer ${root}` };
      const rec = (body: object) => api().post(`${V}/platform/payments`).set(R).send(body);
      await rec({ tenantId: ids.carte, method: "CASH", billingCycle: "MONTHLY", periods: 1, paidAt: "2026-10-10T10:00:00Z" }).expect(201);
      await rec({ tenantId: ids.voisin, method: "TMONEY", billingCycle: "MONTHLY", periods: 2, reference: "TM-9", paidAt: "2026-10-20T10:00:00Z" }).expect(201);
      await asPlatform(prisma, (tx) => tx.subscription.updateMany({ where: { tenantId: ids.petit }, data: { cancelledAt: new Date("2026-10-25T10:00:00Z") } }));
      const res = await api().get(`${V}/platform/reports/licenses?from=2026-09-01&to=2026-10-31`).set(R);
      expect(res.status).toBe(200);
      const [sep, oct] = res.body.revenue.byMonth;
      expect([sep.month, sep.total, sep.firstPayments, sep.renewals]).toEqual(["2026-09", 35000, 1, 0]);
      expect([oct.month, oct.total, oct.count, oct.renewals, oct.firstPayments, oct.cancellations]).toEqual(["2026-10", 35000 + 70000, 2, 1, 1, 1]);
      expect(oct.byMethod).toEqual({ CASH: 35000, TMONEY: 70000 });
      expect(res.body.revenue.total).toBe(140000);
      expect(res.body.revenue.byMethod.map((m: { method: string }) => m.method)).toEqual(["TMONEY", "CASH", "FLOOZ"]);
      expect(Object.values(res.body.tenants).reduce((a, b) => (a as number) + (b as number), 0)).toBe(3);

      const csv = await api().get(`${V}/platform/reports/licenses/export?from=2026-09-01&to=2026-10-31&format=csv`).set(R);
      expect(csv.text).toContain("Mois;Paiements;Espèces (FCFA);Carte (FCFA);Flooz (FCFA);TMoney (FCFA);Total (FCFA)");
      expect(csv.text).toContain("Total;3;35000;0;35000;70000;140000");
      const p = await api().get(`${V}/platform/reports/licenses/export?from=2026-09-01&to=2026-10-31&format=pdf`).set(R).buffer(true).parse(binary);
      expect(await pdfText(p.body as Buffer)).toContain("140 000 FCFA");
    });

    it("réservé au SuperAdmin (le support n'y accède pas)", async () => {
      const sup = (await login(app, "support@test.local")).body.accessToken;
      expect((await api().get(`${V}/platform/reports/licenses?from=2026-09-01&to=2026-10-31`).set({ Authorization: `Bearer ${sup}` })).status).toBe(403);
      expect((await api().get(`${V}/platform/reports/licenses?from=2026-09-01&to=2026-10-31`).set(as("admin"))).status).toBe(401);
    });
  });

  describe("rapport quotidien par email (X1)", () => {
    const NOW = new Date("2026-10-12T22:30:00Z"); // 04:00 le 13 octobre à Kolkata : la veille est le 12
    let notif: NotificationsService;
    let daily: DailyReportService;
    const run = async (now = NOW) => { const r = await daily.run(now); await notif.flush(); return r; };

    beforeAll(() => { notif = app.get(NotificationsService); daily = app.get(DailyReportService); });

    it("désactivé par défaut : rien n'est envoyé", async () => {
      notif.outbox.length = 0;
      expect(await run()).toEqual({ checked: 0, sent: 0 });
      expect(notif.outbox).toHaveLength(0);
      const cfg = await api().get(`${V}/tenant/settings/reports`).set(as("manager"));
      expect(cfg.body).toEqual({ dailyReport: false, dailyReportHour: 8 });
    });

    it("l'administrateur seul l'active ; avant l'heure choisie rien ne part", async () => {
      expect((await api().patch(`${V}/tenant/settings/reports`).set(as("manager")).send({ dailyReport: true })).status).toBe(403);
      await api().patch(`${V}/tenant/settings/reports`).set(as("admin")).send({ dailyReport: true, dailyReportHour: 6 }).expect(200);
      expect(await run()).toMatchObject({ sent: 0 });
    });

    it("envoie la veille aux administrateurs et gérants, une seule fois", async () => {
      const later = new Date("2026-10-13T01:00:00Z"); // 06:30 locale
      notif.outbox.length = 0;
      const r = await run(later);
      expect(r).toEqual({ checked: 1, sent: 2 });
      expect(notif.outbox.map((m) => m.to).sort()).toEqual(["admin@carte.tg", "manager@carte.tg"]);
      const m = notif.outbox[0];
      expect(m.subject).toBe("Ventes du lundi 12 octobre 2026 — carte");
      expect(nbsp(m.text)).toContain("16 500 FCFA");
      expect(nbsp(m.text)).toContain("Commandes : 3");
      expect(nbsp(m.text)).toContain("Riz sauce arachide");
      expect(await run(later)).toMatchObject({ sent: 0 });
      expect(notif.outbox).toHaveLength(2);
    });

    it("ne part pas pour un restaurant dont le plan n'inclut pas les rapports", async () => {
      await api().patch(`${V}/tenant/settings/reports`).set(as("starter")).send({ dailyReport: true }).expect(200);
      notif.outbox.length = 0;
      await run(new Date("2026-10-13T03:00:00Z"));
      expect(notif.outbox.every((m) => m.to !== "admin@petit.tg")).toBe(true);
    });
  });
});
