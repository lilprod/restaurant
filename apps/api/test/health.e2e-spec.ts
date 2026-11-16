import { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { Readable } from "node:stream";
import { AppModule } from "../src/app.module";
import { requestLogging } from "../src/common/logging";
import { setupApp } from "../src/setup";
import { StorageDriver } from "../src/storage/storage-drivers";
import { StorageService } from "../src/storage/storage.service";
import { createApp } from "./helpers";

describe("Santé, identifiant de requête et relais /uploads du pilote S3 (e2e)", () => {
  let app: INestApplication;
  afterEach(async () => { await app?.close(); });

  it("GET /api/v1/health : public, 200, base up, Redis désactivé en mode sync", async () => {
    app = await createApp();
    const r = await request(app.getHttpServer()).get("/api/v1/health");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "ok", checks: { database: "up", redis: "disabled" } });
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(r.body)).not.toMatch(/postgres|password|secret/i);
  });

  it("répond 503 quand la base est injoignable", async () => {
    app = await createApp();
    const prisma = app.get((await import("../src/prisma/prisma.service")).PrismaService);
    jest.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("down"));
    const r = await request(app.getHttpServer()).get("/api/v1/health");
    expect([r.status, r.body.status, r.body.checks.database]).toEqual([503, "degraded", "down"]);
  });

  it("requestLogging : reprend un X-Request-Id valide, sinon en génère un ; le jeton de suivi n'est pas journalisé", async () => {
    const lines: string[] = [];
    const logger = { log: (m: string) => lines.push(m), error: (m: string) => lines.push(m), warn: () => undefined };
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const a = mod.createNestApplication<NestExpressApplication>();
    a.use(requestLogging(logger));
    setupApp(a, { CORS_ORIGIN: "http://localhost", UPLOAD_DIR: process.env.UPLOAD_DIR! });
    await a.init(); app = a;
    const ok = await request(a.getHttpServer()).get("/api/v1/public/tenants/inconnu").set("X-Request-Id", "abc-12345678");
    expect(ok.headers["x-request-id"]).toBe("abc-12345678");
    const gen = await request(a.getHttpServer()).get("/api/v1/public/tracking/SECRET-TOKEN-1234?x=1").set("X-Request-Id", "a b");
    expect(gen.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    const logged = lines.map((l) => JSON.parse(l));
    expect(logged[0]).toMatchObject({ method: "GET", requestId: "abc-12345678" });
    const joined = lines.join("\n");
    expect(joined).toContain("/tracking/:token");
    expect(joined).not.toContain("SECRET-TOKEN");
    expect(joined).not.toContain("x=1");
    await request(a.getHttpServer()).get("/api/v1/health");
    expect(lines.join("\n")).not.toContain("/health");
  });

  it("pilote S3 sans S3_PUBLIC_URL : l'API relaie /uploads avec les en-têtes de sécurité", async () => {
    const files = new Map<string, Buffer>([["platform/logo-1.png", Buffer.from("PNGDATA")]]);
    const driver: StorageDriver = {
      put: async () => undefined, delete: async () => undefined,
      get: async (k) => (files.has(k) ? { body: Readable.from(files.get(k)!), contentType: "image/png", length: files.get(k)!.length } : null),
    };
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const a = mod.createNestApplication<NestExpressApplication>();
    const env = { STORAGE_DRIVER: "s3", S3_BUCKET: "b", PUBLIC_API_URL: "http://api.test", UPLOAD_DIR: process.env.UPLOAD_DIR! };
    (mod.get(StorageService) as { driver: StorageDriver }).driver = driver;
    setupApp(a, { CORS_ORIGIN: "http://localhost", UPLOAD_DIR: env.UPLOAD_DIR, STORAGE_DRIVER: "s3" });
    await a.init(); app = a;
    const ok = await request(a.getHttpServer()).get("/uploads/platform/logo-1.png");
    expect(ok.status).toBe(200);
    expect(ok.headers).toMatchObject({ "content-type": "image/png", "x-content-type-options": "nosniff", "cache-control": "public, max-age=31536000, immutable", "content-security-policy": "default-src 'none'; sandbox" });
    expect(ok.body.toString()).toBe("PNGDATA");
    expect((await request(a.getHttpServer()).get("/uploads/platform/absent.png")).status).toBe(404);
    expect((await request(a.getHttpServer()).get("/uploads/%2e%2e/secret")).status).toBe(404);
    expect((await request(a.getHttpServer()).get("/uploads/%E0%A4%A")).status).toBe(404);
  });
});
