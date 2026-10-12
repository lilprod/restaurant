import { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { setupApp } from "../src/setup";

export async function createApp() {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication<NestExpressApplication>();
  setupApp(app, { CORS_ORIGIN: "http://localhost", UPLOAD_DIR: process.env.UPLOAD_DIR! });
  await app.init();
  return app;
}

/** Vide toutes les tables (hors historique de migrations). */
export async function resetDb(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) throw new Error("Base de test vide : lancez `pnpm test:e2e` (applique les migrations d'abord)");
  const list = rows.map((r) => `"${r.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

export async function seedPlatform(prisma: PrismaClient) {
  const hash = await argon2.hash("Secret123!");
  const admin = await prisma.platformUser.create({
    data: { email: "root@test.local", passwordHash: hash, firstName: "Root", lastName: "Admin", role: "SUPER_ADMIN" },
  });
  const support = await prisma.platformUser.create({
    data: { email: "support@test.local", passwordHash: hash, firstName: "Sup", lastName: "Port", role: "SUPPORT" },
  });
  const starter = await prisma.plan.create({
    data: { code: "STARTER", name: "Starter", priceMonthly: 15000, priceYearly: 150000, trialDays: 14, sortOrder: 1 },
  });
  const pro = await prisma.plan.create({
    data: { code: "PRO", name: "Pro", priceMonthly: 35000, priceYearly: 350000, trialDays: 14, sortOrder: 2 },
  });
  const noTrial = await prisma.plan.create({
    data: { code: "NOTRIAL", name: "Sans essai", priceMonthly: 10000, priceYearly: 100000, trialDays: 0, sortOrder: 3 },
  });
  return { admin, support, starter, pro, noTrial };
}

export async function login(app: INestApplication, email: string, password = "Secret123!"): Promise<request.Response> {
  const res = await request(app.getHttpServer()).post("/api/v1/platform/auth/login").send({ email, password });
  return res;
}

/** Lecture « plateforme » directe en base (la RLS masque sinon les tables des tenants). */
export function asPlatform<T>(prisma: PrismaClient, fn: (tx: PrismaClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    return fn(tx as unknown as PrismaClient);
  });
}
