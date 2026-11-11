import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { Clock } from "../src/common/clock";
import { asPlatform, createApp, login, resetDb, seedPlatform } from "./helpers";

const PW = "Cigale-Bleue74";

describe("P1B Compléments du menu : formules, horaires, promotions (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let seed: Awaited<ReturnType<typeof seedPlatform>>;
  let root: string;
  let clock: Clock;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const V = "/api/v1";
  const api = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  // Mercredi 11 novembre 2026, fuseau Africa/Lome (UTC+0).
  const at = (hm: string) => clock.freeze(`2026-11-11T${hm}:00Z`);

  const tenantLogin = async (slug: string, email: string) =>
    (await api().post(`${V}/tenant/auth/login`).send({ tenantSlug: slug, email, password: PW })).body.accessToken as string;
  const makeTenant = async (slug: string, planId: string) => {
    const res = await api().post(`${V}/platform/tenants`).set({ Authorization: `Bearer ${root}` }).send({
      name: slug, slug, email: `contact@${slug}.tg`, planId, admin: { firstName: "Ama", lastName: "Koffi", email: `admin@${slug}.tg`, password: PW },
    });
    expect(res.status).toBe(201);
    await asPlatform(prisma, (tx) => tx.user.updateMany({ where: { tenantId: res.body.id }, data: { mustChangePassword: false } }));
  };
  const addStaff = async (slug: string, who: string, role: string) => {
    const res = await api().post(`${V}/tenant/staff`).set(as("admin")).send({ email: `${who}@${slug}.tg`, firstName: who, lastName: "Test", role });
    const l = await api().post(`${V}/tenant/auth/login`).send({ tenantSlug: slug, email: `${who}@${slug}.tg`, password: res.body.temporaryPassword });
    await asPlatform(prisma, (tx) => tx.user.updateMany({ where: { email: `${who}@${slug}.tg` }, data: { mustChangePassword: false } }));
    return l.body.accessToken as string;
  };
  const dish = async (body: object) => {
    const res = await api().post(`${V}/tenant/menu/items`).set(as("manager")).send({ categoryId: ids.cat, vatRate: 10, ...body });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };
  const place = (items: object[], who = "waiter") =>
    api().post(`${V}/tenant/orders`).set(as(who)).send({ type: "TAKEAWAY", customerName: "Kodjo", items });
  const qty = async (id: string) => (await api().get(`${V}/tenant/inventory/ingredients/${id}`).set(as("manager"))).body.quantity as number;
  const formulaBody = (over: object = {}) => ({
    name: "Menu du jour", price: 6000, steps: [
      { name: "Entrée", minChoices: 1, maxChoices: 1, menuItemIds: [ids.salade] },
      { name: "Plat", minChoices: 1, maxChoices: 1, menuItemIds: [ids.poulet, ids.riz] },
      { name: "Dessert", minChoices: 0, maxChoices: 1, menuItemIds: [ids.gateau] },
    ], ...over,
  });

  beforeAll(async () => {
    prisma = new PrismaClient();
    await resetDb(prisma);
    seed = await seedPlatform(prisma);
    await prisma.plan.update({ where: { id: seed.pro.id }, data: { features: { inventory: true } } });
    app = await createApp();
    clock = app.get(Clock);
    root = (await login(app, "root@test.local")).body.accessToken;
    await makeTenant("gargote", seed.pro.id);
    await makeTenant("voisin", seed.pro.id);
    tok.admin = await tenantLogin("gargote", "admin@gargote.tg");
    tok.manager = await addStaff("gargote", "manager", "MANAGER");
    tok.waiter = await addStaff("gargote", "waiter", "WAITER");
    tok.kitchen = await addStaff("gargote", "kitchen", "KITCHEN");
    tok.other = await tenantLogin("voisin", "admin@voisin.tg");
    at("12:00");
    ids.cat = (await api().post(`${V}/tenant/menu/categories`).set(as("manager")).send({ name: "Plats" })).body.id;
    ids.salade = await dish({ name: "Salade", price: 1500 });
    ids.poulet = await dish({ name: "Poulet braisé", price: 4000 });
    ids.riz = await dish({ name: "Riz sauce", price: 3000 });
    ids.gateau = await dish({ name: "Gâteau", price: 1000 });
    const ing = async (name: string, unit: string, initialQuantity: number) =>
      (await api().post(`${V}/tenant/inventory/ingredients`).set(as("manager")).send({ name, unit, avgCost: 100, initialQuantity })).body.id as string;
    ids.pouletIng = await ing("Poulet", "piece", 10);
    ids.laitue = await ing("Laitue", "piece", 10);
    ids.farine = await ing("Farine", "kg", 10);
    const recipe = (dishId: string, ingredientId: string, quantity: number) =>
      api().put(`${V}/tenant/menu/items/${dishId}/recipe`).set(as("manager")).send({ lines: [{ ingredientId, quantity }] }).expect(200);
    await recipe(ids.poulet, ids.pouletIng, 1);
    await recipe(ids.salade, ids.laitue, 1);
    await recipe(ids.gateau, ids.farine, 0.5);
  });
  afterAll(async () => {
    clock.unfreeze();
    await app.close();
    await prisma.$disconnect();
  });

  describe("gestion des formules", () => {
    it("réserve l'écriture aux responsables, lit pour tout le personnel, valide", async () => {
      expect((await api().post(`${V}/tenant/menu/formulas`).set(as("waiter")).send(formulaBody())).status).toBe(403);
      expect((await api().get(`${V}/tenant/menu/formulas`).set(as("kitchen"))).status).toBe(200);
      const bad = await api().post(`${V}/tenant/menu/formulas`).set(as("manager")).send(formulaBody({ steps: [] }));
      expect(bad.status).toBe(400);
      expect(bad.body.errors[0].path).toBe("steps");
      const half = await api().post(`${V}/tenant/menu/formulas`).set(as("manager")).send(formulaBody({ availableFrom: "11:00" }));
      expect(half.status).toBe(400);
      const res = await api().post(`${V}/tenant/menu/formulas`).set(as("manager")).send(formulaBody());
      expect(res.status).toBe(201);
      expect(res.body.steps.map((s: { name: string }) => s.name)).toEqual(["Entrée", "Plat", "Dessert"]);
      ids.formula = res.body.id;
    });

    it("refuse un plat à options obligatoires et isole les restaurants", async () => {
      const withOpt = await dish({ name: "Pizza", price: 3000, optionGroups: [{ name: "Taille", minChoices: 1, maxChoices: 1, options: [{ name: "M", extra: 0 }] }] });
      const res = await api().post(`${V}/tenant/menu/formulas`).set(as("manager")).send(formulaBody({ steps: [{ name: "Plat", menuItemIds: [withOpt] }] }));
      expect(res.status).toBe(409);
      expect((await api().get(`${V}/tenant/menu/formulas`).set(as("other"))).body).toEqual([]);
      expect((await api().patch(`${V}/tenant/menu/formulas/${ids.formula}`).set(as("other")).send({ name: "x" })).status).toBe(404);
      expect((await api().delete(`${V}/tenant/menu/formulas/${ids.formula}`).set(as("other"))).status).toBe(404);
    });
  });

  describe("commande d'une formule", () => {
    const choices = () => [
      { stepId: ids.stepEntree, menuItemId: ids.salade }, { stepId: ids.stepPlat, menuItemId: ids.poulet }, { stepId: ids.stepDessert, menuItemId: ids.gateau },
    ];
    beforeAll(async () => {
      const f = (await api().get(`${V}/tenant/menu/formulas`).set(as("waiter"))).body[0];
      [ids.stepEntree, ids.stepPlat, ids.stepDessert] = f.steps.map((s: { id: string }) => s.id);
    });

    it("valide les choix (étape manquante, plat étranger à l'étape)", async () => {
      const missing = await place([{ formulaId: ids.formula, quantity: 1, choices: choices().slice(0, 1) }]);
      expect(missing.status).toBe(400);
      expect(missing.body.message).toMatch(/Plat/);
      const foreign = await place([{ formulaId: ids.formula, quantity: 1, choices: [choices()[0], { stepId: ids.stepPlat, menuItemId: ids.gateau }] }]);
      expect(foreign.status).toBe(400);
      expect((await place([{ formulaId: ids.formula, menuItemId: ids.poulet, quantity: 1 }])).status).toBe(400);
    });

    it("facture le prix de la formule, envoie les plats en cuisine et déduit leur stock", async () => {
      const res = await place([{ formulaId: ids.formula, quantity: 2, choices: choices() }]);
      expect(res.status).toBe(201);
      ids.fOrder = res.body.id;
      const parent = res.body.items.find((i: { formulaId: string | null }) => i.formulaId);
      const kids = res.body.items.filter((i: { parentItemId: string | null }) => i.parentItemId);
      expect(parent).toMatchObject({ name: "Menu du jour", unitPrice: 6000, lineTotal: 12000, quantity: 2 });
      expect(kids.map((k: { name: string; stepName: string; lineTotal: number; quantity: number }) => [k.stepName, k.name, k.lineTotal, k.quantity]))
        .toEqual([["Entrée", "Salade", 0, 2], ["Plat", "Poulet braisé", 0, 2], ["Dessert", "Gâteau", 0, 2]]);
      expect(res.body).toMatchObject({ subtotal: 12000, total: 12000 });
      // Cuisine : seulement les plats, pas la ligne facturée.
      const board = (await api().get(`${V}/tenant/kitchen`).set(as("kitchen"))).body.find((o: { id: string }) => o.id === ids.fOrder);
      expect(board.items.map((i: { name: string }) => i.name)).toEqual(["Salade", "Poulet braisé", "Gâteau"]);
      // La ligne formule n'avance pas seule.
      expect((await api().post(`${V}/tenant/orders/${ids.fOrder}/items/${parent.id}/status`).set(as("kitchen")).send({ status: "IN_PROGRESS" })).status).toBe(409);
      // Stock (P3) : chaque plat choisi déduit sa recette × quantité.
      const before = [await qty(ids.pouletIng), await qty(ids.laitue), await qty(ids.farine)];
      const go = await api().post(`${V}/tenant/orders/${ids.fOrder}/advance`).set(as("kitchen")).send({ status: "IN_PROGRESS" });
      expect(go.status).toBe(200);
      expect(go.body.items.find((i: { formulaId: string | null }) => i.formulaId).status).toBe("IN_PROGRESS");
      expect([await qty(ids.pouletIng), await qty(ids.laitue), await qty(ids.farine)]).toEqual([before[0] - 2, before[1] - 2, before[2] - 1]);
      // Une annulation par un responsable restitue puis perd la marchandise ; ici on poursuit jusqu'au service.
      await api().post(`${V}/tenant/orders/${ids.fOrder}/advance`).set(as("kitchen")).send({ status: "READY" }).expect(200);
      const served = await api().post(`${V}/tenant/orders/${ids.fOrder}/advance`).set(as("waiter")).send({ status: "SERVED" });
      expect(served.body.status).toBe("DELIVERED");
      expect(served.body.items.every((i: { status: string }) => i.status === "SERVED")).toBe(true);
    });

    it("n'encaisse pas un plat de formule séparément, mais la formule entière", async () => {
      const o = (await api().get(`${V}/tenant/orders/${ids.fOrder}`).set(as("waiter"))).body;
      const kid = o.items.find((i: { parentItemId: string | null }) => i.parentItemId);
      const parent = o.items.find((i: { formulaId: string | null }) => i.formulaId);
      const bad = await api().post(`${V}/tenant/orders/${ids.fOrder}/payments`).set(as("waiter")).send({ method: "CASH", amount: 6000, allocations: [{ orderItemId: kid.id, quantity: 1 }] });
      expect(bad.status).toBe(400);
      const ok = await api().post(`${V}/tenant/orders/${ids.fOrder}/payments`).set(as("waiter")).send({ method: "CASH", amount: 6000, allocations: [{ orderItemId: parent.id, quantity: 1 }] });
      expect(ok.status).toBe(201);
      expect(ok.body.order.remaining).toBe(6000);
      const rest = await api().post(`${V}/tenant/orders/${ids.fOrder}/payments`).set(as("waiter")).send({ method: "CASH", amount: 6000 });
      expect(rest.body.order.paymentStatus).toBe("PAID");
      expect(rest.body.order.closedAt).not.toBeNull();
    });

    it("annule la formule entière (plats compris) et refuse d'annuler un plat seul", async () => {
      const res = await place([{ formulaId: ids.formula, quantity: 1, choices: choices() }]);
      const parent = res.body.items.find((i: { formulaId: string | null }) => i.formulaId);
      const kid = res.body.items.find((i: { parentItemId: string | null }) => i.parentItemId);
      expect((await api().post(`${V}/tenant/orders/${res.body.id}/items/${kid.id}/cancel`).set(as("waiter")).send({ reason: "erreur" })).status).toBe(409);
      expect((await api().patch(`${V}/tenant/orders/${res.body.id}/items/${kid.id}`).set(as("waiter")).send({ quantity: 3 })).status).toBe(409);
      // Modifier la quantité de la formule modifie ses plats.
      const upd = await api().patch(`${V}/tenant/orders/${res.body.id}/items/${parent.id}`).set(as("waiter")).send({ quantity: 3 });
      expect(upd.body.total).toBe(18000);
      expect(upd.body.items.filter((i: { parentItemId: string | null }) => i.parentItemId).every((i: { quantity: number }) => i.quantity === 3)).toBe(true);
      const c = await api().post(`${V}/tenant/orders/${res.body.id}/items/${parent.id}/cancel`).set(as("waiter")).send({ reason: "erreur de saisie" });
      expect(c.status).toBe(200);
      expect(c.body.status).toBe("CANCELLED");
      expect(c.body.items.every((i: { status: string }) => i.status === "CANCELLED")).toBe(true);
      expect(c.body.total).toBe(0);
    });

    it("refuse une formule hors de sa plage horaire ou désactivée", async () => {
      await api().patch(`${V}/tenant/menu/formulas/${ids.formula}`).set(as("manager")).send({ availableFrom: "11:30", availableTo: "15:00" }).expect(200);
      at("09:00");
      const out = await place([{ formulaId: ids.formula, quantity: 1, choices: choices() }]);
      expect(out.status).toBe(409);
      expect(out.body.message).toBe("La formule « Menu du jour » n'est servie que de 11:30 à 15:00");
      const pub = (await api().get(`${V}/public/tenants/gargote/menu`)).body;
      expect(pub.formulas[0]).toMatchObject({ name: "Menu du jour", availableNow: false });
      at("12:00");
      expect((await place([{ formulaId: ids.formula, quantity: 1, choices: choices() }])).status).toBe(201);
      expect((await api().get(`${V}/public/tenants/gargote/menu`)).body.formulas[0].availableNow).toBe(true);
      await api().patch(`${V}/tenant/menu/formulas/${ids.formula}`).set(as("manager")).send({ isActive: false }).expect(200);
      expect((await place([{ formulaId: ids.formula, quantity: 1, choices: choices() }])).status).toBe(409);
      await api().patch(`${V}/tenant/menu/formulas/${ids.formula}`).set(as("manager")).send({ isActive: true, availableFrom: "", availableTo: "" }).expect(200);
    });

    it("archive une formule déjà commandée, supprime les autres", async () => {
      const tmp = (await api().post(`${V}/tenant/menu/formulas`).set(as("manager")).send(formulaBody({ name: "Éphémère" }))).body.id;
      expect((await api().delete(`${V}/tenant/menu/formulas/${tmp}`).set(as("manager"))).body).toEqual({ deleted: true });
      expect((await api().delete(`${V}/tenant/menu/formulas/${ids.formula}`).set(as("manager"))).body).toEqual({ archived: true });
      expect((await api().get(`${V}/tenant/menu/formulas`).set(as("manager"))).body).toEqual([]);
    });
  });

  describe("disponibilité horaire des plats", () => {
    it("refuse (409) hors plage dans le fuseau du restaurant, accepte dedans, grise la carte publique", async () => {
      ids.soupe = await dish({ name: "Soupe", price: 2000, availableFrom: "11:30", availableTo: "15:00" });
      expect((await api().patch(`${V}/tenant/menu/items/${ids.soupe}`).set(as("manager")).send({ availableFrom: "08:00", availableTo: "" })).status).toBe(400);
      at("10:00");
      const refused = await place([{ menuItemId: ids.soupe, quantity: 1 }]);
      expect(refused.status).toBe(409);
      expect(refused.body.message).toBe("« Soupe » n'est servi que de 11:30 à 15:00");
      const cat = (await api().get(`${V}/public/tenants/gargote/menu`)).body.categories[0];
      expect(cat.items.find((i: { name: string }) => i.name === "Soupe")).toMatchObject({ availableNow: false, availableFrom: "11:30" });
      expect(cat.items.find((i: { name: string }) => i.name === "Salade").availableNow).toBe(true);
      // Ajout à une commande existante : même règle.
      const ok = await place([{ menuItemId: ids.salade, quantity: 1 }]);
      expect((await api().post(`${V}/tenant/orders/${ok.body.id}/items`).set(as("waiter")).send({ items: [{ menuItemId: ids.soupe, quantity: 1 }] })).status).toBe(409);
      at("11:30");
      expect((await place([{ menuItemId: ids.soupe, quantity: 1 }])).status).toBe(201);
      at("15:00");
      expect((await place([{ menuItemId: ids.soupe, quantity: 1 }])).status).toBe(409);
      expect((await api().get(`${V}/tenant/menu`).set(as("waiter"))).body[0].items.find((i: { name: string }) => i.name === "Soupe")).toMatchObject({ availableFrom: "11:30", availableTo: "15:00" });
    });
  });

  describe("promotions", () => {
    const promo = (over: object = {}) => ({ name: "Happy hour", kind: "PERCENT", value: 25, menuItemId: ids.poulet, days: [3], fromTime: "17:00", toTime: "19:00", ...over });

    it("réserve la gestion aux responsables et valide", async () => {
      expect((await api().post(`${V}/tenant/menu/promotions`).set(as("waiter")).send(promo())).status).toBe(403);
      expect((await api().post(`${V}/tenant/menu/promotions`).set(as("manager")).send(promo({ menuItemId: undefined }))).status).toBe(400);
      expect((await api().post(`${V}/tenant/menu/promotions`).set(as("manager")).send(promo({ value: 150 }))).status).toBe(400);
      expect((await api().post(`${V}/tenant/menu/promotions`).set(as("manager")).send(promo({ startsOn: "2026-12-01", endsOn: "2026-11-01" }))).status).toBe(400);
      const res = await api().post(`${V}/tenant/menu/promotions`).set(as("manager")).send(promo());
      expect(res.status).toBe(201);
      ids.promo = res.body.id;
      expect((await api().get(`${V}/tenant/menu/promotions`).set(as("other"))).body).toEqual([]);
      expect((await api().put(`${V}/tenant/menu/promotions/${ids.promo}`).set(as("other")).send(promo())).status).toBe(404);
    });

    it("applique la remise pendant la période et la fige sur la ligne, visible sur le ticket", async () => {
      at("18:00");
      const res = await place([{ menuItemId: ids.poulet, quantity: 2 }, { menuItemId: ids.riz, quantity: 1 }]);
      expect(res.status).toBe(201);
      const l = res.body.items.find((i: { name: string }) => i.name === "Poulet braisé");
      expect(l).toMatchObject({ unitPrice: 3000, lineTotal: 6000, discount: 2000, promotionName: "Happy hour" });
      expect(res.body).toMatchObject({ discountTotal: 2000, subtotal: 9000 });
      expect(res.body.items.find((i: { name: string }) => i.name === "Riz sauce")).toMatchObject({ unitPrice: 3000, discount: 0, promotionName: null });
      const ticket = (await api().get(`${V}/tenant/orders/${res.body.id}/receipt`).set(as("waiter"))).body;
      expect(ticket.order.discountTotal).toBe(2000);
      // Prix figé : modifier la promotion ensuite ne change pas la commande ; la quantité garde la remise unitaire.
      await api().put(`${V}/tenant/menu/promotions/${ids.promo}`).set(as("manager")).send(promo({ value: 50 })).expect(200);
      const upd = await api().patch(`${V}/tenant/orders/${res.body.id}/items/${l.id}`).set(as("waiter")).send({ quantity: 3 });
      expect(upd.body.items.find((i: { id: string }) => i.id === l.id)).toMatchObject({ unitPrice: 3000, lineTotal: 9000, discount: 3000 });
      await api().put(`${V}/tenant/menu/promotions/${ids.promo}`).set(as("manager")).send(promo()).expect(200);
    });

    it("n'applique rien hors période (heure, jour, dates, désactivée)", async () => {
      const unit = async () => (await place([{ menuItemId: ids.poulet, quantity: 1 }])).body.items[0].unitPrice as number;
      at("19:00");
      expect(await unit()).toBe(4000);
      at("18:00");
      expect(await unit()).toBe(3000);
      clock.freeze("2026-11-12T18:00:00Z"); // jeudi
      expect(await unit()).toBe(4000);
      at("18:00");
      await api().patch(`${V}/tenant/menu/promotions/${ids.promo}`).set(as("manager")).send({ isActive: false }).expect(200);
      expect(await unit()).toBe(4000);
      await api().patch(`${V}/tenant/menu/promotions/${ids.promo}`).set(as("manager")).send({ isActive: true }).expect(200);
      await api().put(`${V}/tenant/menu/promotions/${ids.promo}`).set(as("manager")).send(promo({ startsOn: "2026-11-12" })).expect(200);
      expect(await unit()).toBe(4000);
    });

    it("promotion de catégorie en montant, meilleure remise sans cumul, prix public remisé", async () => {
      await api().put(`${V}/tenant/menu/promotions/${ids.promo}`).set(as("manager")).send(promo({ startsOn: null })).expect(200);
      const cat = await api().post(`${V}/tenant/menu/promotions`).set(as("manager")).send({ name: "Tout -500", kind: "AMOUNT", value: 500, categoryId: ids.cat });
      expect(cat.status).toBe(201);
      at("12:00");
      const res = await place([{ menuItemId: ids.riz, quantity: 1 }]);
      expect(res.body.items[0]).toMatchObject({ unitPrice: 2500, discount: 500, promotionName: "Tout -500" });
      at("18:00"); // 25 % de 4000 = 1000 > 500 : la plus avantageuse
      expect((await place([{ menuItemId: ids.poulet, quantity: 1 }])).body.items[0]).toMatchObject({ unitPrice: 3000, promotionName: "Happy hour" });
      const pub = (await api().get(`${V}/public/tenants/gargote/menu`)).body.categories[0].items.find((i: { name: string }) => i.name === "Poulet braisé");
      expect(pub.promotion).toEqual({ name: "Happy hour", unitPrice: 3000 });
      expect((await api().delete(`${V}/tenant/menu/promotions/${cat.body.id}`).set(as("manager"))).status).toBe(200);
      expect((await api().get(`${V}/tenant/menu/promotions`).set(as("kitchen"))).body).toHaveLength(1);
    });
  });
});
