import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { resetDb } from "./helpers";

/** Vérifie que prisma/sql/rls.sql isole réellement les données entre tenants. */
describe("Isolation multi-tenant (RLS)", () => {
  const admin = new PrismaClient();
  let app: PrismaClient;
  let a: string;
  let b: string;

  beforeAll(async () => {
    await resetDb(admin);
    execFileSync("psql", [process.env.DATABASE_URL!, "-v", "ON_ERROR_STOP=1", "-q", "-f", join(__dirname, "../prisma/sql/rls.sql")]);
    await admin.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_rls') THEN
        CREATE ROLE app_rls LOGIN PASSWORD 'rls' NOSUPERUSER;
      END IF; END $$`);
    await admin.$executeRawUnsafe(`GRANT ALL ON ALL TABLES IN SCHEMA public TO app_rls`);
    a = (await admin.tenant.create({ data: { name: "A", slug: "a", email: "a@a.tg" } })).id;
    b = (await admin.tenant.create({ data: { name: "B", slug: "b", email: "b@b.tg" } })).id;
    for (const [tenantId, email] of [[a, "u@a.tg"], [b, "u@b.tg"]]) {
      await admin.user.create({ data: { tenantId, email, passwordHash: "x", firstName: "U", lastName: "X", role: "ADMIN" } });
    }
    const url = new URL(process.env.DATABASE_URL!);
    url.username = "app_rls";
    url.password = "rls";
    app = new PrismaClient({ datasourceUrl: url.toString() });
  });
  afterAll(async () => {
    await app.$disconnect();
    await admin.$disconnect();
  });

  const as = <T>(tenantId: string | null, fn: (tx: PrismaClient) => Promise<T>) =>
    app.$transaction(async (tx) => {
      if (tenantId) await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx as unknown as PrismaClient);
    });

  it("sans contexte tenant, aucune ligne n'est visible", async () => {
    expect(await as(null, (tx) => tx.user.findMany())).toHaveLength(0);
  });
  it("chaque tenant ne voit que ses propres lignes", async () => {
    const rows = await as(a, (tx) => tx.user.findMany());
    expect(rows.map((r) => r.email)).toEqual(["u@a.tg"]);
  });
  it("interdit d'écrire dans un autre tenant", async () => {
    await expect(
      as(a, (tx) => tx.user.create({ data: { tenantId: b, email: "evil@b.tg", passwordHash: "x", firstName: "E", lastName: "V", role: "ADMIN" } })),
    ).rejects.toThrow();
  });
  it("le mode plateforme voit tous les tenants", async () => {
    const rows = await app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      return tx.user.findMany();
    });
    expect(rows).toHaveLength(2);
  });
});
