import { expect, test } from "@playwright/test";
import { apiAs, ensureRestaurant, loginUi, newDevice, PASSWORD, SLUG, sql } from "./support";

/** P2C : suivi de commande en direct sans compte, avis, espace client (compte, réservations, avis, RGPD), modération côté restaurant. */
const stamp = Date.now() % 1_000_000;
const CLIENT = `client${stamp}@exemple.tg`;
const CPW = "Mangue-Verte-58";
const dayPlus = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test.beforeAll(async () => {
  ensureRestaurant();
  const manager = await apiAs("manager");
  const ranges = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
    { weekday, opensAt: "11:30", closesAt: "15:00", slotMinutes: 15 }, { weekday, opensAt: "18:30", closesAt: "23:00", slotMinutes: 15 },
  ]);
  await manager("PUT", "/tenant/opening-hours", { ranges });
  await apiAs("admin").then((admin) => admin("PATCH", "/tenant/settings/operations", { publicReviews: true }));
  const cur = await manager("GET", "/tenant/register/current");
  if (!cur?.session) await manager("POST", "/tenant/register/open", { opening: 10000 });
});

/** Commande à emporter créée par la salle ; renvoie ses actions et le lien de suivi. */
async function takeaway(label: string) {
  const waiter = await apiAs("waiter");
  const kitchen = await apiAs("kitchen");
  const menu = await (await fetch(`${process.env.E2E_BASE_URL ?? "http://localhost:5173"}/api/v1/public/tenants/${SLUG}/menu`)).json();
  const item = menu.categories[0].items.find((i: { optionGroups: unknown[] }) => i.optionGroups.length === 0) ?? menu.categories[0].items[0];
  const order = await waiter("POST", "/tenant/orders", { type: "TAKEAWAY", customerName: label, items: [{ menuItemId: item.id, quantity: 1 }] });
  expect(order.id).toBeTruthy();
  const link = await waiter("GET", `/tenant/orders/${order.id}/tracking-link`);
  const pay = async () => {
    await waiter("POST", `/tenant/orders/${order.id}/advance`, { status: "SERVED" });
    await waiter("POST", `/tenant/orders/${order.id}/payments`, { method: "CASH", amount: order.total, tendered: order.total });
  };
  return { order, token: link.token as string, url: link.url as string, waiter, kitchen, pay };
}

test("suivi en direct sans compte : reçue → en préparation → prête sans rechargement, puis avis par le lien du ticket", async ({ browser }) => {
  const o = await takeaway("Suivi E2E");
  const client = await newDevice(browser);
  try {
    await client.page.goto(`/r/${SLUG}/suivi/${o.token}`);
    await expect(client.page.getByRole("heading", { name: "Votre commande est bien reçue" })).toBeVisible();
    await o.kitchen("POST", `/tenant/orders/${o.order.id}/advance`, { status: "IN_PROGRESS" });
    await expect(client.page.getByRole("heading", { name: "On prépare votre commande" })).toBeVisible({ timeout: 12_000 });
    await o.kitchen("POST", `/tenant/orders/${o.order.id}/advance`, { status: "READY" });
    await expect(client.page.getByRole("heading", { name: "Votre commande est prête !" })).toBeVisible({ timeout: 12_000 });
    await expect(client.page.getByText("Vous pouvez venir la retirer.")).toBeVisible();
    await expect(client.page.getByRole("link", { name: /Donner mon avis/ })).toHaveCount(0);

    // Clôture : le lien propose l'avis
    await o.pay();
    await expect(client.page.getByRole("heading", { name: "Merci, bon appétit !" })).toBeVisible({ timeout: 12_000 });
    await client.page.getByRole("link", { name: /Donner mon avis/ }).click();
    await expect(client.page.getByTestId("review-page")).toBeVisible();
    await client.page.getByRole("radio", { name: "5 sur 5" }).click();
    await client.page.getByLabel("Votre commentaire").fill(`Excellent accueil ${stamp}`);
    await client.page.getByLabel("Votre prénom").fill("Yao");
    await client.page.getByRole("button", { name: "Envoyer mon avis" }).click();
    await expect(client.page.getByRole("heading", { name: "Merci pour votre avis" })).toBeVisible();
    await expect(client.page.getByText(`Excellent accueil ${stamp}`)).toBeVisible();

    // Lien inconnu : page dédiée
    await client.page.goto(`/r/${SLUG}/suivi/${"z".repeat(43)}`);
    await expect(client.page.getByText("Lien invalide")).toBeVisible();
  } finally { await client.ctx.close(); }
});

test("espace client : inscription, réservation rattachée (modifier, annuler), commande rattachée et avis, préférences, export, suppression", async ({ browser }) => {
  const dev = await newDevice(browser);
  const p = dev.page;
  try {
    // Inscription (mobile)
    await p.setViewportSize({ width: 390, height: 844 });
    await p.goto(`/r/${SLUG}/compte?mode=inscription`);
    await expect(p.getByTestId("customer-welcome")).toBeVisible();
    await p.getByLabel("Prénom").fill("Awa");
    await p.getByLabel("Nom", { exact: true }).fill("Mensah");
    await p.getByLabel("Email").fill(CLIENT);
    await p.getByLabel("Téléphone").fill("90 11 22 33");
    await p.getByLabel("Mot de passe", { exact: true }).fill(CPW);
    await p.getByRole("button", { name: "Créer mon compte" }).click();
    await expect(p.getByText("Vous devez accepter")).toBeVisible();
    await p.getByRole("checkbox").check();
    await p.getByRole("button", { name: "Créer mon compte" }).click();
    await expect(p.getByTestId("customer-space")).toBeVisible();
    await expect(p.getByRole("heading", { name: "Bonjour Awa" })).toBeVisible();
    await expect(p.getByText("Vérifiez votre email")).toBeVisible();
    await expect(p.getByText("Aucune réservation pour le moment")).toBeVisible();

    // L'espace du personnel lui est fermé
    await p.goto(`/r/${SLUG}/commandes`);
    await expect(p.getByTestId("customer-space")).toBeVisible();

    // Email vérifié (le code part par email : on valide en base), puis réservation en ligne avec cette adresse : rattachée d'office
    sql(`update "User" set "emailVerifiedAt" = now() where email = '${CLIENT}' and "tenantId" = (select id from "Tenant" where slug = '${SLUG}')`);
    const date = dayPlus(2);
    const avail = await (await fetch(`${process.env.E2E_BASE_URL ?? "http://localhost:5173"}/api/v1/public/tenants/${SLUG}/availability?date=${date}&partySize=2`)).json();
    expect(avail.slots.length).toBeGreaterThan(0);
    const booked = await fetch(`${process.env.E2E_BASE_URL ?? "http://localhost:5173"}/api/v1/public/tenants/${SLUG}/reservations`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ guestName: "Awa Mensah", guestPhone: "90 11 22 33", guestEmail: CLIENT, partySize: 2, startsAt: avail.slots[0].startsAt }),
    });
    expect(booked.status).toBe(201);
    await p.goto(`/r/${SLUG}/compte`);
    const card = p.getByTestId("customer-reservation").first();
    await expect(card).toBeVisible();
    await expect(card.getByText("2 personnes")).toBeVisible();
    await card.getByRole("button", { name: "Modifier" }).click();
    await card.getByLabel("Demandes particulières").fill("Chaise bébé");
    await card.getByRole("button", { name: "Enregistrer" }).click();
    await expect(card.getByText("« Chaise bébé »")).toBeVisible();
    await card.getByRole("button", { name: "Annuler" }).click();
    await p.getByRole("button", { name: "Annuler la réservation" }).click();
    await expect(card.getByText("Annulée")).toBeVisible();

    // Commandes et avis : rattacher une commande close par le lien de son ticket, puis donner un avis
    const o = await takeaway("Awa");
    await o.kitchen("POST", `/tenant/orders/${o.order.id}/advance`, { status: "IN_PROGRESS" });
    await o.kitchen("POST", `/tenant/orders/${o.order.id}/advance`, { status: "READY" });
    await o.pay();
    await p.getByRole("tab", { name: /Commandes et avis/ }).click();
    await p.getByLabel("Ajouter une commande").fill(o.url);
    await p.getByRole("button", { name: "Ajouter" }).click();
    const order = p.getByTestId("customer-order").first();
    await expect(order).toBeVisible();
    await order.getByRole("button", { name: /Donner mon avis/ }).click();
    await p.getByRole("radio", { name: "4 sur 5" }).click();
    await p.getByLabel("Votre commentaire").fill(`Très bon ${stamp}`);
    await p.getByRole("dialog").getByRole("button", { name: "Envoyer mon avis" }).click();
    await expect(order.getByText(`Très bon ${stamp}`)).toBeVisible();
    await expect(order.getByRole("button", { name: /Donner mon avis/ })).toHaveCount(0);

    // Profil : préférences, export, suppression
    await p.getByRole("tab", { name: /Profil/ }).click();
    const sw = p.getByRole("switch", { name: /Rappel de réservation/ });
    await expect(sw).toBeChecked();
    await sw.click();
    await expect(sw).not.toBeChecked();
    const download = p.waitForEvent("download");
    await p.getByRole("button", { name: "Exporter mes données" }).click();
    expect((await download).suggestedFilename()).toBe(`mes-donnees-${SLUG}.json`);
    await p.getByRole("button", { name: "Supprimer mon compte" }).click();
    await p.getByRole("dialog").getByLabel("Confirmez avec votre mot de passe").fill("Mauvais-Mot2Passe");
    await p.getByRole("button", { name: "Supprimer définitivement" }).click();
    await expect(p.getByText("Mot de passe incorrect")).toBeVisible();
    await p.getByRole("dialog").getByLabel("Confirmez avec votre mot de passe").fill(CPW);
    await p.getByRole("button", { name: "Supprimer définitivement" }).click();
    await expect(p.getByTestId("customer-welcome")).toBeVisible();
    expect(sql(`select count(*) from "User" where email = '${CLIENT}'`)).toBe("0");
  } finally { await dev.ctx.close(); }
});

test("restaurant : écran Avis (moyenne, répartition), réponse publique, masquer", async ({ browser }) => {
  const salle = await newDevice(browser);
  try {
    await loginUi(salle.page, "manager", "/avis");
    await expect(salle.page.getByRole("heading", { name: "Avis", exact: true })).toBeVisible();
    await expect(salle.page.getByRole("region", { name: "Statistiques" })).toBeVisible();
    const mine = salle.page.getByTestId("review").filter({ hasText: `Excellent accueil ${stamp}` });
    await expect(mine).toBeVisible();
    await mine.getByRole("button", { name: "Répondre" }).click();
    await mine.getByLabel("Réponse publique").fill("Merci Yao, à bientôt !");
    await mine.getByRole("button", { name: "Publier la réponse" }).click();
    await expect(mine.getByText("Merci Yao, à bientôt !")).toBeVisible();
    await expect(mine.getByText("Répondu")).toBeVisible();

    // Visible publiquement sur la carte
    const pub = await newDevice(browser);
    await pub.page.goto(`/r/${SLUG}/carte`);
    await expect(pub.page.getByTestId("menu-rating")).toBeVisible();
    await expect(pub.page.getByText("Merci Yao, à bientôt !")).toBeVisible();

    // Masquer : disparaît de la carte publique
    await mine.getByRole("button", { name: "Masquer" }).click();
    await salle.page.getByRole("button", { name: "Masquer", exact: true }).last().click();
    await expect(mine.getByText("Masqué")).toBeVisible();
    await pub.page.reload();
    await expect(pub.page.getByText("Merci Yao, à bientôt !")).toHaveCount(0);
    await pub.ctx.close();
  } finally { await salle.ctx.close(); }
});

void PASSWORD;
