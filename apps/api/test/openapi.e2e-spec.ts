import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { createApp } from "./helpers";
import { buildApiDocument } from "../src/setup";

describe("documentation OpenAPI générée depuis les schémas Zod (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let doc: any;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createApp();
    doc = buildApiDocument(app);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const body = (path: string, method: string) => doc.paths[path][method].requestBody?.content?.["application/json"]?.schema;

  it("décrit les corps de la phase 1 (plats, commandes, paiements, caisse, équipe, tables)", () => {
    expect(Object.keys(body("/api/v1/tenant/menu/items", "post").properties)).toEqual(expect.arrayContaining(["categoryId", "name", "price"]));
    expect(body("/api/v1/tenant/menu/items", "post").required).toEqual(expect.arrayContaining(["categoryId", "name", "price"]));
    expect(body("/api/v1/tenant/orders", "post").properties.items.type).toBe("array");
    expect(body("/api/v1/tenant/orders/{id}/payments", "post").properties.method.enum).toContain("CASH");
    expect(body("/api/v1/tenant/orders/{id}/items/{itemId}", "patch").properties.quantity).toMatchObject({ type: "integer", minimum: 1, maximum: 99 });
    expect(body("/api/v1/tenant/register/close", "post")).toBeDefined();
    expect(body("/api/v1/tenant/staff", "post").properties.role.enum).toContain("WAITER");
    expect(body("/api/v1/tenant/tables", "post").properties.label).toBeDefined();
    expect(body("/api/v1/platform/tenants/{tenantId}/security/users/{userId}/active", "patch").properties.isActive.type).toBe("boolean");
  });

  it("décrit les paramètres de requête et les corps d'authentification", () => {
    const names = doc.paths["/api/v1/tenant/orders"].get.parameters.map((p: { name: string }) => p.name);
    expect(names).toEqual(expect.arrayContaining(["status", "page"]));
    expect(body("/api/v1/tenant/auth/login", "post").properties.email).toBeDefined();
  });

  it("ne marque aucune route à corps JSON sans description (hors envois de fichiers)", () => {
    const missing: string[] = [];
    for (const [path, ops] of Object.entries<any>(doc.paths)) {
      for (const [method, op] of Object.entries<any>(ops)) {
        if (!["post", "patch", "put"].includes(method)) continue;
        if (op.requestBody) continue;
        if (op.parameters?.some((p: { in: string }) => p.in === "body")) continue;
        missing.push(`${method.toUpperCase()} ${path}`);
      }
    }
    // Les routes restantes n'ont pas de corps (actions) ou reçoivent un fichier / un objet libre (réglages par section).
    expect(missing.filter((m) => /tenant\/(menu|orders|tables|staff|register)/.test(m) && !/(image|advance|cancel|status|refund|reorder)/.test(m))).toEqual([]);
  });
});
