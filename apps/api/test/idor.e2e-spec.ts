import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import request from "supertest";
import { buildApiDocument } from "../src/setup";
import { asPlatform, createApp, login, resetDb, seedPlatform } from "./helpers";

/**
 * Anti-IDOR automatisé : parcourt TOUTES les routes déclarées (document OpenAPI construit à partir des contrôleurs).
 * 1. Sans jeton, toute route `/tenant/*` et `/platform/*` (hors authentification) répond 401.
 * 2. Avec les comptes du restaurant A (administrateur, client), chaque route `/tenant/*` à paramètre, appelée avec des
 *    identifiants réels du restaurant B (un par table), ne répond jamais 2xx.
 * 3. Les listes (GET sans paramètre) de A ne contiennent aucun identifiant de B.
 * Limite : les routes d'écriture reçoivent un corps vide ; si la validation du corps échoue (400) avant la recherche,
 * la route est seulement prouvée « sans 2xx ». Les tests de chaque domaine couvrent l'isolation avec des corps valides.
 */
const V = "/api/v1";
const PW = "Cigale-Bleue74";
const METHODS = ["get", "post", "put", "patch", "delete"] as const;
type Method = (typeof METHODS)[number];
/** Routes ouvertes au rôle CUSTOMER : son espace et son compte. */
const CUSTOMER_ROUTES = ["customer/", "account/"];

describe("Anti-IDOR : toutes les routes, identifiants d'un autre restaurant (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let routes: { method: Method; path: string }[];
  let bIds: string[];
  let bSample: string[];
  let aSample: string[];
  const tok: Record<string, string> = {};
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: process.env.TEST_ADMIN_DATABASE_URL });
    await resetDb(prisma);
    const seed = await seedPlatform(prisma);
    app = await createApp();
    const root = (await login(app, "root@test.local")).body.accessToken as string;

    // Restaurant A (API SuperAdmin) + un client ; restaurant B rempli par le jeu de démonstration et quelques opérations.
    const a = await api().post(`${V}/platform/tenants`).set({ Authorization: `Bearer ${root}` }).send({
      name: "Resto A", slug: "idora", email: "contact@idora.tg", planId: seed.pro.id,
      admin: { firstName: "Ama", lastName: "Koffi", email: "admin@idora.tg", password: PW },
    });
    expect([a.status, a.body.errors]).toEqual([201, undefined]);
    await asPlatform(prisma, (tx) => tx.user.updateMany({ where: { tenantId: a.body.id }, data: { mustChangePassword: false } }));
    for (const args of [["idora"], ["idorb", "--create"]]) {
      execFileSync("npx", ["tsx", join(__dirname, "../prisma/seed-demo.ts"), ...args], {
        env: { ...process.env, DATABASE_URL: process.env.TEST_ADMIN_DATABASE_URL }, stdio: "ignore",
      });
    }
    const tenantLogin = async (slug: string, email: string, password: string) => {
      const r = await api().post(`${V}/tenant/auth/login`).send({ tenantSlug: slug, email, password });
      expect([r.status, r.body.restriction]).toEqual([200, null]);   // session complète : sinon tout répondrait 403
      return r.body.accessToken as string;
    };
    tok.admin = await tenantLogin("idora", "admin@idora.tg", PW);
    const signup = await api().post(`${V}/public/tenants/idora/customers`).send({
      firstName: "Awa", lastName: "Client", email: "awa@idora.tg", password: PW, consent: true,
    });
    expect([signup.status, signup.body.errors]).toEqual([201, undefined]);
    tok.customer = await tenantLogin("idora", "awa@idora.tg", PW);
    const bWaiter = await tenantLogin("idorb", "waiter@idorb.demo", "Demo-Resto-2026");
    const bAdmin = await tenantLogin("idorb", "admin@idorb.demo", "Demo-Resto-2026");
    const b = await prisma.tenant.findUniqueOrThrow({ where: { slug: "idorb" } });
    const item = await asPlatform(prisma, (tx) => tx.menuItem.findFirstOrThrow({ where: { tenantId: b.id, optionGroups: { none: {} } } }));
    const order = await api().post(`${V}/tenant/orders`).set({ Authorization: `Bearer ${bWaiter}` })
      .send({ type: "TAKEAWAY", customerName: "Kossi", items: [{ menuItemId: item.id, quantity: 1 }] });
    expect([order.status, order.body.errors]).toEqual([201, undefined]);
    await api().get(`${V}/tenant/orders/${order.body.id}/tracking-link`).set({ Authorization: `Bearer ${bWaiter}` }).expect(200);
    await api().post(`${V}/tenant/reservations`).set({ Authorization: `Bearer ${bAdmin}` })
      .send({ guestName: "Kossi", guestPhone: "90 11 22 33", partySize: 2, source: "WALK_IN", force: true, overrideReason: "test" });

    // Témoin dans A : une commande (lectures par identifiant qui doivent aboutir).
    const aItem = await asPlatform(prisma, (tx) => tx.menuItem.findFirstOrThrow({ where: { tenantId: a.body.id, optionGroups: { none: {} } } }));
    const aOrder = await api().post(`${V}/tenant/orders`).set({ Authorization: `Bearer ${tok.admin}` })
      .send({ type: "TAKEAWAY", items: [{ menuItemId: aItem.id, quantity: 1 }] });
    expect(aOrder.status).toBe(201);

    // Identifiants de B : toutes les lignes de toutes les tables à tenantId (et B lui-même).
    const tables = await prisma.$queryRaw<{ table: string }[]>`
      SELECT c.table_name AS "table" FROM information_schema.columns c
      JOIN information_schema.columns i ON i.table_name = c.table_name AND i.table_schema = 'public' AND i.column_name = 'id'
      WHERE c.table_schema = 'public' AND c.column_name = 'tenantId' ORDER BY 1`;
    const idsOf = (tenantId: string) => asPlatform(prisma, async (tx) => {
      const out: string[][] = [];
      for (const { table } of tables) {
        const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id::text AS id FROM "${table}" WHERE "tenantId" = $1`, tenantId);
        out.push(rows.map((r) => r.id));
      }
      return out;
    });
    const perTable = await idsOf(b.id);
    bIds = [b.id, ...perTable.flat()];
    bSample = [b.id, ...perTable.filter((ids) => ids.length).map((ids) => ids[0])];
    aSample = [aOrder.body.id, ...(await idsOf(a.body.id)).filter((ids) => ids.length).map((ids) => ids[0])];
    expect(bSample.length).toBeGreaterThan(10);

    const doc = buildApiDocument(app) as { paths: Record<string, Partial<Record<Method, unknown>>> };
    routes = Object.entries(doc.paths).flatMap(([path, ops]) => METHODS.filter((m) => ops[m]).map((method) => ({ method, path })));
    expect(routes.length).toBeGreaterThan(150);
  }, 120_000);
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const call = (method: Method, path: string, token?: string) => {
    const r = api()[method](path);
    if (token) r.set("Authorization", `Bearer ${token}`);
    return method === "get" || method === "delete" ? r : r.send({});
  };
  const isAuthRoute = (p: string) => /^\/api\/v1\/(tenant|platform)\/auth\//.test(p);

  it("toute route restaurant ou plateforme hors authentification exige un jeton (401)", async () => {
    const open: string[] = [];
    for (const { method, path } of routes) {
      if (!/^\/api\/v1\/(tenant|platform)\//.test(path) || isAuthRoute(path)) continue;
      const url = path.replace(/\{[^}]+\}/g, "00000000-0000-4000-8000-000000000000");
      const res = await call(method, url);
      if (res.status !== 401) open.push(`${method.toUpperCase()} ${path} → ${res.status}`);
    }
    expect(open).toEqual([]);
  }, 120_000);

  it("aucune route /tenant/* à paramètre ne répond 2xx avec un identifiant d'un autre restaurant", async () => {
    const leaks: string[] = [];
    let calls = 0;
    for (const { method, path } of routes) {
      if (!path.startsWith(`${V}/tenant/`) || !path.includes("{") || isAuthRoute(path)) continue;
      const token = path.startsWith(`${V}/tenant/customer/`) ? tok.customer : tok.admin;
      for (const id of bSample) {
        const res = await call(method, path.replace(/\{[^}]+\}/g, id), token);
        calls += 1;
        if (res.status >= 200 && res.status < 300) leaks.push(`${method.toUpperCase()} ${path} [${id}] → ${res.status}`);
      }
    }
    expect(calls).toBeGreaterThan(1000);
    expect(leaks).toEqual([]);
    // Témoin : les mêmes lectures avec les identifiants de A aboutissent (le harnais sait détecter un 2xx).
    let own = 0;
    for (const { method, path } of routes) {
      if (method !== "get" || !path.startsWith(`${V}/tenant/`) || !path.includes("{") || path.startsWith(`${V}/tenant/customer/`)) continue;
      for (const id of aSample) if ((await call("get", path.replace(/\{[^}]+\}/g, id), tok.admin)).status === 200) own += 1;
    }
    expect(own).toBeGreaterThan(3);
  }, 300_000);

  it("un compte client (inscription publique) n'atteint aucune route du personnel (403)", async () => {
    const reached: string[] = [];
    for (const { method, path } of routes) {
      if (!path.startsWith(`${V}/tenant/`) || isAuthRoute(path) || CUSTOMER_ROUTES.some((p) => path.startsWith(`${V}/tenant/${p}`))) continue;
      const res = await call(method, path.replace(/\{[^}]+\}/g, "00000000-0000-4000-8000-000000000000"), tok.customer);
      if (res.status !== 403) reached.push(`${method.toUpperCase()} ${path} → ${res.status}`);
    }
    expect(reached).toEqual([]);
  }, 120_000);

  it("les lectures sans paramètre de A ne renvoient aucun identifiant de B", async () => {
    const leaks: string[] = [];
    let ok = 0;
    for (const { method, path } of routes) {
      if (method !== "get" || !path.startsWith(`${V}/tenant/`) || path.includes("{")) continue;
      for (const who of ["admin", "customer"]) {
        const res = await call("get", path, tok[who]);
        if (res.status === 200) ok += 1;
        const text = res.text ?? "";
        const found = bIds.find((id) => text.includes(id));
        if (found) leaks.push(`GET ${path} (${who}) contient ${found}`);
      }
    }
    expect(ok).toBeGreaterThan(25);          // les comptes de A sont réellement autorisés (sinon le test ne prouverait rien)
    expect(leaks).toEqual([]);
  }, 120_000);
});
