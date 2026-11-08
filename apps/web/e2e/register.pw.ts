import { expect, test } from "@playwright/test";
import { apiAs, ensureRestaurant, loginUi } from "./support";

test.beforeAll(() => ensureRestaurant());

test("ouverture puis clôture de caisse avec écart", async ({ page }) => {
  // État propre : une caisse restée ouverte par un essai précédent est clôturée par l'API.
  const manager = await apiAs("manager");
  const current = await manager("GET", "/tenant/register/current");
  if (current?.session) await manager("POST", "/tenant/register/close", { counted: current.session.expected ?? 0 });

  await loginUi(page, "manager", "/caisse");
  await expect(page.getByText("Caisse fermée")).toBeVisible();
  await page.getByRole("button", { name: "Ouvrir la caisse" }).first().click();
  const open = page.getByRole("dialog", { name: "Ouvrir la caisse" });
  await open.getByLabel("Fond de caisse").fill("10000");
  await open.getByRole("button", { name: "Ouvrir la caisse" }).click();
  await expect(page.getByText("Caisse ouverte").first()).toBeVisible();

  await page.getByRole("button", { name: "Clôturer la caisse" }).first().click();
  const close = page.getByRole("dialog", { name: "Clôturer la caisse" });
  await close.getByLabel("Espèces comptées").fill("9500");     // 500 FCFA de moins que le fond attendu
  await expect(close.getByText(/manque/i)).toBeVisible();      // écart annoncé avant validation
  await expect(close.getByText(/Expliquez l'écart/)).toBeVisible();
  await close.getByLabel("Note").fill("Erreur de rendu de monnaie");
  await close.getByRole("button", { name: "Clôturer la caisse" }).click();

  await expect(page.getByText("Caisse clôturée")).toBeVisible();
  await expect(page.getByText("Caisse fermée")).toBeVisible();
  // L'historique garde l'écart
  const last = page.getByRole("row").filter({ hasText: /500/ }).first();
  await expect(last).toBeVisible();
});
