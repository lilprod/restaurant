/**
 * Données de démonstration pour un restaurant existant (développement uniquement) :
 * carte togolaise, tables, équipe (gérant, serveur, cuisine).
 *   pnpm --filter api seed:demo -- <slug>
 * Mot de passe des comptes créés : DEMO_PASSWORD (défaut « Demo-Resto-2026 »).
 */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";

const prisma = new PrismaClient();

const MENU: { category: string; items: { name: string; price: number; description?: string; vat?: number; prep?: number; allergens?: string[]; dishOfDay?: boolean; options?: { name: string; min: number; max: number; options: [string, number][] }[] }[] }[] = [
  { category: "Entrées", items: [
    { name: "Ablo et sauce tomate", price: 1500, description: "Petits pains de maïs vapeur, sauce tomate pimentée", prep: 10 },
    { name: "Salade avocat-crevettes", price: 2500, allergens: ["CRUSTACEANS"], prep: 8 },
  ] },
  { category: "Plats", items: [
    { name: "Poulet braisé", price: 4000, description: "Poulet bicyclette mariné et braisé au feu de bois", prep: 25, dishOfDay: true,
      options: [{ name: "Accompagnement", min: 1, max: 1, options: [["Alloco", 500], ["Attiéké", 0], ["Riz blanc", 0], ["Frites", 300]] },
        { name: "Piment", min: 0, max: 1, options: [["Doux", 0], ["Fort", 0]] }] },
    { name: "Fufu sauce arachide", price: 3000, description: "Igname pilée, sauce arachide à la viande de mouton", allergens: ["PEANUTS"], prep: 20 },
    { name: "Akoumé sauce gboma", price: 2500, description: "Pâte de maïs, sauce épinards et poisson fumé", allergens: ["FISH"], prep: 15 },
    { name: "Djenkoumé et poulet", price: 3500, description: "Pâte rouge de maïs, poulet frit", prep: 20 },
    { name: "Poisson braisé", price: 5000, description: "Tilapia braisé, oignons et tomates", allergens: ["FISH"], prep: 30,
      options: [{ name: "Accompagnement", min: 1, max: 1, options: [["Akassa", 0], ["Alloco", 500], ["Attiéké", 0]] }] },
  ] },
  { category: "Boissons", items: [
    { name: "Bissap maison", price: 700, vat: 10, prep: 1 },
    { name: "Jus de gingembre", price: 700, vat: 10, prep: 1 },
    { name: "Eau minérale 1,5 L", price: 600, vat: 10, prep: 0 },
    { name: "Bière locale 65 cl", price: 1000, prep: 0 },
    { name: "Sodabi (verre)", price: 800, prep: 0 },
  ] },
  { category: "Desserts", items: [
    { name: "Ananas frais", price: 1000, prep: 3 },
    { name: "Dégué", price: 1200, description: "Couscous de mil au yaourt", allergens: ["MILK"], prep: 3 },
  ] },
];

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("seed-demo est réservé au développement");
  const slug = process.argv.slice(2).find((a) => a !== "--");
  if (!slug) throw new Error("Usage : seed:demo -- <slug du restaurant>");
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) throw new Error(`Restaurant « ${slug} » introuvable`);
  const password = process.env.DEMO_PASSWORD ?? "Demo-Resto-2026";

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
    const tenantId = tenant.id;

    // Équipe
    const hash = await argon2.hash(password);
    for (const [role, first] of [["MANAGER", "Gérant"], ["WAITER", "Serveur"], ["KITCHEN", "Cuisine"]] as const) {
      const email = `${role.toLowerCase()}@${slug}.demo`;
      await tx.user.upsert({
        where: { tenantId_email: { tenantId, email } }, update: {},
        create: { tenantId, email, role, firstName: first, lastName: "Démo", passwordHash: hash, passwordChangedAt: new Date() },
      });
    }

    // Tables
    const plan = (await tx.floorPlan.findFirst({ where: { tenantId } })) ?? (await tx.floorPlan.create({ data: { tenantId, name: "Salle principale", width: 1000, height: 700 } }));
    for (let n = 1; n <= 8; n++) {
      const label = n <= 6 ? `T${n}` : `Terrasse ${n - 6}`;
      if (!(await tx.restaurantTable.findFirst({ where: { floorPlanId: plan.id, label } }))) {
        await tx.restaurantTable.create({ data: { tenantId, floorPlanId: plan.id, label, capacity: n % 3 === 0 ? 6 : 4, posX: 40 + ((n - 1) % 4) * 140, posY: 40 + Math.floor((n - 1) / 4) * 140 } });
      }
    }

    // Carte
    const allergens = await tx.allergen.findMany();
    for (const [ci, c] of MENU.entries()) {
      const cat = (await tx.category.findFirst({ where: { tenantId, name: c.category } })) ?? (await tx.category.create({ data: { tenantId, name: c.category, sortOrder: ci } }));
      for (const [ii, it] of c.items.entries()) {
        if (await tx.menuItem.findFirst({ where: { tenantId, name: it.name, archivedAt: null } })) continue;
        await tx.menuItem.create({
          data: {
            tenantId, categoryId: cat.id, name: it.name, description: it.description, price: it.price, vatRate: it.vat ?? 18,
            prepMinutes: it.prep ?? 10, isDishOfDay: it.dishOfDay ?? false, sortOrder: ii,
            allergens: { create: (it.allergens ?? []).map((code) => ({ tenantId, allergenId: allergens.find((a) => a.code === code)!.id })) },
            optionGroups: { create: (it.options ?? []).map((g, gi) => ({
              tenantId, name: g.name, minChoices: g.min, maxChoices: g.max, sortOrder: gi,
              options: { create: g.options.map(([name, extra]) => ({ tenantId, name, extra })) },
            })) },
          },
        });
      }
    }
  });
  console.log(`Démo prête pour « ${slug} » : 8 tables, ${MENU.reduce((n, c) => n + c.items.length, 0)} plats, comptes manager|waiter|kitchen@${slug}.demo`);
}

main().finally(() => prisma.$disconnect());
