import { expect, test } from "@playwright/test";
import { apiAs, ensureRestaurant, loginUi } from "./support";

test.beforeAll(() => ensureRestaurant());

test("modifier un article en attente depuis le détail de commande", async ({ page }) => {
  const waiter = await apiAs("waiter");
  const menu = (await waiter("GET", "/tenant/menu")) as { items: { id: string; name: string; price: number; optionGroups: unknown[] }[] }[];
  const dish = menu.flatMap((c) => c.items).find((i) => i.optionGroups.length === 0 && i.price > 0)!;
  const order = await waiter("POST", "/tenant/orders", { type: "TAKEAWAY", items: [{ menuItemId: dish.id, quantity: 1 }] });

  await loginUi(page, "waiter", `/commandes/${order.id}`);
  await page.getByRole("button", { name: `Modifier « ${dish.name} »` }).click();
  const dialog = page.getByRole("dialog", { name: `Modifier « ${dish.name} »` });
  await expect(dialog.getByRole("button", { name: "Enregistrer" })).toBeDisabled();   // rien n'a changé
  await dialog.getByRole("button", { name: "Augmenter quantité" }).click();
  await dialog.getByLabel("Consignes pour la cuisine").fill("Sans piment");
  await dialog.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page.getByText(`« ${dish.name} » modifié`)).toBeVisible();
  const line = page.getByRole("listitem").filter({ hasText: dish.name }).first();
  await expect(line).toContainText("2×");
  await expect(line).toContainText("Sans piment");
  await expect(page.getByText(new RegExp(`${(dish.price * 2).toLocaleString("fr-FR").replace(/\s/g, ".?")}`)).first()).toBeVisible();

  // Une fois la cuisine lancée, l'action disparaît (l'API refuse aussi : 409)
  const kitchen = await apiAs("kitchen");
  const full = await waiter("GET", `/tenant/orders/${order.id}`);
  await kitchen("POST", `/tenant/orders/${order.id}/items/${full.items[0].id}/status`, { status: "IN_PROGRESS" });
  await expect(page.getByRole("button", { name: `Modifier « ${dish.name} »` })).toHaveCount(0);
  const refused = await waiter("PATCH", `/tenant/orders/${order.id}/items/${full.items[0].id}`, { quantity: 3 });
  expect(refused.statusCode).toBe(409);
});
