import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { resetDb } from "./helpers";

/**
 * Vérifie que prisma/sql/rls.sql isole réellement les données entre tenants.
 * Préparation (rls.sql, rôle, droits, données) avec le compte propriétaire `TEST_ADMIN_DATABASE_URL` ;
 * assertions avec le rôle non superuser `app_rls`. Fonctionne que la suite tourne en superuser ou sous `app_rls`.
 */

/**
 * Tables portant `tenantId` volontairement hors RLS, avec la raison. Toute autre table à `tenantId` DOIT avoir sa politique.
 * - Sécurité des comptes : lues AVANT de connaître le tenant (recherche par empreinte de jeton, journal de connexion
 *   d'un email inconnu) et partagées avec les comptes plateforme (`tenantId` nul) ; toujours filtrées par compte dans le code.
 * - Plateforme : données de l'éditeur (licences, inscriptions), lues uniquement par le SuperAdmin ou la garde de licence.
 */
const EXEMPT: Record<string, string> = {
  RefreshToken: "sécurité des comptes (recherche par empreinte avant le tenant)",
  PasswordReset: "sécurité des comptes (recherche par empreinte avant le tenant)",
  LoginEvent: "sécurité des comptes (échecs de connexion sans compte connu)",
  Subscription: "plateforme (licence)",
  SubscriptionPayment: "plateforme (paiements de licence)",
  TenantRegistration: "plateforme (inscription avant création du tenant)",
};

describe("Isolation multi-tenant (RLS)", () => {
  const adminUrl = process.env.TEST_ADMIN_DATABASE_URL!;
  const admin = new PrismaClient({ datasourceUrl: adminUrl });
  let app: PrismaClient;
  let a: string;
  let b: string;

  beforeAll(async () => {
    await resetDb(admin);
    execFileSync("psql", [adminUrl, "-v", "ON_ERROR_STOP=1", "-q", "-f", join(__dirname, "../prisma/sql/rls.sql")]);
    await admin.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_rls') THEN
        CREATE ROLE app_rls LOGIN PASSWORD 'rls' NOSUPERUSER;
      END IF; END $$`);
    await admin.$executeRawUnsafe(`GRANT ALL ON ALL TABLES IN SCHEMA public TO app_rls`);
    a = (await admin.tenant.create({ data: { name: "A", slug: "a", email: "a@a.tg" } })).id;
    b = (await admin.tenant.create({ data: { name: "B", slug: "b", email: "b@b.tg" } })).id;
    for (const [tenantId, email] of [[a, "u@a.tg"], [b, "u@b.tg"]]) {
      await admin.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        await tx.user.create({ data: { tenantId, email, passwordHash: "x", firstName: "U", lastName: "X", role: "ADMIN" } });
      });
    }
    const url = new URL(adminUrl);
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

  it("le rôle applicatif de test n'est ni superuser ni exempté de RLS", async () => {
    const [r] = await app.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(r).toEqual({ rolsuper: false, rolbypassrls: false });
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
  it("interdit de déplacer une ligne vers un autre tenant", async () => {
    await expect(as(a, (tx) => tx.user.updateMany({ where: { email: "u@a.tg" }, data: { tenantId: b } }))).rejects.toThrow();
  });
  it("le mode plateforme voit tous les tenants", async () => {
    const rows = await app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      return tx.user.findMany();
    });
    expect(rows).toHaveLength(2);
  });

  it("chaque table portant tenantId a sa politique (activée, forcée, via app_tenant_ok)", async () => {
    const rows = await admin.$queryRaw<{ table: string; enabled: boolean; forced: boolean; qual: string | null; check: string | null }[]>`
      SELECT c.relname AS "table", c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced, p.qual, p.with_check AS "check"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute att ON att.attrelid = c.oid AND att.attname = 'tenantId' AND NOT att.attisdropped
      LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname AND p.policyname = 'tenant_isolation'
      WHERE c.relkind = 'r' ORDER BY c.relname`;
    expect(rows.length).toBeGreaterThan(40);
    const missing = rows
      .filter((r) => !EXEMPT[r.table])
      .filter((r) => !r.enabled || !r.forced || !r.qual?.includes("app_tenant_ok") || !r.check?.includes("app_tenant_ok"))
      .map((r) => r.table);
    expect(missing).toEqual([]);
    // La liste d'exemptions ne doit pas vieillir : chaque entrée existe encore.
    expect(Object.keys(EXEMPT).filter((t) => !rows.some((r) => r.table === t))).toEqual([]);
  });
});
