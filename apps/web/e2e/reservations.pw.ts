import { expect, test } from "@playwright/test";
import { apiAs, ensureRestaurant, loginUi, newDevice, SLUG } from "./support";

test.beforeAll(async () => {
  ensureRestaurant();
  // Horaires midi et soir tous les jours (le restaurant « e2e » peut en être dépourvu).
  const manager = await apiAs("manager");
  const ranges = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
    { weekday, opensAt: "11:30", closesAt: "15:00", slotMinutes: 15 }, { weekday, opensAt: "18:30", closesAt: "23:00", slotMinutes: 15 },
  ]);
  await manager("PUT", "/tenant/opening-hours", { ranges });
});

const dayPlus = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test("réservation publique → apparaît en temps réel côté salle, puis annulée par le client → statut mis à jour", async ({ browser }) => {
  const salle = await newDevice(browser);
  const client = await newDevice(browser);
  const guest = `Client E2E ${Date.now() % 100000}`;
  const date = dayPlus(1);
  try {
    // Salle : planning de demain, liste affichée, personne encore à ce nom
    await loginUi(salle.page, "waiter", `/reservations?date=${date}&vue=liste`);
    await expect(salle.page.getByRole("heading", { name: "Réservations" })).toBeVisible();
    await expect(salle.page.getByText(guest)).toHaveCount(0);

    // Client (sans compte) : réserve demain, 2 personnes, premier créneau
    await client.page.goto(`/r/${SLUG}/reserver`);
    await client.page.getByRole("radio", { name: /^Demain/ }).click();
    const slots = client.page.getByRole("radiogroup", { name: "Heure" }).getByRole("radio");
    await expect(slots.first()).toBeVisible();
    await slots.first().click();
    await client.page.getByLabel(/^Nom/).fill(guest);
    await client.page.getByLabel("Téléphone").fill("90 12 34 56");
    await client.page.getByRole("button", { name: "Réserver la table" }).click();
    const confirmation = client.page.getByTestId("reservation-confirmation");
    await expect(confirmation).toBeVisible();
    const code = (await confirmation.locator("p.font-mono").first().textContent())!.trim();
    expect(code).toMatch(/^[A-Z2-9]{5}$/);

    // Salle : la ligne apparaît sans rechargement
    const row = salle.page.getByRole("main").getByRole("listitem").filter({ hasText: guest });
    await expect(row).toBeVisible();
    await expect(row.getByText(code)).toBeVisible();
    await expect(row.getByText("Confirmée")).toBeVisible();

    // Client : page de gestion par lien → annulation
    await confirmation.getByRole("link", { name: "Gérer ma réservation" }).click();
    await expect(client.page.getByTestId("manage-reservation")).toBeVisible();
    await client.page.getByRole("button", { name: "Annuler la réservation" }).click();
    await client.page.getByRole("dialog").getByRole("button", { name: "Annuler la réservation" }).click();
    await expect(client.page.getByText("Cette réservation est annulée.")).toBeVisible();

    // Salle : statut mis à jour en place
    await expect(row.getByText("Annulée")).toBeVisible();
  } finally {
    await salle.ctx.close();
    await client.ctx.close();
  }
});
