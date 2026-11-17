import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { IDEMPOTENCY_TTL_MS } from "../src/common/idempotency.interceptor";
import { RetentionService } from "../src/security/retention.service";
import { asPlatform, createApp, login, resetDb, seedPlatform } from "./helpers";

const PW = "Cigale-Bleue74";

describe("X5 : Idempotency-Key (commandes, ajouts d'articles, paiements)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let seed: Awaited<ReturnType<typeof seedPlatform>>;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const V = "/api/v1";
  const api = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  const countOrders = (tenantId: string) => asPlatform(prisma, (tx) => tx.order.count({ where: { tenantId } }));
  const key = (n: string) => `test-${n}-${Math.random().toString(36).slice(2, 12)}`;

  const makeTenant = async (slug: string, root: string) => {
    const res = await api().post(`${V}/platform/tenants`).set({ Authorization: `Bearer ${root}` }).send({
      name: slug, slug, email: `contact@${slug}.tg`, planId: seed.starter.id,
      admin: { firstName: "Ama", lastName: "Koffi", email: `admin@${slug}.tg`, password: PW },
    });
    expect(res.status).toBe(201);
    await asPlatform(prisma, (tx) => tx.user.updateMany({ where: { tenantId: res.body.id }, data: { mustChangePassword: false } }));
    const l = await api().post(`${V}/tenant/auth/login`).send({ tenantSlug: slug, email: `admin@${slug}.tg`, password: PW });
    return { id: res.body.id as string, token: l.body.accessToken as string };
  };

  beforeAll(async () => {
    prisma = new PrismaClient();
    await resetDb(prisma);
    seed = await seedPlatform(prisma);
    app = await createApp();
    const root = (await login(app, "root@test.local")).body.accessToken;
    const a = await makeTenant("maquis", root);
    const b = await makeTenant("buvette", root);
    ids.a = a.id; ids.b = b.id; tok.admin = a.token; tok.other = b.token;
    const cat = await api().post(`${V}/tenant/menu/categories`).set(as("admin")).send({ name: "Plats" });
    const item = await api().post(`${V}/tenant/menu/items`).set(as("admin")).send({ categoryId: cat.body.id, name: "Fufu", price: 3000 });
    ids.fufu = item.body.id;
    await api().post(`${V}/tenant/register/open`).set(as("admin")).send({ opening: 0 });
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  const create = (k: string | undefined, qty = 1, token = "admin") =>
    api().post(`${V}/tenant/orders`).set({ ...as(token), ...(k ? { "Idempotency-Key": k } : {}) }).send({ type: "TAKEAWAY", items: [{ menuItemId: ids.fufu, quantity: qty }] });

  it("une commande rejouée avec la même clé renvoie la même réponse, sans doublon", async () => {
    const k = key("order");
    const first = await create(k);
    expect(first.status).toBe(201);
    const again = await create(k);
    expect([again.status, again.headers["idempotent-replayed"]]).toEqual([201, "true"]);
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.number).toBe(first.body.number);
    expect(first.headers["idempotent-replayed"]).toBeUndefined();
    expect(await countOrders(ids.a)).toBe(1);
  });

  it("sans en-tête, deux commandes identiques restent deux commandes (comportement inchangé)", async () => {
    await create(undefined); await create(undefined);
    expect(await countOrders(ids.a)).toBe(3);
  });

  it("dix rejeux simultanés de la même clé ne créent qu'une seule commande", async () => {
    const before = await countOrders(ids.a);
    const k = key("burst");
    const rs = await Promise.all(Array.from({ length: 10 }, () => create(k)));
    // Une réponse 201 (premier) ; les autres : 201 rejoué, ou 409 « déjà en cours » (à réessayer).
    expect(rs.every((r) => [201, 409].includes(r.status))).toBe(true);
    expect(rs.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);
    expect(await countOrders(ids.a)).toBe(before + 1);
    const replay = await create(k);
    expect(replay.status).toBe(201);
    expect(await countOrders(ids.a)).toBe(before + 1);
  });

  it("la même clé avec un autre corps est refusée (422) ; une clé invalide (400)", async () => {
    const k = key("body");
    expect((await create(k, 1)).status).toBe(201);
    expect((await create(k, 2)).status).toBe(422);
    expect((await create("court")).status).toBe(400);
  });

  it("une erreur n'est pas mémorisée : après correction, la même clé fonctionne", async () => {
    const k = key("fail");
    const bad = await api().post(`${V}/tenant/orders`).set({ ...as("admin"), "Idempotency-Key": k }).send({ type: "DINE_IN", items: [{ menuItemId: ids.fufu, quantity: 1 }] });
    expect(bad.status).toBe(400);
    const ok = await api().post(`${V}/tenant/orders`).set({ ...as("admin"), "Idempotency-Key": k }).send({ type: "TAKEAWAY", items: [{ menuItemId: ids.fufu, quantity: 1 }] });
    expect(ok.status).toBe(201);                               // corps corrigé, même clé : la clé avait été libérée
  });

  it("l'ajout d'articles et le paiement sont idempotents", async () => {
    const o = (await create(undefined)).body;
    const kAdd = key("add");
    const add = () => api().post(`${V}/tenant/orders/${o.id}/items`).set({ ...as("admin"), "Idempotency-Key": kAdd }).send({ items: [{ menuItemId: ids.fufu, quantity: 2 }] });
    const a1 = await add(); const a2 = await add();
    expect([a1.status, a2.status, a2.headers["idempotent-replayed"]]).toEqual([200, 200, "true"]);
    expect(a2.body.items).toHaveLength(2);                     // 1 ligne initiale + 1 ajoutée, pas 3
    const total = a1.body.total;
    expect(total).toBe(9000);

    const kPay = key("pay");
    const pay = () => api().post(`${V}/tenant/orders/${o.id}/payments`).set({ ...as("admin"), "Idempotency-Key": kPay }).send({ method: "CARD", amount: total });
    const p1 = await pay(); const p2 = await pay();
    expect([p1.status, p2.status, p2.headers["idempotent-replayed"]]).toEqual([201, 201, "true"]);
    expect(p2.body.id).toBe(p1.body.id);
    const final = (await api().get(`${V}/tenant/orders/${o.id}`).set(as("admin"))).body;
    expect([final.paidAmount, final.payments.length]).toEqual([total, 1]);   // sans clé, le 2e paiement aurait été refusé (409) ; ici, un seul paiement
  });

  it("une clé est propre à un restaurant : le même identifiant dans un autre restaurant est indépendant", async () => {
    const k = key("tenant");
    expect((await create(k)).status).toBe(201);
    // Le restaurant B n'a pas de plat : sa requête échoue (400/404) mais jamais avec la réponse du restaurant A.
    const other = await create(k, 1, "other");
    expect(other.headers["idempotent-replayed"]).toBeUndefined();
    expect(other.status).not.toBe(201);
    const rows = await asPlatform(prisma, (tx) => tx.idempotencyKey.findMany({ where: { key: k } }));
    expect(rows.map((r) => r.tenantId)).toEqual([ids.a]);
  });

  it("sans jeton : 401 (la clé ne contourne pas l'authentification)", async () => {
    const r = await api().post(`${V}/tenant/orders`).set({ "Idempotency-Key": key("anon") }).send({ type: "TAKEAWAY", items: [] });
    expect(r.status).toBe(401);
  });

  it("les clés échues (24 h) sont purgées et redeviennent libres", async () => {
    const k = key("purge");
    const first = await create(k);
    await asPlatform(prisma, (tx) => tx.idempotencyKey.updateMany({ where: { key: k }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    const purged = await app.get(RetentionService).purge();
    expect(purged.idempotencyKeys).toBeGreaterThanOrEqual(1);
    const again = await create(k);
    expect(again.status).toBe(201);
    expect(again.body.id).not.toBe(first.body.id);
    expect(IDEMPOTENCY_TTL_MS).toBe(86_400_000);
  });
});
