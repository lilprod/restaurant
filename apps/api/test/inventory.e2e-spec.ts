import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { AddressInfo } from "node:net";
import { io, Socket } from "socket.io-client";
import request from "supertest";
import { asPlatform, createApp, login, resetDb, seedPlatform } from "./helpers";

const PW = "Cigale-Bleue74";

describe("P3 Stock : recettes, déduction, alertes, fournisseurs, inventaire (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let seed: Awaited<ReturnType<typeof seedPlatform>>;
  let root: string;
  let port: number;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const sockets: Socket[] = [];
  const V = "/api/v1";
  const api = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });

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

  const ingredient = async (id: string) => (await api().get(`${V}/tenant/inventory/ingredients/${id}`).set(as("manager"))).body;
  const qty = async (id: string) => (await ingredient(id)).quantity as number;
  const order = async (items: { menuItemId: string; quantity: number; optionIds?: string[] }[]) => {
    const res = await api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "TAKEAWAY", customerName: "Kodjo", items: items.map((i) => ({ optionIds: [], ...i })) });
    expect(res.status).toBe(201);
    return res.body as { id: string; items: { id: string }[] };
  };
  const setStatus = (orderId: string, itemId: string, status: string, who = "kitchen") =>
    api().post(`${V}/tenant/orders/${orderId}/items/${itemId}/status`).set(as(who)).send({ status });
  const movements = async (q: string) => (await api().get(`${V}/tenant/inventory/movements?${q}`).set(as("manager"))).body;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await resetDb(prisma);
    seed = await seedPlatform(prisma);
    await prisma.plan.update({ where: { id: seed.pro.id }, data: { features: { inventory: true } } });
    await prisma.plan.update({ where: { id: seed.starter.id }, data: { features: { inventory: false } } });
    app = await createApp();
    await app.listen(0, "127.0.0.1");
    port = (app.getHttpServer().address() as AddressInfo).port;
    root = (await login(app, "root@test.local")).body.accessToken;
    await makeTenant("grenier", seed.pro.id);
    await makeTenant("voisin", seed.pro.id);
    await makeTenant("petit", seed.starter.id);
    tok.admin = await tenantLogin("grenier", "admin@grenier.tg");
    tok.manager = await addStaff("grenier", "manager", "MANAGER");
    tok.waiter = await addStaff("grenier", "waiter", "WAITER");
    tok.kitchen = await addStaff("grenier", "kitchen", "KITCHEN");
    tok.other = await tenantLogin("voisin", "admin@voisin.tg");
    tok.starter = await tenantLogin("petit", "admin@petit.tg");

    const cat = await api().post(`${V}/tenant/menu/categories`).set(as("manager")).send({ name: "Plats" });
    ids.cat = cat.body.id;
    const riz = await api().post(`${V}/tenant/menu/items`).set(as("manager")).send({
      categoryId: ids.cat, name: "Riz sauce arachide", price: 3500, vatRate: 10,
      optionGroups: [{ name: "Accompagnement", minChoices: 0, maxChoices: 1, options: [{ name: "Alloco", extra: 500 }, { name: "Attiéké", extra: 0 }] }],
    });
    ids.riz = riz.body.id;
    ids.alloco = riz.body.optionGroups[0].options.find((o: { name: string }) => o.name === "Alloco").id;
    ids.poulet = (await api().post(`${V}/tenant/menu/items`).set(as("manager")).send({ categoryId: ids.cat, name: "Poulet braisé", price: 5000, vatRate: 10 })).body.id;
  });
  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await app.close();
    await prisma.$disconnect();
  });

  describe("plan et droits", () => {
    it("refuse le module au plan Starter (403 PLAN_FEATURE)", async () => {
      for (const path of ["inventory/ingredients", "suppliers", "purchase-orders", `menu/items/${ids.riz}/recipe`]) {
        const res = await api().get(`${V}/tenant/${path}`).set(as("starter"));
        expect([res.status, res.body.code]).toEqual([403, "PLAN_FEATURE"]);
      }
    });

    it("crée les ingrédients (responsables), avec stock initial, validation et unicité", async () => {
      const bad = await api().post(`${V}/tenant/inventory/ingredients`).set(as("manager")).send({ name: "", unit: "sac" });
      expect(bad.status).toBe(400);
      expect(bad.body.errors.map((e: { path: string }) => e.path)).toEqual(expect.arrayContaining(["name", "unit"]));
      expect((await api().post(`${V}/tenant/inventory/ingredients`).set(as("kitchen")).send({ name: "Sel", unit: "kg" })).status).toBe(403);
      const make = async (body: object) => {
        const res = await api().post(`${V}/tenant/inventory/ingredients`).set(as("manager")).send(body);
        expect(res.status).toBe(201);
        return res.body;
      };
      ids.rizIng = (await make({ name: "Riz parfumé", unit: "kg", category: "Épicerie", avgCost: 800, lowStockThreshold: 1, initialQuantity: 10 })).id;
      ids.huile = (await make({ name: "Huile d'arachide", unit: "l", category: "Épicerie", avgCost: 1500, initialQuantity: 5 })).id;
      ids.banane = (await make({ name: "Banane plantain", unit: "piece", category: "Fruits", avgCost: 100, initialQuantity: 40 })).id;
      ids.pouletIng = (await make({ name: "Poulet", unit: "piece", category: "Viandes", avgCost: 2000, lowStockThreshold: 3, autoDisable: true, initialQuantity: 5 })).id;
      expect((await api().post(`${V}/tenant/inventory/ingredients`).set(as("manager")).send({ name: "Poulet", unit: "kg" })).status).toBe(409);
      const list = await api().get(`${V}/tenant/inventory/ingredients`).set(as("kitchen"));
      expect(list.status).toBe(200);
      expect(list.body.find((i: { id: string }) => i.id === ids.rizIng)).toMatchObject({ quantity: 10, value: 8000, state: "OK" });
      expect((await api().get(`${V}/tenant/inventory/ingredients`).set(as("waiter"))).status).toBe(403);
      expect((await movements(`ingredientId=${ids.rizIng}`)).items[0]).toMatchObject({ type: "ADJUSTMENT", quantity: 10, balanceAfter: 10, reason: "Stock initial" });
    });
  });

  describe("recettes et coût matière", () => {
    it("enregistre la recette d'un plat (unités converties) et d'une option ; coût et marge", async () => {
      const incompatible = await api().put(`${V}/tenant/menu/items/${ids.riz}/recipe`).set(as("manager")).send({ lines: [{ ingredientId: ids.rizIng, quantity: 200, unit: "ml" }] });
      expect(incompatible.status).toBe(400);
      expect(incompatible.body.errors[0].path).toBe("lines.0.unit");
      expect((await api().put(`${V}/tenant/menu/items/${ids.riz}/recipe`).set(as("kitchen")).send({ lines: [] })).status).toBe(403);
      const res = await api().put(`${V}/tenant/menu/items/${ids.riz}/recipe`).set(as("manager")).send({
        lines: [{ ingredientId: ids.rizIng, quantity: 200, unit: "g" }, { ingredientId: ids.huile, quantity: 5, unit: "cl" }],
      });
      expect(res.status).toBe(200);
      // 0,2 kg × 800 + 0,05 l × 1 500 = 160 + 75
      expect(res.body).toMatchObject({ cost: 235, net: 3182, margin: 2947 });
      const opt = await api().put(`${V}/tenant/menu/options/${ids.alloco}/recipe`).set(as("manager")).send({ lines: [{ ingredientId: ids.banane, quantity: 2 }] });
      expect(opt.body).toMatchObject({ name: "Alloco", cost: 200 });
      await api().put(`${V}/tenant/menu/items/${ids.poulet}/recipe`).set(as("manager")).send({ lines: [{ ingredientId: ids.pouletIng, quantity: 1 }] }).expect(200);
      const read = await api().get(`${V}/tenant/menu/items/${ids.riz}/recipe`).set(as("kitchen"));
      expect(read.body.options.find((o: { name: string }) => o.name === "Alloco").lines[0]).toMatchObject({ name: "Banane plantain", quantity: 2, unit: "piece" });
      const costs = await api().get(`${V}/tenant/inventory/dish-costs`).set(as("manager"));
      expect(costs.body.find((c: { menuItemId: string }) => c.menuItemId === ids.poulet)).toMatchObject({ cost: 2000, hasRecipe: true });
    });

    it("la recette d'une option suit l'option quand le plat est réenregistré", async () => {
      const res = await api().patch(`${V}/tenant/menu/items/${ids.riz}`).set(as("manager")).send({
        optionGroups: [{ name: "Accompagnement", minChoices: 0, maxChoices: 1, options: [{ name: "Alloco", extra: 600 }, { name: "Attiéké", extra: 0 }] }],
      });
      const newId = res.body.optionGroups[0].options.find((o: { name: string }) => o.name === "Alloco").id;
      expect(newId).not.toBe(ids.alloco);
      ids.alloco = newId;
      expect((await api().get(`${V}/tenant/menu/options/${newId}/recipe`).set(as("manager"))).body.lines).toHaveLength(1);
    });

    it("refuse de supprimer un ingrédient utilisé dans une recette", async () => {
      expect((await api().delete(`${V}/tenant/inventory/ingredients/${ids.banane}`).set(as("manager"))).status).toBe(409);
    });
  });

  describe("déduction dans les commandes", () => {
    it("déduit recette × quantité + options au lancement, une seule fois ; le retour en attente restitue", async () => {
      const o = await order([{ menuItemId: ids.riz, quantity: 2, optionIds: [ids.alloco] }]);
      const item = o.items[0].id;
      expect(await qty(ids.rizIng)).toBe(10); // pas de déduction à la commande
      expect((await setStatus(o.id, item, "IN_PROGRESS")).status).toBe(200);
      expect([await qty(ids.rizIng), await qty(ids.huile), await qty(ids.banane)]).toEqual([9.6, 4.9, 36]);
      const deducted = (await movements(`type=ORDER_DEDUCTION`)).items.filter((m: { orderItemId: string }) => m.orderItemId === item);
      expect(deducted).toHaveLength(3);
      expect(deducted.find((m: { ingredient: { id: string } }) => m.ingredient.id === ids.rizIng)).toMatchObject({ quantity: -0.4, balanceAfter: 9.6, reason: expect.stringContaining("Commande n°") });

      await setStatus(o.id, item, "PENDING").expect(200);
      expect([await qty(ids.rizIng), await qty(ids.huile), await qty(ids.banane)]).toEqual([10, 5, 40]);
      expect((await movements(`type=RETURN&ingredientId=${ids.banane}`)).items[0]).toMatchObject({ quantity: 4, balanceAfter: 40 });

      await setStatus(o.id, item, "READY").expect(200);                 // PENDING → READY directement : déduit
      await setStatus(o.id, item, "IN_PROGRESS").expect(200);           // retour d'un cran : rien ne bouge
      await setStatus(o.id, item, "READY").expect(200);
      expect(await qty(ids.rizIng)).toBe(9.6);
      ids.readyOrder = o.id;
      ids.readyItem = item;
    });

    it("annuler un article lancé crée une perte automatique (le stock reste consommé)", async () => {
      const waiterCancel = await api().post(`${V}/tenant/orders/${ids.readyOrder}/items/${ids.readyItem}/cancel`).set(as("waiter")).send({ reason: "Client parti" });
      expect(waiterCancel.status).toBe(403);
      await api().post(`${V}/tenant/orders/${ids.readyOrder}/items/${ids.readyItem}/cancel`).set(as("manager")).send({ reason: "Client parti" }).expect(200);
      expect(await qty(ids.rizIng)).toBe(9.6);
      const waste = (await movements(`type=WASTE`)).items.filter((m: { orderItemId: string }) => m.orderItemId === ids.readyItem);
      expect(waste).toHaveLength(3);
      expect(waste[0].reason).toMatch(/^Annulation/);
      const records = await api().get(`${V}/tenant/inventory/waste`).set(as("kitchen"));
      const riz = records.body.items.find((w: { ingredient: { id: string }; automatic: boolean }) => w.ingredient.id === ids.rizIng && w.automatic);
      expect(riz).toMatchObject({ quantity: 0.4, cost: 320 });
      // Annuler un article encore en attente : aucun mouvement.
      const o = await order([{ menuItemId: ids.riz, quantity: 1 }]);
      const before = (await movements("pageSize=1")).total;
      await api().post(`${V}/tenant/orders/${o.id}/items/${o.items[0].id}/cancel`).set(as("waiter")).send({ reason: "Erreur de saisie" }).expect(200);
      expect((await movements("pageSize=1")).total).toBe(before);
    });

    it("annuler une commande entière en cours transforme ses préparations lancées en pertes", async () => {
      const o = await order([{ menuItemId: ids.riz, quantity: 1 }, { menuItemId: ids.riz, quantity: 1, optionIds: [ids.alloco] }]);
      await setStatus(o.id, o.items[0].id, "IN_PROGRESS").expect(200);
      expect(await qty(ids.rizIng)).toBe(9.4);
      await api().post(`${V}/tenant/orders/${o.id}/cancel`).set(as("manager")).send({ reason: "Coupure de courant" }).expect(200);
      expect(await qty(ids.rizIng)).toBe(9.4);
      expect(await qty(ids.banane)).toBe(36); // l'article en attente (avec Alloco) n'avait rien consommé
      const waste = (await movements("type=WASTE")).items.filter((m: { orderItemId: string }) => m.orderItemId === o.items[0].id);
      expect(waste.map((m: { ingredient: { id: string } }) => m.ingredient.id).sort()).toEqual([ids.rizIng, ids.huile].sort());
    });

    it("préparations simultanées sur le même ingrédient : solde final exact, soldes successifs cohérents", async () => {
      const start = await qty(ids.rizIng);
      const orders = await Promise.all(Array.from({ length: 6 }, () => order([{ menuItemId: ids.riz, quantity: 1 }, { menuItemId: ids.riz, quantity: 2 }])));
      const res = await Promise.all(orders.flatMap((o, n) => (n % 2
        ? [api().post(`${V}/tenant/orders/${o.id}/advance`).set(as("kitchen")).send({ status: "IN_PROGRESS" })]
        : o.items.map((i) => setStatus(o.id, i.id, "IN_PROGRESS")))));
      expect(res.every((r) => r.status === 200)).toBe(true);
      // 6 commandes × 3 portions × 0,2 kg
      expect(await qty(ids.rizIng)).toBeCloseTo(start - 3.6, 3);
      const m = (await movements(`ingredientId=${ids.rizIng}&type=ORDER_DEDUCTION&pageSize=100`)).items.slice(0, 12);
      const balances = m.map((x: { balanceAfter: number }) => x.balanceAfter).sort((a: number, b: number) => a - b);
      expect(new Set(balances).size).toBe(12); // aucun solde « perdu » (pas de lecture concurrente du même stock)
      expect(balances[0]).toBeCloseTo(start - 3.6, 3);
    });
  });

  describe("alertes et désactivation automatique", () => {
    let socket: Socket;
    let otherSocket: Socket;
    const events: { event: string; payload: any }[] = [];
    const otherEvents: string[] = [];

    beforeAll(async () => {
      socket = await connect(tok.kitchen);
      otherSocket = await connect(tok.other);
      socket.onAny((event, payload) => events.push({ event, payload }));
      otherSocket.onAny((event) => otherEvents.push(event));
    });
    const lowCount = () => events.filter((e) => e.event === "stock.low" && e.payload.id === ids.pouletIng).length;
    const launchPoulet = async () => {
      const o = await order([{ menuItemId: ids.poulet, quantity: 1 }]);
      const updated = next(socket, "stock.updated", (p: { ingredients: { id: string }[] }) => p.ingredients.some((i) => i.id === ids.pouletIng));
      await setStatus(o.id, o.items[0].id, "IN_PROGRESS").expect(200);
      await updated; // stock.low éventuel est émis avant stock.updated
    };

    it("émet stock.low une seule fois par franchissement de seuil, et le réarme au-dessus", async () => {
      await launchPoulet(); // 5 → 4
      expect(lowCount()).toBe(0);
      await launchPoulet(); // 4 → 3 : franchissement
      expect(lowCount()).toBe(1);
      expect(events.find((e) => e.event === "stock.low")!.payload).toMatchObject({ name: "Poulet", quantity: 3, state: "LOW" });
      expect(events.find((e) => e.event === "stock.low")!.payload.avgCost).toBeUndefined();
      await launchPoulet(); // 3 → 2 : toujours bas, pas de nouvelle alerte
      expect(lowCount()).toBe(1);
      const alerts = await api().get(`${V}/tenant/inventory/alerts`).set(as("kitchen"));
      expect(alerts.body.find((a: { id: string }) => a.id === ids.pouletIng)).toMatchObject({ state: "LOW", suggestedQty: 4 });
      const updated = next(socket, "stock.updated");
      await api().post(`${V}/tenant/inventory/ingredients/${ids.pouletIng}/adjust`).set(as("manager")).send({ delta: 5, reason: "Livraison du marché" }).expect(200);
      await updated; // 7 : réarmée
      await launchPoulet(); await launchPoulet(); await launchPoulet(); // 6, 5, 4
      expect(lowCount()).toBe(1);
      await launchPoulet(); // 3 : nouveau franchissement
      expect(lowCount()).toBe(2);
      expect(otherEvents.filter((e) => e.startsWith("stock.") || e === "menu.updated")).toEqual([]);
    });

    it("à zéro, autoDisable rend le plat indisponible partout en temps réel ; le stock peut devenir négatif", async () => {
      await launchPoulet(); await launchPoulet(); // 2, 1
      const disabled = next(socket, "menu.updated", (p: { id: string; isAvailable: boolean }) => p.id === ids.poulet && !p.isAvailable);
      const o = await order([{ menuItemId: ids.poulet, quantity: 2 }]);
      await setStatus(o.id, o.items[0].id, "IN_PROGRESS").expect(200); // 1 → −1 : le service n'est pas bloqué
      await disabled;
      expect(await ingredient(ids.pouletIng)).toMatchObject({ quantity: -1, state: "NEGATIVE", value: 0 });
      const res = await api().post(`${V}/tenant/orders`).set(as("waiter")).send({ type: "TAKEAWAY", items: [{ menuItemId: ids.poulet, quantity: 1, optionIds: [] }] });
      expect(res.status).toBe(409);
      expect(otherEvents).toEqual([]);
    });
  });

  describe("fournisseurs et commandes fournisseurs", () => {
    it("gère les fournisseurs (responsables)", async () => {
      expect((await api().post(`${V}/tenant/suppliers`).set(as("kitchen")).send({ name: "Marché d'Adawlato" })).status).toBe(403);
      const s = await api().post(`${V}/tenant/suppliers`).set(as("manager")).send({ name: "Marché d'Adawlato", phone: "+22890000000", email: "" });
      expect(s.status).toBe(201);
      ids.supplier = s.body.id;
      await api().patch(`${V}/tenant/inventory/ingredients/${ids.pouletIng}`).set(as("manager")).send({ supplierId: ids.supplier }).expect(200);
      expect((await api().get(`${V}/tenant/suppliers`).set(as("kitchen"))).body[0]).toMatchObject({ name: "Marché d'Adawlato", ingredientCount: 1 });
    });

    it("réception partielle puis totale : stock, coût moyen pondéré et statut", async () => {
      const po = await api().post(`${V}/tenant/purchase-orders`).set(as("manager")).send({
        supplierId: ids.supplier, lines: [{ ingredientId: ids.pouletIng, quantity: 10, unitCost: 2600 }, { ingredientId: ids.rizIng, quantity: 25, unitCost: 900 }],
      });
      expect(po.status).toBe(201);
      expect(po.body).toMatchObject({ status: "DRAFT", total: 48500 });
      const id = po.body.id as string;
      const line = (ing: string) => po.body.lines.find((l: { ingredient: { id: string } }) => l.ingredient.id === ing).id;
      await api().post(`${V}/tenant/purchase-orders/${id}/send`).set(as("manager")).expect(200);
      expect((await api().patch(`${V}/tenant/purchase-orders/${id}`).set(as("manager")).send({ notes: "x" })).status).toBe(409);

      const rizBefore = await ingredient(ids.rizIng);
      const partial = await api().post(`${V}/tenant/purchase-orders/${id}/receive`).set(as("manager")).send({ lines: [{ lineId: line(ids.pouletIng), quantity: 6 }] });
      expect(partial.body.status).toBe("PARTIAL");
      // Stock négatif (−1) compté pour zéro : coût moyen = prix d'achat.
      expect(await ingredient(ids.pouletIng)).toMatchObject({ quantity: 5, avgCost: 2600 });
      const done = await api().post(`${V}/tenant/purchase-orders/${id}/receive`).set(as("manager")).send({
        lines: [{ lineId: line(ids.pouletIng), quantity: 4, unitCost: 3100 }, { lineId: line(ids.rizIng), quantity: 25 }],
      });
      expect(done.body.status).toBe("RECEIVED");
      // (5 × 2 600 + 4 × 3 100) / 9 = 2 822
      expect(await ingredient(ids.pouletIng)).toMatchObject({ quantity: 9, avgCost: 2822, state: "OK" });
      const rizAfter = await ingredient(ids.rizIng);
      expect(rizAfter.quantity).toBeCloseTo(rizBefore.quantity + 25, 3);
      expect(rizAfter.avgCost).toBe(Math.round((rizBefore.quantity * 800 + 25 * 900) / (rizBefore.quantity + 25)));
      expect((await api().post(`${V}/tenant/purchase-orders/${id}/receive`).set(as("manager")).send({ lines: [{ lineId: line(ids.rizIng), quantity: 1 }] })).status).toBe(409);
      expect((await movements(`type=PURCHASE&ingredientId=${ids.pouletIng}`)).items).toHaveLength(2);
    });
  });

  describe("pertes et inventaire", () => {
    it("la cuisine déclare une perte (convertie et valorisée) ; la salle ne peut pas", async () => {
      expect((await api().post(`${V}/tenant/inventory/waste`).set(as("waiter")).send({ ingredientId: ids.huile, quantity: 1, reason: "Renversée" })).status).toBe(403);
      const before = await qty(ids.huile);
      const res = await api().post(`${V}/tenant/inventory/waste`).set(as("kitchen")).send({ ingredientId: ids.huile, quantity: 50, unit: "cl", reason: "Bouteille renversée" });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ quantity: 0.5, cost: 750 });
      expect(await qty(ids.huile)).toBeCloseTo(before - 0.5, 3);
      expect((await api().post(`${V}/tenant/inventory/waste`).set(as("kitchen")).send({ ingredientId: ids.huile, quantity: 1, unit: "g", reason: "xx" })).status).toBe(400);
    });

    it("l'inventaire physique produit des ajustements valorisés", async () => {
      const c = await api().post(`${V}/tenant/inventory/counts`).set(as("manager")).send({ category: "Épicerie" });
      expect(c.status).toBe(201);
      expect(c.body.lines.map((l: { ingredient: { name: string } }) => l.ingredient.name)).toEqual(["Huile d'arachide", "Riz parfumé"]);
      expect((await api().post(`${V}/tenant/inventory/counts`).set(as("manager")).send({})).status).toBe(409);
      expect((await api().post(`${V}/tenant/inventory/counts`).set(as("kitchen")).send({})).status).toBe(403);
      const huile = await ingredient(ids.huile);
      await api().patch(`${V}/tenant/inventory/counts/${c.body.id}/lines`).set(as("manager")).send({ lines: [{ ingredientId: ids.huile, countedQty: 4 }] }).expect(200);
      const v = await api().post(`${V}/tenant/inventory/counts/${c.body.id}/validate`).set(as("manager"));
      expect(v.status).toBe(200);
      const delta = Math.round((4 - huile.quantity) * 1000) / 1000;
      expect(v.body).toMatchObject({ status: "VALIDATED", varianceCost: Math.round(delta * huile.avgCost) });
      expect(await qty(ids.huile)).toBe(4);
      expect((await movements(`type=ADJUSTMENT&ingredientId=${ids.huile}`)).items[0]).toMatchObject({ quantity: delta, balanceAfter: 4, stockCountId: c.body.id });
      expect((await api().post(`${V}/tenant/inventory/counts/${c.body.id}/validate`).set(as("manager"))).status).toBe(409);
    });
  });

  describe("isolation entre restaurants", () => {
    it("un autre restaurant ne voit ni ne modifie rien", async () => {
      expect((await api().get(`${V}/tenant/inventory/ingredients`).set(as("other"))).body).toEqual([]);
      expect((await api().get(`${V}/tenant/inventory/ingredients/${ids.rizIng}`).set(as("other"))).status).toBe(404);
      expect((await api().get(`${V}/tenant/inventory/movements`).set(as("other"))).body.total).toBe(0);
      expect((await api().put(`${V}/tenant/menu/items/${ids.riz}/recipe`).set(as("other")).send({ lines: [] })).status).toBe(404);
      expect((await api().post(`${V}/tenant/inventory/waste`).set(as("other")).send({ ingredientId: ids.rizIng, quantity: 1, reason: "Vol" })).status).toBe(404);
      expect((await api().get(`${V}/tenant/suppliers`).set(as("other"))).body).toEqual([]);
      const cat = await api().post(`${V}/tenant/menu/categories`).set(as("other")).send({ name: "Plats" });
      const dish = await api().post(`${V}/tenant/menu/items`).set(as("other")).send({ categoryId: cat.body.id, name: "Fufu", price: 2000 });
      expect((await api().put(`${V}/tenant/menu/items/${dish.body.id}/recipe`).set(as("other")).send({ lines: [{ ingredientId: ids.rizIng, quantity: 1 }] })).status).toBe(404);
    });
  });
});
