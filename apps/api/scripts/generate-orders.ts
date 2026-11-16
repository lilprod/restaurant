/**
 * Génère un gros volume de commandes (avec lignes et paiements) pour mesurer les rapports (P5 : < 2 s sur 50 000 commandes).
 *
 *   cd apps/api && DATABASE_URL=postgresql://app:app@localhost:5433/restaurant npx tsx scripts/generate-orders.ts <slug> [nombre=50000] [jours=90]
 *   … --clean   supprime les commandes générées (repérées par leur nom de client « PERF-GEN »)
 *
 * Données de développement uniquement : à ne jamais lancer sur une base de production. Le restaurant doit avoir un menu.
 */
import { PrismaClient } from "@prisma/client";

const [slug, nArg, dArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const clean = process.argv.includes("--clean");
const N = Number(nArg ?? 50_000), DAYS = Number(dArg ?? 90), MARK = "PERF-GEN";

async function main() {
  if (!slug) throw new Error("Usage : generate-orders.ts <slug> [nombre] [jours] [--clean]");
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new Error(`Restaurant « ${slug} » introuvable`);
    const t = tenant.id;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      await tx.$executeRaw`DELETE FROM "Payment" WHERE "tenantId" = ${t} AND "orderId" IN (SELECT id FROM "Order" WHERE "tenantId" = ${t} AND "customerName" = ${MARK})`;
      await tx.$executeRaw`DELETE FROM "Order" WHERE "tenantId" = ${t} AND "customerName" = ${MARK}`;
      if (clean) return;
      const menu = await tx.menuItem.findMany({ where: { tenantId: t, archivedAt: null }, select: { id: true } });
      if (!menu.length) throw new Error("Le restaurant n'a aucun plat");
      const [{ base }] = await tx.$queryRaw<{ base: number }[]>`SELECT COALESCE(MAX(number), 0)::int AS base FROM "Order" WHERE "tenantId" = ${t}`;
      const waiters = await tx.user.findMany({ where: { tenantId: t, role: { in: ["WAITER", "MANAGER"] } }, select: { id: true } });
      const w = waiters.map((x) => x.id);
      // 1. Commandes vides, réparties sur les N derniers jours, surtout midi et soir.
      await tx.$executeRaw`
        INSERT INTO "Order" (id, "tenantId", number, type, status, "customerName", "waiterId", "paymentStatus", "createdAt", "updatedAt", "closedAt")
        SELECT gen_random_uuid(), ${t}, ${base} + g, (ARRAY['DINE_IN','TAKEAWAY','DELIVERY'])[1 + g % 3]::"OrderType", 'DELIVERED', ${MARK},
               CASE WHEN ${w.length} = 0 THEN NULL ELSE (${w}::text[])[1 + g % ${w.length || 1}] END, 'PAID',
               ts, ts, ts + interval '50 minutes'
        FROM (SELECT g, date_trunc('day', now()) - ((g * 7919) % ${DAYS}) * interval '1 day'
                         + (CASE WHEN g % 2 = 0 THEN 12 ELSE 19 END + (g % 3)) * interval '1 hour' + ((g * 31) % 60) * interval '1 minute' AS ts
              FROM generate_series(1, ${N}) g) s`;
      // 2. Deux lignes par commande.
      await tx.$executeRaw`
        INSERT INTO "OrderItem" (id, "tenantId", "orderId", "menuItemId", name, quantity, "unitPrice", "vatRate", "lineTotal", status, "createdAt")
        SELECT gen_random_uuid(), ${t}, o.id, m.id, m.name, 1 + (o.number % 3), m.price, m."vatRate", m.price * (1 + (o.number % 3)), 'SERVED', o."createdAt"
        FROM "Order" o
        CROSS JOIN generate_series(1, 2) k
        JOIN (SELECT id, name, price, "vatRate", row_number() OVER (ORDER BY id) AS rn, count(*) OVER () AS n FROM "MenuItem" WHERE "tenantId" = ${t} AND "archivedAt" IS NULL) m
          ON m.rn = 1 + ((o.number * k * 7) % m.n)
        WHERE o."tenantId" = ${t} AND o."customerName" = ${MARK}`;
      // 3. Totaux (TVA incluse au taux de chaque ligne) puis paiements.
      await tx.$executeRaw`
        UPDATE "Order" o SET subtotal = s.sub, total = s.sub, vat = s.vat, "paidAmount" = s.sub
        FROM (SELECT "orderId", SUM("lineTotal")::int AS sub, SUM(ROUND("lineTotal" * "vatRate" / (100 + "vatRate")))::int AS vat FROM "OrderItem"
              WHERE "tenantId" = ${t} AND "orderId" IN (SELECT id FROM "Order" WHERE "tenantId" = ${t} AND "customerName" = ${MARK}) GROUP BY "orderId") s
        WHERE o.id = s."orderId"`;
      await tx.$executeRaw`
        INSERT INTO "Payment" (id, "tenantId", "orderId", method, status, amount, tip, "paidAt", "createdAt")
        SELECT gen_random_uuid(), ${t}, id, (ARRAY['CASH','CARD','FLOOZ','TMONEY'])[1 + number % 4]::"PaymentMethod", 'PAID', total, (number % 5) * 100, "closedAt", "closedAt"
        FROM "Order" WHERE "tenantId" = ${t} AND "customerName" = ${MARK}`;
    }, { timeout: 300_000, maxWait: 30_000 });
    console.log(clean ? "Commandes générées supprimées." : `${N} commandes générées sur ${DAYS} jours pour « ${slug} ».`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
