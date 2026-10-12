/**
 * Seed de la plateforme : compte SuperAdmin + plans d'exemple (idempotent).
 * Les montants sont des EXEMPLES à ajuster dans l'espace SuperAdmin.
 */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";

const prisma = new PrismaClient();

const PLANS = [
  { code: "STARTER", name: "Starter", description: "Petit restaurant : commandes, menu, réservations.", priceMonthly: 15000, priceYearly: 150000, maxUsers: 5, maxTables: 10, sortOrder: 1,
    features: { reservations: true, orders: true, inventory: false, staff: false, reports: false, delivery: false } },
  { code: "PRO", name: "Pro", description: "Stock, personnel et rapports inclus.", priceMonthly: 35000, priceYearly: 350000, maxUsers: 20, maxTables: 40, sortOrder: 2,
    features: { reservations: true, orders: true, inventory: true, staff: true, reports: true, delivery: false } },
  { code: "PREMIUM", name: "Premium", description: "Tous les modules, sans limite.", priceMonthly: 75000, priceYearly: 750000, maxUsers: null, maxTables: null, sortOrder: 3,
    features: { reservations: true, orders: true, inventory: true, staff: true, reports: true, delivery: true } },
];

async function main() {
  const email = (process.env.SEED_SUPERADMIN_EMAIL ?? "superadmin@restaurant.local").toLowerCase();
  const password = process.env.SEED_SUPERADMIN_PASSWORD;
  if (process.env.NODE_ENV === "production" && !password) {
    throw new Error("SEED_SUPERADMIN_PASSWORD est obligatoire en production");
  }
  const existing = await prisma.platformUser.findUnique({ where: { email } });
  if (!existing) {
    await prisma.platformUser.create({
      data: {
        email, firstName: "Super", lastName: "Admin", role: "SUPER_ADMIN",
        passwordHash: await argon2.hash(password ?? "ChangeMe123!"),
      },
    });
    console.log(`SuperAdmin créé : ${email}${password ? "" : " (mot de passe de développement : ChangeMe123!)"}`);
  }
  for (const plan of PLANS) {
    await prisma.plan.upsert({ where: { code: plan.code }, update: {}, create: plan });
  }
  console.log(`Plans : ${PLANS.map((p) => p.code).join(", ")}`);
}

main().finally(() => prisma.$disconnect());
