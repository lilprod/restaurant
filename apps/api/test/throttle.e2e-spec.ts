import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { createApp, resetDb, seedPlatform } from "./helpers";

const V = "/api/v1";

/** Plafonds de connexion : 10/min par couple IP + email, 60/min par IP (la limitation est coupée par défaut dans les tests). */
describe("limitation des tentatives de connexion (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const attempt = (email: string) => request(app.getHttpServer()).post(`${V}/tenant/auth/login`).send({ tenantSlug: "nimes", email, password: "Mauvais-Mot2Passe" });

  beforeAll(async () => {
    prisma = new PrismaClient();
    await resetDb(prisma);
    await seedPlatform(prisma);
    delete process.env.DISABLE_THROTTLE;   // activé seulement dans ce fichier
    app = await createApp();
  });
  afterAll(async () => {
    process.env.DISABLE_THROTTLE = "1";
    await app.close();
    await prisma.$disconnect();
  });

  it("bloque la 11e tentative sur le même email sans gêner les autres comptes du réseau, puis plafonne l'IP à 60/min", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await attempt("cuisine@nimes.tg")).status);
    expect(codes.slice(0, 10).every((c) => c !== 429)).toBe(true);
    expect(codes[10]).toBe(429);
    // la casse de l'email ne contourne pas le plafond
    expect((await attempt("CUISINE@nimes.tg")).status).toBe(429);
    // un autre email derrière la même IP n'est pas touché (12 requêtes jusqu'ici)
    expect((await attempt("salle@nimes.tg")).status).not.toBe(429);

    // plafond par IP : 60 requêtes par minute au total
    for (let i = 0; i < 47; i++) expect((await attempt(`u${i}@nimes.tg`)).status).not.toBe(429);   // 13 + 47 = 60
    expect((await attempt("u-final@nimes.tg")).status).toBe(429);
  });

  it("limite les routes publiques de l'espace client (inscription 5/h, suivi 60/min)", async () => {
    const signup = () => request(app.getHttpServer()).post(`${V}/public/tenants/inconnu/customers`).send({});
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await signup()).status);
    expect(codes.slice(0, 5).every((c) => c !== 429)).toBe(true);
    expect(codes[5]).toBe(429);
    const track = () => request(app.getHttpServer()).get(`${V}/public/tracking/${"a".repeat(43)}`);
    const t: number[] = [];
    for (let i = 0; i < 61; i++) t.push((await track()).status);
    expect(t.slice(0, 60).every((c) => c === 404)).toBe(true);
    expect(t[60]).toBe(429);
  });
});
