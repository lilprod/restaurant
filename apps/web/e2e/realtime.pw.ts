import { expect, test } from "@playwright/test";
import { apiAs, ensureRestaurant, loginUi, newDevice } from "./support";

test.beforeAll(() => ensureRestaurant());

test("deux appareils : un plat marqué épuisé en cuisine est grisé en salle sans rechargement", async ({ browser }) => {
  const dish = "Ablo et sauce tomate";
  const cuisine = await newDevice(browser);
  const salle = await newDevice(browser);
  const admin = await apiAs("manager");
  const restore = async () => {
    const menu = (await admin("GET", "/tenant/menu")) as { items: { id: string; name: string }[] }[];
    const item = menu.flatMap((c) => c.items).find((i) => i.name === dish)!;
    await admin("PATCH", `/tenant/menu/items/${item.id}/availability`, { isAvailable: true });
  };
  try {
    await restore();
    await loginUi(salle.page, "waiter", "/commandes/nouvelle");
    const tile = salle.page.getByRole("button", { name: new RegExp(`^${dish}, `) });
    await expect(tile).toBeEnabled();

    await loginUi(cuisine.page, "kitchen", "/cuisine");
    await cuisine.page.getByRole("button", { name: /Épuisé/ }).click();
    const panel = cuisine.page.getByRole("dialog", { name: "Plats épuisés" });
    await panel.locator("li", { hasText: dish }).getByRole("button").click();
    await expect(cuisine.page.getByText(`« ${dish} » marqué épuisé`)).toBeVisible();

    // L'autre appareil n'a pas été rechargé : la tuile se grise toute seule
    await expect(salle.page.getByRole("button", { name: new RegExp(`^${dish}, .*épuisé`) })).toBeDisabled();

    // Et inversement quand il redevient disponible
    await panel.locator("li", { hasText: dish }).getByRole("button").click();
    await expect(salle.page.getByRole("button", { name: new RegExp(`^${dish}, `) })).toBeEnabled();
    await expect(salle.page.getByRole("button", { name: new RegExp(`^${dish}, .*épuisé`) })).toHaveCount(0);
  } finally {
    await restore();
    await cuisine.ctx.close();
    await salle.ctx.close();
  }
});

test("une commande ouverte ailleurs passe la table à « Occupée » sans rechargement (table.updated)", async ({ browser }) => {
  const a = await newDevice(browser);
  const manager = await apiAs("manager");
  try {
    await loginUi(a.page, "waiter", "/tables");
    await expect(a.page.getByLabel(/^Table T\d+, /).first()).toBeVisible();
    // Un autre appareil (ici l'API) ouvre une commande : le plan de salle passe à « Occupée » sans rechargement
    const tables = (await manager("GET", "/tenant/tables")) as { id: string; label: string; openOrders: unknown[] }[];
    const free = tables.find((t) => t.openOrders.length === 0)!;
    const menu = (await manager("GET", "/tenant/menu")) as { items: { id: string; optionGroups: unknown[] }[] }[];
    const simple = menu.flatMap((c) => c.items).find((i) => i.optionGroups.length === 0)!;
    const order = await manager("POST", "/tenant/orders", { type: "DINE_IN", tableId: free.id, items: [{ menuItemId: simple.id, quantity: 1 }] });
    await expect(a.page.getByLabel(new RegExp(`^Table ${free.label}, Occupée, commande n°${order.number}`))).toBeVisible();
  } finally {
    await a.ctx.close();
  }
});
